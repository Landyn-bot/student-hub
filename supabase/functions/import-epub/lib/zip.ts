/**
 * Minimal, defensive ZIP reader.
 *
 * An uploaded EPUB is untrusted input. This reader never trusts the archive's own claims:
 *  - the central directory is bounds-checked before anything is read;
 *  - entry names are validated (no traversal, no absolute paths, no duplicates);
 *  - declared sizes and compression ratios are checked BEFORE inflating;
 *  - inflation itself is capped by streaming, so a lying header cannot exhaust memory;
 *  - the CRC-32 of every inflated entry is verified.
 * Only stored (0) and deflate (8) entries are supported; ZIP64 and encryption are rejected.
 */
import { ImportError } from "./errors.ts";

export interface ZipLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  /** Largest single entry we will inflate. */
  maxEntryBytes: number;
  /** Sum of everything inflated over the life of one archive. */
  maxTotalInflatedBytes: number;
  /** Compressed-to-inflated ratio above which an entry over 1 MB is treated as a bomb. */
  maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxArchiveBytes: 30 * 1024 * 1024,
  maxEntries: 5_000,
  maxEntryBytes: 8 * 1024 * 1024,
  maxTotalInflatedBytes: 48 * 1024 * 1024,
  maxRatio: 200,
};

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const MB = 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Returns a normalised entry name, or throws when the name could escape the archive root. */
export function safeEntryName(raw: string): string {
  if (raw.includes("\0")) {
    throw new ImportError("unsafe_archive", "The file contains an invalid entry name.");
  }
  const name = raw.replace(/\\/g, "/");
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new ImportError("unsafe_archive", "The file contains an absolute path.");
  }
  const parts = name.split("/");
  if (parts.some((part) => part === "..")) {
    throw new ImportError("unsafe_archive", "The file contains a path that escapes the archive.");
  }
  return (
    parts.filter((part) => part !== "." && part !== "").join("/") + (name.endsWith("/") ? "/" : "")
  );
}

export class ZipArchive {
  private inflated = 0;
  private readonly lower = new Map<string, string>();

  private constructor(
    private readonly bytes: Uint8Array,
    private readonly view: DataView,
    private readonly entries: Map<string, ZipEntry>,
    private readonly limits: ZipLimits,
  ) {
    for (const name of entries.keys()) {
      const key = name.toLowerCase();
      if (!this.lower.has(key)) this.lower.set(key, name);
    }
  }

  static open(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipArchive {
    if (bytes.byteLength > limits.maxArchiveBytes) {
      throw new ImportError(
        "file_too_large",
        `That file is larger than ${Math.round(limits.maxArchiveBytes / MB)} MB.`,
      );
    }
    if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new ImportError("not_zip", "That file is not an EPUB (it is not a zip archive).");
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let eocd = -1;
    const lowest = Math.max(0, bytes.byteLength - 22 - 0xffff);
    for (let i = bytes.byteLength - 22; i >= lowest; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) {
      throw new ImportError("invalid_epub", "That file is not a readable EPUB (no zip directory).");
    }

    const total = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new ImportError("invalid_epub", "ZIP64 archives are not supported.");
    }
    if (total > limits.maxEntries) {
      throw new ImportError("unsafe_archive", "The file contains too many entries.");
    }
    if (cdOffset + cdSize > eocd || cdOffset > bytes.byteLength) {
      throw new ImportError("invalid_epub", "The zip directory is damaged.");
    }

    const decoder = new TextDecoder("utf-8");
    const entries = new Map<string, ZipEntry>();
    let declaredTotal = 0;
    let p = cdOffset;

    for (let i = 0; i < total; i++) {
      if (p + 46 > cdOffset + cdSize || view.getUint32(p, true) !== CEN_SIG) {
        throw new ImportError("invalid_epub", "The zip directory is damaged.");
      }
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const crc = view.getUint32(p + 16, true);
      const compressedSize = view.getUint32(p + 20, true);
      const size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOffset = view.getUint32(p + 42, true);
      const next = p + 46 + nameLen + extraLen + commentLen;
      if (next > cdOffset + cdSize) {
        throw new ImportError("invalid_epub", "The zip directory is damaged.");
      }

      const name = safeEntryName(decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)));
      p = next;
      if (name === "" || name.endsWith("/")) continue;

