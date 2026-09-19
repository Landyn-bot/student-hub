// Temporary dev page: upload an .epub and see exactly what the parser produces.
// Parsing runs entirely in the browser, so no backend / API key is involved.
import { createFileRoute } from "@tanstack/react-router";
import { useState, type ChangeEvent } from "react";
import { chunkEpub, parseEpub, type EpubChunk, type ParsedEpub } from "@/lib/epub";

export const Route = createFileRoute("/epub-test")({
  component: EpubTestPage,
});

function EpubTestPage() {
  const [parsed, setParsed] = useState<ParsedEpub | null>(null);
  const [maxChars, setMaxChars] = useState(12000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const chunks: EpubChunk[] = parsed ? chunkEpub(parsed, { maxChars }) : [];
  const payload = parsed
    ? JSON.stringify({ metadata: parsed.metadata, toc: parsed.toc, chapters: parsed.chapters, chunks }, null, 2)
    : "";

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setParsed(null);
    try {
      setParsed(await parseEpub(await file.arrayBuffer()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse EPUB");
    } finally {
      setBusy(false);
    }
  }

  async function copyJson() {
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">EPUB parser test</h1>
        <p className="text-sm text-muted-foreground">
          Upload a course .epub to see the parsed chapters and the chunks that would be sent to the model.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-4">
        <input type="file" accept=".epub,application/epub+zip" onChange={onFile} className="text-sm" />
        <label className="flex items-center gap-2 text-sm">
          Max chars / chunk
          <input
            type="number"
            min={500}
            step={500}
            value={maxChars}
            onChange={(e) => setMaxChars(Math.max(500, Number(e.target.value) || 12000))}
            className="w-24 rounded border bg-background px-2 py-1"
          />
        </label>
      </div>

      {busy && <p className="text-sm">Parsing…</p>}
      {error && <p className="rounded border border-destructive p-3 text-sm text-destructive">{error}</p>}

      {parsed && (
        <>
          <section className="space-y-1 rounded border p-4 text-sm">
            <p className="font-medium">{parsed.metadata.title ?? "(untitled)"}</p>
            <p className="text-muted-foreground">
              {parsed.metadata.authors.join(", ") || "Unknown author"} · {parsed.chapters.length} chapters ·{" "}
              {chunks.length} chunks · {parsed.chapters.reduce((n, c) => n + c.wordCount, 0).toLocaleString()} words
            </p>
            {parsed.warnings.map((w) => (
              <p key={w} className="text-amber-600">⚠ {w}</p>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-medium">Chapters</h2>
            {parsed.chapters.map((c) => (
              <details key={c.id} className="rounded border p-3">
                <summary className="cursor-pointer text-sm">
                  {c.index + 1}. {c.title} <span className="text-muted-foreground">({c.wordCount} words)</span>
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{c.text}</pre>
              </details>
            ))}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">JSON output</h2>
              <button onClick={copyJson} className="rounded border px-3 py-1 text-sm hover:bg-muted">
                {copied ? "Copied!" : "Copy JSON"}
              </button>
            </div>
            <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{payload}</pre>
          </section>
        </>
      )}
    </main>
  );
}