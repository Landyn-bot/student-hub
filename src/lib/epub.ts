/**
 * EPUB parser: .epub file -> clean, chunked text that an LLM (e.g. Nemotron) can read.
 *
 * - Only dependency: `jszip` (works in the browser, Bun/Node, and edge/serverless runtimes).
 * - XML/XHTML is read with a small built-in parser (EPUB content must be well-formed XHTML),
 *   so there is no DOM / DOMParser requirement.
 *
 * Usage:
 *   const parsed = await parseEpub(await file.arrayBuffer());
 *   const chunks = chunkEpub(parsed, { maxChars: 12000 });
 */
import JSZip from "jszip";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface EpubMetadata {
  title: string | null;
  authors: string[];
  language: string | null;
  publisher: string | null;
  identifier: string | null;
  published: string | null;
  description: string | null;
}

export interface TocEntry {
  title: string;
  /** Zip-internal path of the target file (fragment stripped), or null if the entry has no link. */
  path: string | null;
  depth: number;
}

export interface EpubChapter {
  /** 0-based position in reading order, after empty/skipped files are dropped. */
  index: number;
  /** Manifest id from the OPF file. */
  id: string;
  /** Zip-internal path of the source file. */
  path: string;
  title: string;
  /** Clean text with light markdown: `#` headings, `-` / `1.` lists, ``` code fences, `|` table rows. */
  text: string;
  wordCount: number;
}

export interface ParsedEpub {
  metadata: EpubMetadata;
  toc: TocEntry[];
  chapters: EpubChapter[];
  /** Non-fatal problems (missing files, unreadable TOC, possible DRM, ...). */
  warnings: string[];
}

export interface EpubChunk {
  /** `${chapterIndex}-${part}` */
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  /** 1-based part number within the chapter. */
  part: number;
  totalParts: number;
  text: string;
}

export interface ParseEpubOptions {
  /** Reject files larger than this. Default 100 MB. */
  maxBytes?: number;
  /** Skip "Table of Contents" pages (the `toc` array already has that info). Default true. */
  dropTocPages?: boolean;
}

export interface ChunkOptions {
  /** Max characters per chunk (~4 chars per token). Default 12,000 (~3k tokens). */
  maxChars?: number;
}

export class EpubParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpubParseError";
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

const HTML_TYPES = new Set(["application/xhtml+xml", "text/html"]);

