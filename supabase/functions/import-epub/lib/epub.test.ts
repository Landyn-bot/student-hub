import assert from "node:assert/strict";

import { buildEpub, buildZip, SAMPLE_PAGES, xhtml } from "../testutil.ts";
import { ImportError } from "./errors.ts";
import { normalizeText, parseEpub } from "./epub.ts";
import { looseIncludes, sectionForQuote } from "./normalize.ts";
import { ZipArchive, DEFAULT_ZIP_LIMITS, safeEntryName } from "./zip.ts";

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ImportError, `expected ImportError, got ${String(error)}`);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`expected rejection with ${code}`);
}

Deno.test("parses a Canvas-style EPUB in spine order with section breadcrumbs", async () => {
  const bytes = await buildEpub();
  const ir = await parseEpub(bytes, { filename: "psyc.epub" });

  assert.equal(ir.source.kind, "epub");
  assert.equal(ir.source.sha256.length, 64);
  assert.equal(ir.metadata.title, "PSYC_1010_SEC01");
  assert.equal(ir.stats.documents, 2);
  const text = ir.chunks.map((c) => c.text).join("\n\n");
  assert.ok(text.indexOf("Late assignments lose 10%") < text.indexOf("Midterm Exam"));
  assert.ok(text.includes("# PSYC 1010: Intro to Psychology"));

  const first = ir.chunks[0]!;
  const quote = "Late assignments lose 10% per day";
  assert.equal(
    sectionForQuote(first, quote),
    "Course Syllabus › PSYC 1010: Intro to Psychology › Late Work",
  );
});

Deno.test("respects a reordered spine rather than file order", async () => {
  const bytes = await buildEpub(SAMPLE_PAGES, [], { spineOrder: [1, 0] });
  const ir = await parseEpub(bytes, { filename: "x.epub" });
  const text = ir.chunks.map((c) => c.text).join("\n\n");
  assert.ok(text.indexOf("Weekly Schedule") < text.indexOf("Late Work"));
});

Deno.test("repeats the table header row when a table is split across chunks", async () => {
  const rows = Array.from(
    { length: 60 },
    (_, i) =>
      `<tr><td>${i + 1}</td><td>Oct ${(i % 28) + 1}</td><td>Reading ${i + 1} with some long descriptive text</td></tr>`,
  ).join("");
  const bytes = await buildEpub([
    {
      file: "big.xhtml",
      title: "Big",
      body: `<table><thead><tr><th>Week</th><th>Due</th><th>Item</th></tr></thead><tbody>${rows}</tbody></table>`,
    },
  ]);
  const ir = await parseEpub(bytes, { filename: "big.epub", maxChunkChars: 600 });
  assert.ok(ir.chunks.length > 2);
  for (const chunk of ir.chunks) {
    assert.ok(chunk.text.startsWith("Week | Due | Item"), `chunk ${chunk.id} lost its header`);
  }
});

Deno.test("rejects non-zip, truncated and directory-less files", async () => {
  await rejects(
    parseEpub(new TextEncoder().encode("hello world, not a zip"), { filename: "a" }),
    "not_zip",
  );
  const good = await buildEpub();
  await rejects(parseEpub(good.subarray(0, 60), { filename: "a" }), "invalid_epub");
  await rejects(parseEpub(good.subarray(0, good.length - 30), { filename: "a" }), "invalid_epub");
});

Deno.test("rejects a zip that is not an EPUB", async () => {
  const bytes = await buildZip([{ name: "readme.txt", data: "hi" }]);
  await rejects(parseEpub(bytes, { filename: "a" }), "invalid_epub");
});

Deno.test("rejects path traversal and absolute entry names", async () => {
  await rejects(
    parseEpub(await buildZip([{ name: "../../etc/passwd", data: "x" }]), { filename: "a" }),
    "unsafe_archive",
  );
  await rejects(
    parseEpub(await buildZip([{ name: "/etc/passwd", data: "x" }]), { filename: "a" }),
    "unsafe_archive",
  );
  assert.throws(() => safeEntryName("a\0b"), ImportError);
  assert.equal(safeEntryName("OEBPS\\a.xhtml"), "OEBPS/a.xhtml");
});

Deno.test("rejects duplicate entries", async () => {
  const bytes = await buildZip([
    { name: "a.txt", data: "1" },
    { name: "a.txt", data: "2" },
  ]);
  assert.throws(() => ZipArchive.open(bytes), ImportError);
});

Deno.test("blocks a compression bomb by declared size and by ratio", async () => {
  const zeros = new Uint8Array(20 * 1024 * 1024);
  const big = await buildZip([{ name: "bomb.bin", data: zeros }]);
  const zip = ZipArchive.open(big);
  await rejects(zip.readBytes("bomb.bin"), "unsafe_archive");

  // Under the per-entry cap but still an absurd ratio.
  const dense = await buildZip([{ name: "dense.bin", data: new Uint8Array(6 * 1024 * 1024) }]);
  await rejects(ZipArchive.open(dense).readBytes("dense.bin"), "unsafe_archive");
});

