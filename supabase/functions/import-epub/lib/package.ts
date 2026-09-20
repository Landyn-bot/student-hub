/**
 * EPUB package reading: container.xml -> OPF -> metadata, manifest, spine, table of contents.
 * The spine is the authoritative reading order; nothing outside it is treated as course content.
 */
import { ImportError } from "./errors.ts";
import type { IrMetadata, IrTocEntry } from "./ir.ts";
import {
  MEl,
  childNamed,
  childrenNamed,
  collapseWhitespace,
  descendants,
  elementChildren,
  parseMarkup,
  textContent,
} from "./markup.ts";
import type { ZipArchive } from "./zip.ts";

export interface SpineItem {
  id: string;
  path: string;
  mediaType: string;
  linear: boolean;
}

export interface PackageInfo {
  opfPath: string;
  metadata: IrMetadata;
  toc: IrTocEntry[];
  spine: SpineItem[];
  warnings: string[];
}

const HTML_TYPES = new Set(["application/xhtml+xml", "text/html"]);
/** Font obfuscation is not DRM: the text itself stays readable. */
const BENIGN_ENCRYPTION = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Resolve an href against the folder of the file that contains it, staying inside the archive. */
export function resolvePath(baseDir: string, href: string): string {
  const rawPath = href.split(/[#?]/)[0] ?? "";
  let clean = rawPath;
  try {
    clean = decodeURIComponent(rawPath);
  } catch {
    // keep the raw value when the escape is malformed
  }
  const joined = clean.startsWith("/") ? clean : baseDir ? `${baseDir}/${clean}` : clean;
  const out: string[] = [];
  for (const part of joined.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export async function readPackage(zip: ZipArchive): Promise<PackageInfo> {
  const warnings: string[] = [];

  if (!zip.has("META-INF/container.xml")) {
    throw new ImportError("invalid_epub", "That file is not a readable EPUB (no container.xml).");
  }
  const containerXml = await zip.readText("META-INF/container.xml", 1024 * 1024);
  const rootfiles = descendants(parseMarkup(containerXml), (e) => e.name === "rootfile");
  const rootfile =
    rootfiles.find((r) => /oebps-package\+xml/.test(r.attrs["media-type"] ?? "")) ?? rootfiles[0];
  const opfPath = rootfile?.attrs["full-path"] ? resolvePath("", rootfile.attrs["full-path"]) : "";
  if (!opfPath) {
    throw new ImportError("invalid_epub", "That file is not a readable EPUB (no package file).");
  }
  if (!zip.has(opfPath)) {
    throw new ImportError("invalid_epub", "The EPUB's package file is missing.");
  }

  const opfXml = await zip.readText(opfPath, 4 * 1024 * 1024);
  const pkg = descendants(parseMarkup(opfXml), (e) => e.name === "package")[0];
  if (!pkg) throw new ImportError("invalid_epub", "The EPUB's package file is malformed.");
  const opfDir = dirname(opfPath);

  const md = childNamed(pkg, "metadata");
  const mdTexts = (name: string): string[] =>
    md
      ? childrenNamed(md, name)
          .map((e) => collapseWhitespace(textContent(e)))
          .filter(Boolean)
      : [];
  const metadata: IrMetadata = {
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
      mediaType: (it.attrs["media-type"] ?? "").toLowerCase(),
      properties: (it.attrs["properties"] ?? "").split(/\s+/).filter(Boolean),
    });
  }

  const spineEl = childNamed(pkg, "spine");
  if (!spineEl) throw new ImportError("invalid_epub", "The EPUB has no reading order (spine).");

  const encrypted = await readEncryptedPaths(zip);

  const spine: SpineItem[] = [];
  for (const ref of childrenNamed(spineEl, "itemref")) {
    const item = manifest.get(ref.attrs["idref"] ?? "");
    if (!item || item.properties.includes("nav")) continue;
    const isHtml =
      HTML_TYPES.has(item.mediaType) || (!item.mediaType && /\.x?html?$/i.test(item.path));
    if (!isHtml) continue;
    if (encrypted.has(item.path)) {
      throw new ImportError("drm_protected", "This EPUB is DRM-protected and cannot be read.");
    }
    spine.push({
      id: item.id,
      path: item.path,
      mediaType: item.mediaType,
      linear: (ref.attrs["linear"] ?? "yes").toLowerCase() !== "no",
    });
  }
  if (spine.length === 0) {
    throw new ImportError("invalid_epub", "The EPUB's reading order lists no readable pages.");
  }

  let toc: IrTocEntry[] = [];
  try {
    const navItem = [...manifest.values()].find((m) => m.properties.includes("nav"));
    if (navItem && zip.has(navItem.path)) {
      toc = parseNavDoc(await zip.readText(navItem.path, 2 * 1024 * 1024), dirname(navItem.path));
    }
    if (toc.length === 0) {
      const ncxId = spineEl.attrs["toc"];
      const ncxItem =
        (ncxId ? manifest.get(ncxId) : undefined) ??
        [...manifest.values()].find((m) => m.mediaType === "application/x-dtbncx+xml");
      if (ncxItem && zip.has(ncxItem.path)) {
        toc = parseNcx(await zip.readText(ncxItem.path, 2 * 1024 * 1024), dirname(ncxItem.path));
      }
    }
  } catch (error) {
    if (error instanceof ImportError && error.code === "unsafe_archive") throw error;
    warnings.push("The table of contents could not be read; section names come from headings.");
  }

  return { opfPath, metadata, toc, spine, warnings };
}

async function readEncryptedPaths(zip: ZipArchive): Promise<Set<string>> {
  const out = new Set<string>();
  if (!zip.has("META-INF/encryption.xml")) return out;
  let xml: string;
  try {
    xml = await zip.readText("META-INF/encryption.xml", 1024 * 1024);
  } catch {
    return out;
  }
  for (const data of descendants(parseMarkup(xml), (e) => e.name === "encrypteddata")) {
    const algorithm = descendants(data, (e) => e.name === "encryptionmethod")[0]?.attrs[
      "algorithm"
    ];
    if (algorithm && BENIGN_ENCRYPTION.has(algorithm)) continue;
    const uri = descendants(data, (e) => e.name === "cipherreference")[0]?.attrs["uri"];
    if (uri) out.add(resolvePath("", uri));
  }
  return out;
}

function parseNavDoc(html: string, baseDir: string): IrTocEntry[] {
  const navs = descendants(parseMarkup(html), (e) => e.name === "nav");
  const tocNav = navs.find((n) => (n.attrs["type"] ?? "").split(/\s+/).includes("toc")) ?? navs[0];
  const list = tocNav
    ? descendants(tocNav, (e) => e.name === "ol" || e.name === "ul")[0]
    : undefined;
  const out: IrTocEntry[] = [];
  if (list) walkNavList(list, 0, baseDir, out);
  return out;
}

function walkNavList(list: MEl, depth: number, baseDir: string, out: IrTocEntry[]): void {
  for (const li of childrenNamed(list, "li")) {
    const label = elementChildren(li).find((c) => c.name === "a" || c.name === "span");
    const href = label?.attrs["href"];
    const title = collapseWhitespace(label ? textContent(label) : "");
    if (title) out.push({ title, path: href ? resolvePath(baseDir, href) : null, depth });
    const sub = elementChildren(li).find((c) => c.name === "ol" || c.name === "ul");
    if (sub) walkNavList(sub, depth + 1, baseDir, out);
  }
}

function parseNcx(xml: string, baseDir: string): IrTocEntry[] {
  const navMap = descendants(parseMarkup(xml), (e) => e.name === "navmap")[0];
  const out: IrTocEntry[] = [];
  if (navMap) walkNavPoints(navMap, 0, baseDir, out);
  return out;
}

function walkNavPoints(parent: MEl, depth: number, baseDir: string, out: IrTocEntry[]): void {
  for (const np of childrenNamed(parent, "navpoint")) {
    const labelEl = childNamed(np, "navlabel");
    const textEl = labelEl ? childNamed(labelEl, "text") : undefined;
    const title = collapseWhitespace(textEl ? textContent(textEl) : "");
    const src = childNamed(np, "content")?.attrs["src"];
    if (title) out.push({ title, path: src ? resolvePath(baseDir, src) : null, depth });
    walkNavPoints(np, depth + 1, baseDir, out);
  }
}