export async function parseEpub(
  input: ArrayBuffer | Uint8Array | Blob,
  options: ParseEpubOptions = {},
): Promise<ParsedEpub> {
  const maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
  const dropTocPages = options.dropTocPages ?? true;
  const size = typeof Blob !== "undefined" && input instanceof Blob ? input.size : (input as ArrayBuffer | Uint8Array).byteLength;
  if (size > maxBytes) {
    throw new EpubParseError(`EPUB is too large (${(size / 1024 / 1024).toFixed(1)} MB).`);
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new EpubParseError("Not a valid EPUB: could not open the file as a zip archive.");
  }

  // Zip lookups are case-sensitive but some EPUBs have sloppy hrefs; keep a lowercase fallback index.
  const lowerIndex = new Map<string, string>();
  zip.forEach((relPath) => lowerIndex.set(relPath.toLowerCase(), relPath));

  const readText = async (path: string): Promise<string | null> => {
    const entry = zip.file(path) ?? zip.file(lowerIndex.get(path.toLowerCase()) ?? "");
    if (!entry) return null;
    return (await entry.async("string")).replace(/^\uFEFF/, "");
  };

  const warnings: string[] = [];

  // 1. container.xml -> path of the OPF package file
  const containerXml = await readText("META-INF/container.xml");
  if (!containerXml) throw new EpubParseError("Not a valid EPUB: META-INF/container.xml is missing.");
  const rootfiles = descendants(parseMarkup(containerXml), (e) => e.name === "rootfile");
  const rootfile =
    rootfiles.find((r) => /oebps-package\+xml/.test(r.attrs["media-type"] ?? "")) ?? rootfiles[0];
  const opfPath = rootfile?.attrs["full-path"];
  if (!opfPath) throw new EpubParseError("Not a valid EPUB: no package (OPF) file declared.");

  // 2. OPF -> metadata, manifest, spine
  const opfXml = await readText(opfPath);
  if (!opfXml) throw new EpubParseError(`Package file not found in archive: ${opfPath}`);
  const pkg = descendants(parseMarkup(opfXml), (e) => e.name === "package")[0];
  if (!pkg) throw new EpubParseError("Package file is malformed.");
  const opfDir = dirname(opfPath);

  const md = childNamed(pkg, "metadata");
  const mdTexts = (name: string): string[] =>
    md ? childrenNamed(md, name).map((e) => collapseWhitespace(textContent(e))).filter(Boolean) : [];
  const metadata: EpubMetadata = {
    title: mdTexts("title")[0] ?? null,
    authors: mdTexts("creator"),
    language: mdTexts("language")[0] ?? null,
    publisher: mdTexts("publisher")[0] ?? null,
    identifier: mdTexts("identifier")[0] ?? null,
    published: mdTexts("date")[0] ?? null,
    description: mdTexts("description")[0] ?? null,
  };

  interface ManifestItem {
    id: string;
    path: string;
    mediaType: string;
    properties: string[];
  }
  const manifest = new Map<string, ManifestItem>();
  const manifestEl = childNamed(pkg, "manifest");
  for (const it of manifestEl ? childrenNamed(manifestEl, "item") : []) {
    const id = it.attrs["id"];
    const href = it.attrs["href"];
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      path: resolvePath(opfDir, href),
      mediaType: it.attrs["media-type"] ?? "",
      properties: (it.attrs["properties"] ?? "").split(/\s+/).filter(Boolean),
    });
  }
  const spineEl = childNamed(pkg, "spine");

  // 3. Table of contents: EPUB 3 nav document, falling back to EPUB 2 NCX. Non-fatal on failure.
  let toc: TocEntry[] = [];
  try {
    const navItem = [...manifest.values()].find((m) => m.properties.includes("nav"));
    if (navItem) {
      const navHtml = await readText(navItem.path);
      if (navHtml) toc = parseNavDoc(navHtml, dirname(navItem.path));
    }
    if (toc.length === 0) {
      const ncxId = spineEl?.attrs["toc"];
      const ncxItem =
        (ncxId ? manifest.get(ncxId) : undefined) ??
        [...manifest.values()].find((m) => m.mediaType === "application/x-dtbncx+xml");
      if (ncxItem) {
        const ncxXml = await readText(ncxItem.path);
        if (ncxXml) toc = parseNcx(ncxXml, dirname(ncxItem.path));
      }
    }
  } catch (e) {
    warnings.push(`Could not read table of contents: ${(e as Error).message}`);
  }

  const tocTitleByPath = new Map<string, string>();
  for (const entry of toc) {
    if (entry.path && entry.title && !tocTitleByPath.has(entry.path)) {
      tocTitleByPath.set(entry.path, entry.title);
    }
  }

  // 4. Walk the spine (reading order) and extract text from each content document
  const chapters: EpubChapter[] = [];
  for (const ref of spineEl ? childrenNamed(spineEl, "itemref") : []) {
    const item = manifest.get(ref.attrs["idref"] ?? "");
    if (!item || !HTML_TYPES.has(item.mediaType) || item.properties.includes("nav")) continue;

    const html = await readText(item.path);
    if (html === null) {
      warnings.push(`Listed in the book but missing from the archive: ${item.path}`);
      continue;
    }

    let extracted: ExtractedContent;
    try {
      extracted = extractContent(html);
    } catch (e) {
      warnings.push(`Could not parse ${item.path}: ${(e as Error).message}`);
      continue;
    }
    if (!extracted.text) continue; // cover pages, image-only pages, blank separators

    const title = tocTitleByPath.get(item.path) ?? extracted.heading ?? fileStem(item.path);
    if (dropTocPages && /^(table of )?contents?$/i.test(title.trim())) continue;

    chapters.push({
      index: chapters.length,
      id: item.id,
      path: item.path,
      title,
      text: extracted.text,
      wordCount: countWords(extracted.text),
    });
  }

  if (chapters.length === 0) {
    throw new EpubParseError(
      "No readable text found. The EPUB may be image-only (scanned/fixed-layout) or DRM-protected.",
    );
  }
  if (lowerIndex.has("meta-inf/encryption.xml") && chapters.reduce((n, c) => n + c.wordCount, 0) < 200) {
    warnings.push("This EPUB has an encryption manifest and very little text; it may be DRM-protected.");
  }

  return { metadata, toc, chapters, warnings };
}

/**
 * Split parsed chapters into chunks that fit a model's context budget.
 * Chunks never cross chapter boundaries and break on paragraph boundaries where possible,
 * so each chunk can be sent together with its chapter title.
 */
