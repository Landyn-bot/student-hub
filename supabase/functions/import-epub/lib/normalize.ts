/**
 * XHTML -> blocks -> chunks.
 *
 * Deterministic conversion of a page into ordered blocks (headings, paragraphs, list items,
 * table rows, code) and of a whole book into model-sized chunks. Chunks never cross a page
 * boundary, break on block boundaries, carry the heading breadcrumb they sit under, and repeat
 * a table's header row when a table is split across chunks.
 */
import type { IrBlock, IrChunk, IrDocument } from "./ir.ts";
import {
  type MEl,
  type MText,
  collapseWhitespace,
  descendants,
  elementChildren,
  isEl,
  parseMarkup,
  textContent,
} from "./markup.ts";

const SKIP_TAGS = new Set(["script", "style", "head", "title", "svg", "nav", "noscript", "iframe"]);
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "main",
  "blockquote",
  "figure",
  "figcaption",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "table",
  "caption",
  "details",
  "summary",
  "address",
  "form",
  "fieldset",
  "thead",
  "tbody",
  "tfoot",
]);

export interface ExtractedPage {
  blocks: IrBlock[];
  /** First h1-h3 on the page, used when the table of contents has no title for it. */
  heading: string | null;
}

export function extractBlocks(html: string): ExtractedPage {
  const root = parseMarkup(html);
  const body = descendants(root, (e) => e.name === "body")[0] ?? root;
  const headingEl = descendants(body, (e) => /^h[1-3]$/.test(e.name))[0];
  const heading = headingEl ? collapseWhitespace(textContent(headingEl)) : "";

  const blocks: IrBlock[] = [];
  let buffer = "";
  let tableSeq = 0;

  const flush = () => {
    const text = collapseWhitespace(buffer);
    buffer = "";
    if (text) blocks.push({ type: "paragraph", text });
  };

  const walk = (node: MEl | MText, listDepth: number, tableId: number | null): void => {
    if (!isEl(node)) {
      buffer += node.text;
      return;
    }
    const tag = node.name;
    if (SKIP_TAGS.has(tag)) return;

    if (tag === "br") {
      flush();
      return;
    }
    if (tag === "hr") {
      flush();
      return;
    }
    if (tag === "img") {
      const alt = collapseWhitespace(node.attrs["alt"] ?? "");
      if (alt) buffer += ` [Image: ${alt}] `;
      return;
    }
    if (tag === "pre") {
      flush();
      const code = textContent(node).replace(/\n+$/, "");
      if (code.trim()) blocks.push({ type: "code", text: code });
      return;
    }
    if (/^h[1-6]$/.test(tag)) {
      flush();
      const text = collapseWhitespace(textContent(node));
      if (text) blocks.push({ type: "heading", level: Number(tag[1]), text });
      return;
    }
    if (tag === "table") {
      flush();
      const id = ++tableSeq;
      for (const child of node.children) walk(child, listDepth, id);
      flush();
      return;
    }
    if (tag === "tr") {
      flush();
      const cells = elementChildren(node).filter((c) => c.name === "td" || c.name === "th");
      const texts = cells.map((c) => collapseWhitespace(textContent(c)));
      const text = texts.join(" | ").replace(/^(\s*\|\s*)+$/, "");
      if (text.trim()) {
        const isHeader = cells.length > 0 && cells.every((c) => c.name === "th");
        blocks.push({
          type: "table_row",
          text,
          isHeader,
          ...(tableId !== null ? { tableId } : {}),
        });
      }
      return;
    }
    if (tag === "li") {
      flush();
      const parent = node.parent;
      let marker = "- ";
      if (parent && parent.name === "ol") {
        const items = elementChildren(parent).filter((c) => c.name === "li");
        marker = `${items.indexOf(node) + 1}. `;
      }
      // Text directly inside the item is one block; nested lists become their own blocks.
      for (const child of node.children) {
        if (isEl(child) && (child.name === "ul" || child.name === "ol")) {
          flushListItem(marker, listDepth);
          walk(child, listDepth + 1, tableId);
        } else {
          walk(child, listDepth, tableId);
        }
      }
      flushListItem(marker, listDepth);
      return;
    }

    if (BLOCK_TAGS.has(tag)) {
      flush();
      for (const child of node.children) walk(child, listDepth, tableId);
      flush();
      return;
    }
    for (const child of node.children) walk(child, listDepth, tableId);
  };

  const flushListItem = (marker: string, depth: number) => {
    const text = collapseWhitespace(buffer);
    buffer = "";
    if (text) blocks.push({ type: "list_item", level: depth, marker, text });
  };

  for (const child of body.children) walk(child, 0, null);
  flush();

  const cleaned: IrBlock[] = [];
  for (const block of blocks) {
    const text = block.type === "code" ? block.text : stripCanvasNoise(block.text);
    if (text) cleaned.push({ ...block, text });
  }
  return { blocks: cleaned, heading: stripCanvasNoise(heading) || null };
}