Deno.test("aborts inflation when the header lies about the size", async () => {
  const payload = new TextEncoder().encode("A".repeat(200_000));
  const bytes = await buildZip([{ name: "lie.txt", data: payload, declaredSize: 100 }]);
  await rejects(ZipArchive.open(bytes).readBytes("lie.txt"), "unsafe_archive");
});

Deno.test("enforces the total inflated budget across entries", async () => {
  const bytes = await buildZip([
    { name: "a.txt", data: "x".repeat(400_000) },
    { name: "b.txt", data: "y".repeat(400_000) },
  ]);
  const zip = ZipArchive.open(bytes, { ...DEFAULT_ZIP_LIMITS, maxTotalInflatedBytes: 500_000 });
  await zip.readBytes("a.txt");
  await rejects(zip.readBytes("b.txt"), "unsafe_archive");
});

Deno.test("detects corrupted content through the CRC", async () => {
  const bytes = await buildZip([{ name: "a.txt", data: "hello world", method: 0 }]);
  const idx = bytes.findIndex(
    (_, i) => bytes[i] === 0x68 && bytes[i + 1] === 0x65 && bytes[i + 2] === 0x6c,
  );
  bytes[idx] = 0x48;
  await rejects(ZipArchive.open(bytes).readBytes("a.txt"), "invalid_epub");
});

Deno.test("rejects encrypted zip entries and DRM-protected pages", async () => {
  const enc = await buildZip([{ name: "a.txt", data: "hi", method: 0, flags: 0x0801 }]);
  await rejects(ZipArchive.open(enc).readBytes("a.txt"), "drm_protected");

  const drm = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
    <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/syllabus.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`;
  await rejects(
    parseEpub(await buildEpub(SAMPLE_PAGES, [], { encryption: drm }), { filename: "a" }),
    "drm_protected",
  );

  const fonts = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
    <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/fonts/a.otf"/></enc:CipherData></enc:EncryptedData></encryption>`;
  const ok = await parseEpub(await buildEpub(SAMPLE_PAGES, [], { encryption: fonts }), {
    filename: "a",
  });
  assert.equal(ok.stats.documents, 2);
});

Deno.test("survives pathologically nested markup without overflowing the stack", async () => {
  const nested = "<div>".repeat(50_000) + "Quiz 1 is due Sept 9" + "</div>".repeat(50_000);
  const bytes = await buildEpub([{ file: "deep.xhtml", title: "Deep", body: nested }]);
  const ir = await parseEpub(bytes, { filename: "deep.epub" });
  assert.ok(ir.chunks[0]!.text.includes("Quiz 1 is due Sept 9"));
});

Deno.test("does not expand entities, so an XXE / billion-laughs page stays inert", async () => {
  const evil = `<?xml version="1.0"?><!DOCTYPE html [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>
<html><body><p>Homework due Sept 9 &xxe; &b;</p></body></html>`;
  const ir = await parseEpub(await buildZipWithPage(evil), { filename: "a" });
  const text = ir.chunks[0]!.text;
  assert.ok(text.includes("Homework due Sept 9"));
  assert.ok(!text.includes("root:"), "no file contents may leak");
  assert.ok(text.includes("&xxe;") && text.includes("&b;"), "unknown entities stay literal");
});

async function buildZipWithPage(page: string): Promise<Uint8Array> {
  const opf = `<package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest><item id="p" href="p.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="p"/></spine></package>`;
  const container = `<container><rootfiles><rootfile full-path="c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  return await buildZip([
    { name: "META-INF/container.xml", data: container },
    { name: "c.opf", data: opf },
    { name: "p.xhtml", data: page },
  ]);
}

Deno.test("plain text becomes the same IR shape", async () => {
  const ir = await normalizeText(
    "# Syllabus\n\nQuiz 1 is due Sept 9.\n\n- Midterm on Oct 13\n- Final on Dec 15",
    { filename: "pasted.txt" },
  );
  assert.equal(ir.source.kind, "text");
  assert.ok(ir.chunks[0]!.text.includes("Midterm on Oct 13"));
  await rejects(normalizeText("   \n\n  ", { filename: "e.txt" }), "no_readable_content");
});

Deno.test("loose quote matching ignores markdown, spacing and case", () => {
  assert.ok(
    looseIncludes(
      "## Late Work\n\nLate  assignments lose 10% per day.",
      "late assignments lose 10% per day",
    ),
  );
  assert.ok(!looseIncludes("Quiz 1 is due Sept 9", "Midterm on Oct 13"));
  assert.ok(!looseIncludes("anything", "ab"));
  assert.equal(xhtml("x").includes("<body>x</body>"), true);
});