export function chunkEpub(parsed: ParsedEpub, options: ChunkOptions = {}): EpubChunk[] {
  const maxChars = options.maxChars ?? 12_000;
  const chunks: EpubChunk[] = [];

  for (const chapter of parsed.chapters) {
    const pieces: string[] = [];
    let current = "";

    for (const block of chapter.text.split(/\n{2,}/)) {
      const blocks = block.length > maxChars ? splitLong(block, maxChars) : [block];
      for (const b of blocks) {
        if (current && current.length + b.length + 2 > maxChars) {
          pieces.push(current);
          current = b;
        } else {
          current = current ? `${current}\n\n${b}` : b;
        }
      }
    }
    if (current) pieces.push(current);

    pieces.forEach((text, i) => {
      chunks.push({
        id: `${chapter.index}-${i + 1}`,
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        part: i + 1,
        totalParts: pieces.length,
        text,
      });
    });
  }
  return chunks;
}

function splitLong(block: string, max: number): string[] {
  const parts: string[] = [];
  let rest = block;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(". ", max);
    if (cut >= max * 0.5) {
      cut += 1; // keep the period
    } else {
      cut = rest.lastIndexOf(" ", max);
      if (cut < max * 0.5) cut = max;
    }
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/* ------------------------------------------------------------------ */
/* Table of contents                                                   */
/* ------------------------------------------------------------------ */

function parseNavDoc(html: string, baseDir: string): TocEntry[] {
  const root = parseMarkup(html);
  const navs = descendants(root, (e) => e.name === "nav");
  // `epub:type="toc"` -> attribute key is stored as "type" (namespace prefix stripped)
  const tocNav = navs.find((n) => (n.attrs["type"] ?? "").split(/\s+/).includes("toc")) ?? navs[0];
  const list = tocNav ? descendants(tocNav, (e) => e.name === "ol" || e.name === "ul")[0] : undefined;
  const out: TocEntry[] = [];
  if (list) walkNavList(list, 0, baseDir, out);
  return out;
}

function walkNavList(list: MEl, depth: number, baseDir: string, out: TocEntry[]): void {
  for (const li of childrenNamed(list, "li")) {
    const label = elementChildren(li).find((c) => c.name === "a" || c.name === "span");
    const href = label?.attrs["href"];
    const title = collapseWhitespace(label ? textContent(label) : "");
    if (title) out.push({ title, path: href ? resolvePath(baseDir, href) : null, depth });
    const sub = elementChildren(li).find((c) => c.name === "ol" || c.name === "ul");
    if (sub) walkNavList(sub, depth + 1, baseDir, out);
  }
}

function parseNcx(xml: string, baseDir: string): TocEntry[] {
  const navMap = descendants(parseMarkup(xml), (e) => e.name === "navmap")[0];
  const out: TocEntry[] = [];
  if (navMap) walkNavPoints(navMap, 0, baseDir, out);
  return out;
}

function walkNavPoints(parent: MEl, depth: number, baseDir: string, out: TocEntry[]): void {
  for (const np of childrenNamed(parent, "navpoint")) {
    const labelEl = childNamed(np, "navlabel");
    const textEl = labelEl ? childNamed(labelEl, "text") : undefined;
    const title = collapseWhitespace(textEl ? textContent(textEl) : "");
    const src = childNamed(np, "content")?.attrs["src"];
    if (title) out.push({ title, path: src ? resolvePath(baseDir, src) : null, depth });
    walkNavPoints(np, depth + 1, baseDir, out);
  }
}

/* ------------------------------------------------------------------ */
/* XHTML -> text                                                       */
/* ------------------------------------------------------------------ */

interface ExtractedContent {
  text: string;
  /** Text of the first h1-h3, used as a fallback chapter title. */
  heading: string | null;
}

const SKIP_TAGS = new Set(["script", "style", "head", "title", "svg", "nav", "noscript"]);
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "aside", "header", "footer", "main",
  "blockquote", "figure", "figcaption", "ul", "ol", "dl", "dt", "dd",
  "table", "caption", "details", "summary", "address", "form", "fieldset",
]);

function extractContent(html: string): ExtractedContent {
  const root = parseMarkup(html);
  const body = descendants(root, (e) => e.name === "body")[0] ?? root;
  const headingEl = descendants(body, (e) => /^h[1-3]$/.test(e.name))[0];
  const heading = headingEl ? collapseWhitespace(textContent(headingEl)) : "";

  const out: string[] = [];
  walkChildren(body, out);
  return { text: tidy(out.join("")), heading: heading || null };
}

function walkChildren(el: MEl, out: string[]): void {
  for (const child of el.children) walk(child, out);
}