/** Plain text (pasted or from a text file) -> blocks. Markdown-style `#` headings are honoured. */
export function blocksFromText(text: string): IrBlock[] {
  const blocks: IrBlock[] = [];
  for (const raw of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const para = raw.trim();
    if (!para) continue;
    const lines = para.split("\n");
    let run: string[] = [];
    const flush = () => {
      const joined = collapseWhitespace(run.join(" "));
      if (joined) blocks.push({ type: "paragraph", text: joined });
      run = [];
    };
    for (const line of lines) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
      if (heading) {
        flush();
        blocks.push({
          type: "heading",
          level: heading[1]!.length,
          text: collapseWhitespace(heading[2]!),
        });
        continue;
      }
      const item = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
      if (item) {
        flush();
        blocks.push({
          type: "list_item",
          level: 0,
          marker: "- ",
          text: collapseWhitespace(item[1]!),
        });
        continue;
      }
      run.push(line);
    }
    flush();
  }
  return blocks;
}

/**
 * Canvas replaces every attached file with a sentence saying it could not be included. Left in,
 * it buries the real title of an item and gets quoted back as if it were course content.
 */
const CANVAS_FILE_NOTICE =
  /\s*\[?\s*File\s+\S[^|\n]*?could not be included in the ePub document\.\s*Please see separate zip file for access\.?\s*\]?/gi;

export function stripCanvasNoise(text: string): string {
  return text
    .replace(CANVAS_FILE_NOTICE, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function renderBlock(block: IrBlock): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level ?? 1)} ${block.text}`;
    case "list_item":
      return `${"  ".repeat(block.level ?? 0)}${block.marker ?? "- "}${block.text}`;
    case "code":
      return "```\n" + block.text + "\n```";
    default:
      return block.text;
  }
}

export function countWords(s: string): number {
  return s.match(/\S+/g)?.length ?? 0;
}

interface ChunkOptions {
  maxChars: number;
}

/** Splits a block that is longer than the limit on sentence, then word, boundaries. */
function splitLong(text: string, max: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(". ", max);
    if (cut >= max * 0.5) {
      cut += 1;
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

export function buildChunks(documents: IrDocument[], options: ChunkOptions): IrChunk[] {
  const chunks: IrChunk[] = [];

  for (const doc of documents) {
    interface Line {
      text: string;
      section: string;
      tableId: number | undefined;
      headerText: string | undefined;
    }
    const lines: Line[] = [];
    const stack: { level: number; text: string }[] = [];
    const headerByTable = new Map<number, string>();

    for (const block of doc.blocks) {
      if (block.type === "heading") {
        const level = block.level ?? 1;
        while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
        stack.push({ level, text: block.text });
      }
      const crumbs = [doc.title, ...stack.map((s) => s.text)].filter(
        (t, i, all) => t && (i === 0 || t !== all[i - 1]),
      );
      const section = crumbs.join(" › ");

      if (block.type === "table_row" && block.tableId !== undefined && block.isHeader) {
        headerByTable.set(block.tableId, renderBlock(block));
      }
      const rendered = renderBlock(block);
      const pieces =
        rendered.length > options.maxChars ? splitLong(rendered, options.maxChars) : [rendered];
      for (const piece of pieces) {
        lines.push({
          text: piece,
          section,
          tableId: block.type === "table_row" ? block.tableId : undefined,
          headerText:
            block.type === "table_row" && block.tableId !== undefined && !block.isHeader
              ? headerByTable.get(block.tableId)
              : undefined,
        });
      }
    }

    const groups: { text: string; sections: { offset: number; section: string }[] }[] = [];
    let text = "";
    let sections: { offset: number; section: string }[] = [];
    let lastTable: number | undefined;

    const startGroup = () => {
      if (text) groups.push({ text, sections });
      text = "";
      sections = [];
      lastTable = undefined;
    };

    for (const line of lines) {
      const sep = text
        ? line.tableId !== undefined && line.tableId === lastTable
          ? "\n"
          : "\n\n"
        : "";
      if (text && text.length + sep.length + line.text.length > options.maxChars) startGroup();

      // A table row that starts a new chunk gets its header row back for context.
      if (!text && line.headerText && line.headerText !== line.text) {
        sections.push({ offset: 0, section: line.section });
        text = line.headerText;
        lastTable = line.tableId;
      }
      const joiner = text
        ? line.tableId !== undefined && line.tableId === lastTable
          ? "\n"
          : "\n\n"
        : "";
      sections.push({ offset: text.length + joiner.length, section: line.section });
      text = text + joiner + line.text;
      lastTable = line.tableId;
    }
    startGroup();

    groups.forEach((group, i) => {
      chunks.push({
        id: `${doc.index}-${i + 1}`,
        documentIndex: doc.index,
        documentTitle: doc.title,
        documentPath: doc.path,
        section: group.sections[0]?.section ?? doc.title,
        sections: group.sections,
        part: i + 1,
        totalParts: groups.length,
        text: group.text,
      });
    });
  }
  return chunks;
}

/** Lower-cased letters and digits only, so quotes survive markdown, spacing and punctuation drift. */
export function looseKey(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function looseIncludes(haystack: string, needle: string): boolean {
  const n = looseKey(needle);
  return n.length >= 6 && looseKey(haystack).includes(n);
}

/** The heading breadcrumb of the block a quote came from, falling back to the chunk's own. */
export function sectionForQuote(chunk: IrChunk, quote: string): string {
  if (!quote.trim()) return chunk.section;
  const marks = chunk.sections;
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i]!.offset;
    const to = marks[i + 1]?.offset ?? chunk.text.length;
    if (looseIncludes(chunk.text.slice(from, to), quote)) return marks[i]!.section;
  }
  return chunk.section;
}
