/**
 * Small, dependency-free XML/XHTML reader.
 *
 * Element and attribute names are lower-cased and stripped of their namespace prefix
 * (dc:title -> title, epub:type -> type). It never expands entities beyond a fixed list, never
 * fetches anything, and skips DOCTYPE subsets, so external-entity and entity-expansion attacks
 * have nothing to act on. Nesting depth and node count are capped so hostile markup cannot
 * exhaust the stack or memory.
 */
import { ImportError } from "./errors.ts";

export interface MText {
  text: string;
}

export interface MEl {
  name: string;
  attrs: Record<string, string>;
  children: (MEl | MText)[];
  parent: MEl | null;
  depth: number;
}

export const MAX_DEPTH = 128;
export const MAX_NODES = 400_000;

export const isEl = (n: MEl | MText): n is MEl => "name" in n;

const VOID_TAGS = new Set([
  "br",
  "hr",
  "img",
  "meta",
  "link",
  "input",
  "area",
  "base",
  "col",
  "embed",
  "source",
  "track",
  "wbr",
  "param",
]);
const RAW_TEXT_TAGS = new Set(["script", "style"]);
const NAME_RE = /[A-Za-z_][^\s/>]*/y;
const ATTR_RE = /\s*([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/y;

export function localName(s: string): string {
  const i = s.indexOf(":");
  return i === -1 ? s : s.slice(i + 1);
}

export function parseMarkup(src: string): MEl {
  const root: MEl = { name: "#root", attrs: {}, children: [], parent: null, depth: 0 };
  let cur = root;
  let i = 0;
  let nodes = 0;
  const n = src.length;

  const bump = () => {
    if (++nodes > MAX_NODES) {
      throw new ImportError("unsafe_archive", "A page in the EPUB is unreasonably complex.");
    }
  };
  const addText = (t: string) => {
    if (!t) return;
    bump();
    cur.children.push({ text: t });
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
      if (a && a !== root) cur = a.parent ?? root;
      i = end + 1;
      continue;
    }

    NAME_RE.lastIndex = i + 1;
    const nm = NAME_RE.exec(src);
    if (!nm) {
      addText("<");
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

    bump();
    const el: MEl = { name, attrs, children: [], parent: cur, depth: cur.depth + 1 };
    cur.children.push(el);
    if (selfClose || VOID_TAGS.has(name)) continue;

    if (RAW_TEXT_TAGS.has(name)) {
      const closer = new RegExp(`</${name}\\s*>`, "gi");
      closer.lastIndex = i;
      const m = closer.exec(src);
      el.children.push({ text: src.slice(i, m ? m.index : n) });
      i = m ? m.index + m[0].length : n;
      continue;
    }

    // Past the depth cap the element is kept as a leaf; its content flows into the parent.
    if (el.depth >= MAX_DEPTH) continue;
    cur = el;
  }
  return root;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "­",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  sbquo: "‚",
  bdquo: "„",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  minus: "−",
  laquo: "«",
  raquo: "»",
  sect: "§",
  para: "¶",
  euro: "€",
  pound: "£",
  cent: "¢",
  yen: "¥",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
  le: "≤",
  ge: "≥",
  ne: "≠",
  infin: "∞",
  asymp: "≈",
  sum: "∑",
  radic: "√",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  pi: "π",
  sigma: "σ",
  mu: "μ",
  lambda: "λ",
  thinsp: " ",
  ensp: " ",
  emsp: " ",
  zwj: "‍",
  zwnj: "‌",
};

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (match, ent: string) => {
    if (ent[0] === "#") {
      const cp =
        ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      try {
        return String.fromCodePoint(cp);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[ent] ?? match;
  });
}

export function elementChildren(el: MEl): MEl[] {
  return el.children.filter(isEl);
}
export function childrenNamed(el: MEl, name: string): MEl[] {
  return elementChildren(el).filter((c) => c.name === name);
}
export function childNamed(el: MEl, name: string): MEl | undefined {
  return elementChildren(el).find((c) => c.name === name);
}
/** All descendants matching `test`, in document order. */
export function descendants(el: MEl, test: (e: MEl) => boolean, out: MEl[] = []): MEl[] {
  for (const c of el.children) {
    if (!isEl(c)) continue;
    if (test(c)) out.push(c);
    descendants(c, test, out);
  }
  return out;
}
export function textContent(n: MEl | MText): string {
  return isEl(n) ? n.children.map(textContent).join("") : n.text;
}
export function collapseWhitespace(s: string): string {
  return s.replace(/[­​﻿]/g, "").replace(/\s+/g, " ").trim();
}