function walk(node: MEl | MText, out: string[]): void {
  if (!isEl(node)) {
    const t = node.text.replace(/[\u00ad\u200b\ufeff]/g, "").replace(/\s+/g, " ");
    if (t) out.push(t);
    return;
  }

  const tag = node.name;
  if (SKIP_TAGS.has(tag)) return;

  switch (tag) {
    case "br":
      out.push("\n");
      return;
    case "hr":
      out.push("\n\n---\n\n");
      return;
    case "img": {
      const alt = collapseWhitespace(node.attrs["alt"] ?? "");
      if (alt) out.push(`[Image: ${alt}]`);
      return;
    }
    case "pre": {
      // Preserve indentation: code in course material matters.
      out.push("\n\n```\n" + textContent(node).replace(/\n+$/, "") + "\n```\n\n");
      return;
    }
    case "tr": {
      const cells = elementChildren(node)
        .filter((c) => c.name === "td" || c.name === "th")
        .map((c) => collapseWhitespace(textContent(c)));
      out.push("\n" + cells.join(" | "));
      return;
    }
    case "li": {
      let prefix = "- ";
      if (node.parent && node.parent.name === "ol") {
        const items = elementChildren(node.parent).filter((c) => c.name === "li");
        prefix = `${items.indexOf(node) + 1}. `;
      }
      out.push("\n" + prefix);
      walkChildren(node, out);
      return;
    }
  }

  if (/^h[1-6]$/.test(tag)) {
    out.push("\n\n" + "#".repeat(Number(tag[1])) + " ");
    walkChildren(node, out);
    out.push("\n\n");
    return;
  }

  if ((tag === "ul" || tag === "ol") && node.parent?.name === "li") {
    walkChildren(node, out); // nested list: its <li> items already start on a new line
    return;
  }

  if (BLOCK_TAGS.has(tag)) {
    out.push("\n\n");
    walkChildren(node, out);
    out.push("\n\n");
    return;
  }

  walkChildren(node, out); // inline element (span, a, em, b, sup, ...)
}