      if (entries.has(name)) {
        throw new ImportError("unsafe_archive", "The file contains duplicate entries.");
      }
      declaredTotal += size;
      if (declaredTotal > limits.maxTotalInflatedBytes * 16) {
        throw new ImportError("unsafe_archive", "The file expands to an unreasonable size.");
      }
      entries.set(name, { name, method, flags, crc32: crc, compressedSize, size, localOffset });
    }

    return new ZipArchive(bytes, view, entries, limits);
  }

  has(name: string): boolean {
    return this.resolve(name) !== null;
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** Exact match first, then a case-insensitive fallback (EPUB hrefs are sometimes sloppy). */
  private resolve(name: string): ZipEntry | null {
    const exact = this.entries.get(name);
    if (exact) return exact;
    const alt = this.lower.get(name.toLowerCase());
    return alt ? (this.entries.get(alt) ?? null) : null;
  }

  async readBytes(name: string, maxBytes: number = this.limits.maxEntryBytes): Promise<Uint8Array> {
    const entry = this.resolve(name);
    if (!entry) throw new ImportError("invalid_epub", "A file listed in the book is missing.");

    if (entry.flags & 0x1 || entry.flags & 0x40) {
      throw new ImportError("drm_protected", "This file is password-protected or encrypted.");
    }
    if (entry.method !== 0 && entry.method !== 8) {
      throw new ImportError("invalid_epub", "The file uses an unsupported compression method.");
    }
    const cap = Math.min(maxBytes, this.limits.maxEntryBytes);
    if (entry.size > cap) {
      throw new ImportError("unsafe_archive", "A file inside the EPUB is unreasonably large.");
    }
    if (
      entry.method === 8 &&
      entry.size > MB &&
      entry.size / Math.max(entry.compressedSize, 1) > this.limits.maxRatio
    ) {
      throw new ImportError("unsafe_archive", "The file looks like a compression bomb.");
    }
    if (this.inflated + entry.size > this.limits.maxTotalInflatedBytes) {
      throw new ImportError("unsafe_archive", "The EPUB's text content is unreasonably large.");
    }

    const lo = entry.localOffset;
    if (lo + 30 > this.bytes.byteLength || this.view.getUint32(lo, true) !== LOC_SIG) {
      throw new ImportError("invalid_epub", "The zip directory is damaged.");
    }
    const start = lo + 30 + this.view.getUint16(lo + 26, true) + this.view.getUint16(lo + 28, true);
    const end = start + entry.compressedSize;
    if (end > this.bytes.byteLength) {
      throw new ImportError("invalid_epub", "The zip file is truncated.");
    }
    const raw = this.bytes.subarray(start, end);

    let out: Uint8Array;
    if (entry.method === 0) {
      if (raw.byteLength !== entry.size) {
        throw new ImportError("invalid_epub", "The zip directory is inconsistent.");
      }
      out = raw.slice();
    } else {
      out = await inflateRaw(raw, entry.size);
    }

    if (crc32(out) !== entry.crc32) {
      throw new ImportError("invalid_epub", "A file inside the EPUB is corrupt.");
    }
    this.inflated += out.byteLength;
    return out;
  }

  async readText(name: string, maxBytes?: number): Promise<string> {
    const data = await this.readBytes(name, maxBytes);
    return new TextDecoder("utf-8").decode(data).replace(/^﻿/, "");
  }
}

/** Inflate exactly `expected` bytes; abort the moment the stream produces more. */
async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const out = new Uint8Array(expected);
  let written = 0;
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (written + value.byteLength > expected) {
        await reader.cancel().catch(() => {});
        throw new ImportError("unsafe_archive", "A file inside the EPUB expands beyond its size.");
      }
      out.set(value, written);
      written += value.byteLength;
    }
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("invalid_epub", "A file inside the EPUB is corrupt.");
  }
  if (written !== expected) {
    throw new ImportError("invalid_epub", "A file inside the EPUB is corrupt.");
  }
  return out;
}