/** Trim lines and collapse blank runs, but leave code fences untouched. */
function tidy(raw: string): string {
  const lines = raw.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      out.push(line);
    } else if (inFence) {
      out.push(line.replace(/\s+$/, ""));
    } else {
      out.push(line.replace(/[ \t]+/g, " ").trim());
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ------------------------------------------------------------------ */
/* Tiny XML/XHTML parser                                               */
/* ------------------------------------------------------------------ */
/* Element and attribute names are lowercased and stripped of their    */
/* namespace prefix (dc:title -> title, epub:type -> type).            */

interface MText {
  text: string;
}
interface MEl {
  name: string;
  attrs: Record<string, string>;
  children: (MEl | MText)[];
  parent: MEl | null;
}

const isEl = (n: MEl | MText): n is MEl => "name" in n;

const VOID_TAGS = new Set([
  "br", "hr", "img", "meta", "link", "input", "area", "base", "col", "embed", "source", "track", "wbr", "param",
]);
const RAW_TEXT_TAGS = new Set(["script", "style"]);
const NAME_RE = /[A-Za-z_][^\s/>]*/y;
const ATTR_RE = /\s*([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/y;

function localName(s: string): string {
  const i = s.indexOf(":");
  return i === -1 ? s : s.slice(i + 1);
}

function parseMarkup(src: string): MEl {
  const root: MEl = { name: "#root", attrs: {}, children: [], parent: null };
  let cur = root;
  let i = 0;
  const n = src.length;
  const addText = (t: string) => {
    if (t) cur.children.push({ text: t });
  };

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      addText(decodeEntities(src.slice(i)));
      break;
    }
    if (lt > i) addText(decodeEntities(src.slice(i, lt)));
    i = lt;

    if (src.startsWith("<!--", i)) {
      const e = src.indexOf("-->", i + 4);
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const e = src.indexOf("]]>", i + 9);
      addText(src.slice(i + 9, e === -1 ? n : e));
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (src.startsWith("<?", i)) {
      const e = src.indexOf("?>", i + 2);
      i = e === -1 ? n : e + 2;
      continue;
    }
    if (src.startsWith("<!", i)) {
      // DOCTYPE (possibly with an internal [subset])
      let depth = 0;
      let j = i + 2;
      for (; j < n; j++) {
        const c = src[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }
    if (src.startsWith("</", i)) {
      const e = src.indexOf(">", i + 2);
      const end = e === -1 ? n : e;
      const name = localName(src.slice(i + 2, end).trim()).toLowerCase();
      let a: MEl | null = cur;
      while (a && a !== root && a.name !== name) a = a.parent;
      if (a && a !== root) cur = a.parent ?? root; // stray closing tags are ignored
      i = end + 1;
      continue;
    }

    NAME_RE.lastIndex = i + 1;
    const nm = NAME_RE.exec(src);
    if (!nm) {
      addText("<"); // a literal "<" that isn't a tag
      i++;
      continue;
    }
    const name = localName(nm[0]).toLowerCase();
    let pos = NAME_RE.lastIndex;
    const attrs: Record<string, string> = {};
    for (;;) {
      ATTR_RE.lastIndex = pos;
      const m = ATTR_RE.exec(src);
      if (!m) break;
      pos = ATTR_RE.lastIndex;
      attrs[localName(m[1] ?? "").toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
    }
    while (pos < n && /\s/.test(src[pos] ?? "")) pos++;
    let selfClose = false;
    if (src[pos] === "/") {
      selfClose = true;
      pos++;
    }
    const gt = src.indexOf(">", pos);
    i = gt === -1 ? n : gt + 1;

    const el: MEl = { name, attrs, children: [], parent: cur };
    cur.children.push(el);
    if (selfClose || VOID_TAGS.has(name)) continue;

    if (RAW_TEXT_TAGS.has(name)) {
      const rest = src.slice(i);
      const m = new RegExp(`</${name}\\s*>`, "i").exec(rest);
      el.children.push({ text: m ? rest.slice(0, m.index) : rest });
      i = m ? i + m.index + m[0].length : n;
      continue;
    }
    cur = el;
  }
  return root;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", shy: "\u00ad",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", lsquo: "\u2018", rsquo: "\u2019",
  ldquo: "\u201c", rdquo: "\u201d", sbquo: "\u201a", bdquo: "\u201e", bull: "\u2022",
  middot: "\u00b7", copy: "\u00a9", reg: "\u00ae", trade: "\u2122", deg: "\u00b0",
  plusmn: "\u00b1", times: "\u00d7", divide: "\u00f7", minus: "\u2212", laquo: "\u00ab",
  raquo: "\u00bb", sect: "\u00a7", para: "\u00b6", euro: "\u20ac", pound: "\u00a3",
  cent: "\u00a2", yen: "\u00a5", frac12: "\u00bd", frac14: "\u00bc", frac34: "\u00be",
  larr: "\u2190", rarr: "\u2192", uarr: "\u2191", darr: "\u2193", harr: "\u2194",
  le: "\u2264", ge: "\u2265", ne: "\u2260", infin: "\u221e", asymp: "\u2248",
  sum: "\u2211", radic: "\u221a", alpha: "\u03b1", beta: "\u03b2", gamma: "\u03b3",
  delta: "\u03b4", pi: "\u03c0", sigma: "\u03c3", mu: "\u03bc", lambda: "\u03bb",
  thinsp: "\u2009", ensp: "\u2002", emsp: "\u2003", zwj: "\u200d", zwnj: "\u200c",
};

function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (match, ent: string) => {
    if (ent[0] === "#") {
      const cp = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      try {
        return String.fromCodePoint(cp);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[ent] ?? match;
  });
}

/* tree helpers */

function elementChildren(el: MEl): MEl[] {
  return el.children.filter(isEl);
}
function childrenNamed(el: MEl, name: string): MEl[] {
  return elementChildren(el).filter((c) => c.name === name);
}
function childNamed(el: MEl, name: string): MEl | undefined {
  return elementChildren(el).find((c) => c.name === name);
}
/** All descendants matching `test`, in document order. */
function descendants(el: MEl, test: (e: MEl) => boolean, out: MEl[] = []): MEl[] {
  for (const c of el.children) {
    if (!isEl(c)) continue;
    if (test(c)) out.push(c);
    descendants(c, test, out);
  }
  return out;
}
function textContent(n: MEl | MText): string {
  return isEl(n) ? n.children.map(textContent).join("") : n.text;
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Resolve an href against the directory of the file containing it. Strips #fragment/?query, URL-decodes. */
function resolvePath(baseDir: string, href: string): string {
  const rawPath = href.split(/[#?]/)[0] ?? "";
  let clean = rawPath;
  try {
    clean = decodeURIComponent(rawPath);
  } catch {
    // malformed escape: keep the raw value
  }
  const joined = clean.startsWith("/") ? clean : baseDir ? `${baseDir}/${clean}` : clean;
  const out: string[] = [];
  for (const part of joined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function fileStem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function collapseWhitespace(s: string): string {
  return s.replace(/[\u00ad\u200b\ufeff]/g, "").replace(/\s+/g, " ").trim();
}

function countWords(s: string): number {
  const m = s.match(/\S+/g);
  return m ? m.length : 0;
}