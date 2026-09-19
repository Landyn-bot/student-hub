# Deterministic EPUB Pipeline

## Purpose and Responsibility

The EPUB pipeline converts one untrusted Canvas course EPUB into validated, immutable normalized source documents and chunks. It is deterministic application code owned by the Python backend. Its responsibility ends before AI extraction begins:

```text
Canvas EPUB upload
-> bounded ZIP validation
-> EPUB container/package parsing
-> inert XHTML/HTML extraction
-> normalized academic text
-> source-linked chunking
-> validated intermediate representation
-> Nemotron extraction
```

The pipeline does not infer academic facts, choose between conflicting dates, or call the model while archive safety and source normalization are incomplete.

## Accepted Input

The MVP accepts one uploaded `.epub` file per import request. The extension is checked case-insensitively, but MIME type is advisory and the archive structure must prove that the file is an EPUB.

The target profile supports EPUB 2 and EPUB 3 packages within the tested implementation subset. Each EPUB is expected to represent one course. Multiple files are imported as separate courses and combined by the semester dashboard. Suspected multi-course publications are rejected or reported for review rather than arbitrarily merged.

The upload is streamed to a server-generated temporary location outside the web root. The backend computes the received-byte SHA-256 while enforcing limits. Raw uploads are removed after parsing, on failure, and during stale temporary-file cleanup.

## Safe ZIP Handling

The parser reads permitted archive members through bounded streams. It never uses `extractall`, recreates uploader-controlled paths on disk, executes archive content, or recursively unpacks attachments.

Before reading content, reject archives that are malformed, encrypted, use unsupported compression methods, contain unsafe file types, fail CRC checks, or exceed declared limits. Validate declared sizes and actual decompressed bytes because archive headers cannot be trusted.

Reject ZIP member names containing any of the following:

- NUL bytes, backslashes, leading slashes, or drive prefixes.
- Empty components, literal `.` or `..` components, or traversal above the archive root.
- Duplicate canonical names or case-fold collisions.
- Symlink, device, or other special-file mode bits.

OPF and container references use a separate canonical resolver. It parses the reference as a URI, rejects nonempty schemes and authorities, removes fragments for lookup, percent-decodes exactly once using strict UTF-8, rejects encoded separators and NULs, resolves relative paths within the archive root, and verifies the result against the validated member map. External URLs and filesystem URLs are never fetched.

## EPUB Container and Package Parsing

The archive must contain an exact `mimetype` member with `application/epub+zip` bytes and the required EPUB first-entry/stored-mimetype properties for the supported profile. It must also contain `META-INF/container.xml`.

Parse `container.xml` and the OPF package with hardened XML settings. DTDs, entity expansion, external entities, and external resource access are disabled or rejected. Enforce XML size, nesting, element, and text-node limits.

Resolve exactly one supported OPF rootfile. Validate its package version, namespaces, metadata, unique manifest IDs, local manifest references, spine order, and essential spine references. Broken essential references fail the import rather than silently producing incomplete content.

Read readable XHTML/HTML members in spine order and then other readable manifest documents outside the spine. Do not assume names such as `syllabus.html`, and do not treat navigation-only pages as evidence of assignments or deadlines. Record skipped binary attachments and unsupported content as warnings when the import remains usable.

## XHTML and HTML Extraction

Parse XHTML/HTML as inert content with a tolerant parser. The parser extracts text and structural boundaries; it does not execute scripts, evaluate CSS, fetch links, load images, or follow embedded content.

Remove or ignore:

- `script`, `style`, `noscript`, `template`, `iframe`, `object`, `embed`, and `form` content.
- Event-handler attributes and hidden DOM nodes marked `hidden` or `aria-hidden="true"`.
- External resources and active links as executable behavior.

Retain headings, paragraphs, list items, table rows, and table-cell boundaries. Preserve table headers with their rows where possible so a date or assignment label does not lose its context. Preserve document titles and archive paths as source metadata. Do not claim to evaluate full CSS visibility.

## Text Normalization

Normalize only what is needed for stable reading and offsets:

- Convert line endings consistently.
- Normalize Unicode conservatively, using NFC for stored text.
- Collapse unnecessary spaces without deleting meaningful punctuation, minus signs, dates, email addresses, timezone strings, or paragraph boundaries.
- Preserve heading and paragraph separation.
- Keep the original normalized text immutable after source IDs, hashes, and offsets are calculated.

Normalization must not invent labels, dates, years, instructors, or other academic facts. A publication creator is metadata, not automatically the course instructor.

## Source IDs and Provenance

The backend allocates source and chunk IDs. Nemotron may copy supplied IDs but may not create them. Each source records at least:

- `sourceId`
- archive path
- document title when available
- media type
- spine index when applicable
- immutable normalized text
- text SHA-256
- parser version
- chunk references

The OPF metadata may be retained as a separate labeled plain-text source. Evidence later points to a source and chunk using exact offsets and quotes. A quote must occur in the referenced chunk; source and chunk ownership is checked before academic records are stored.

## Chunking Strategy

Split by headings, paragraphs, and other meaningful boundaries before using a hard split. A chunk is at most 8,000 Unicode characters. For long contiguous text, use a defined overlap of up to 300 characters while preserving exact source spans. Do not drop table headers; retain them with the associated table fragment or cite the exact source span containing them.

The MVP allows at most 25 chunks per import. Chunk offsets are inclusive at the start and exclusive at the end, and the chunk text must equal `source.text[startOffset:endOffset]`. Chunking must not insert synthetic text while claiming that offsets refer to the original normalized source.

## Intermediate Representation

The parser produces a validated IR before Nemotron is called. Its required shape is conceptually:

```json
{
  "irVersion": "1.0",
  "importId": "backend-generated-id",
  "fileSha256": "64-lowercase-hex",
  "package": {
    "version": "3.0",
    "title": null,
    "identifier": null,
    "language": null,
    "creator": null
  },
  "sources": [
    {
      "sourceId": "backend-generated-id",
      "archivePath": "EPUB/chapter.xhtml",
      "title": "Course schedule",
      "mediaType": "application/xhtml+xml",
      "spineIndex": 0,
      "text": "normalized inert text",
      "textSha256": "calculated-hash",
      "chunks": [
        {
          "chunkId": "backend-generated-id",
          "startOffset": 0,
          "endOffset": 21
        }
      ]
    }
  ],
  "warnings": []
}
```

Pydantic validates the IR before it is persisted or sent to the AI layer. Warnings identify skipped attachments, empty or low-information documents, and other supported limitations. At least one nonempty readable HTML source is required; metadata alone produces a `NO_READABLE_CONTENT` failure.

## AI Boundary

Nemotron never receives or parses raw EPUB archive bytes, ZIP metadata, XML container files, HTML markup, images, binary attachments, filesystem paths, or uploader-controlled paths. It receives only bounded normalized text and explicitly identified source/chunk metadata from the validated IR, after deterministic parsing has completed.

The backend, not Nemotron, owns archive safety, source IDs, offsets, date-resolution rules, evidence membership, ownership, and persistence. Nemotron output is separately validated by the AI pipeline. Invalid structure, missing required evidence, unknown source IDs, or invalid quotes prevent academic storage.

## MVP Limits

The initial hackathon limits are hard safety limits, not user-configurable form fields:

| Resource | Limit |
|---|---:|
| Received EPUB | 20 MiB actual bytes |
| Multipart request body | 21 MiB streamed |
| Archive members | 1,000 including directories |
| Total declared and actual uncompressed bytes | 80 MiB |
| Individual uncompressed entry | 8 MiB |
| Compression ratio | Reject above 100:1 for nonempty entries |
| XML metadata file | 1 MiB; nesting at most 64; at most 10,000 elements; text node at most 64 KiB |
| Normalized content | 160,000 Unicode characters per import |
| Chunks | At most 25 per import, at most 8,000 characters each |
| Archive path | At most 1,024 characters |
| Displayed filename | At most 200 characters |

The implementation must enforce actual stream counters in addition to declared ZIP sizes. Oversized readable content fails explicitly rather than being silently truncated.

## Errors and Unsupported Content

Return safe, user-readable error codes without file paths, stack traces, credentials, prompts, or raw archive details. Examples include:

- `INVALID_EPUB` for a malformed or structurally invalid EPUB.
- `UNSAFE_ARCHIVE` for traversal, special files, duplicate names, encryption, or bomb-like limits.
- `CONTENT_TOO_LARGE` for file, entry, decompressed, normalized-text, or chunk limits.
- `UNSUPPORTED_PACKAGE` for unsupported or ambiguous package structure.
- `NO_READABLE_CONTENT` when no nonempty HTML/XHTML source is available.
- `PARSER_TIMEOUT` when bounded parsing exceeds its time limit.

Unsupported binary attachments, skipped media, and low-information navigation pages may produce warnings when the readable course content remains valid. The UI must distinguish “content was not found in this export” from a claim that the course has no such content. A failed parse produces no successful academic records.

## Testing Expectations

Use original synthetic fixtures and small adversarial archives. Tests must cover:

- Valid EPUB 2 and EPUB 3 packages, namespace variations, relative OPF paths, and readable HTML outside the spine.
- Tables, lists, headings, non-ASCII text, missing years, and exact source-offset preservation.
- Traversal names, NULs, backslashes, duplicate/case-colliding names, symlinks, device entries, encrypted archives, unsupported compression, corrupt CRCs, and zip-bomb limits.
- DTD/XXE/entity declarations, malformed XML, external references, missing packages, ambiguous rootfiles, and broken spine references.
- Scripts, styles, hidden nodes, event attributes, forms, iframes, embeds, external links, image-only content, and nested ZIP attachments.
- Actual decompressed-byte enforcement, normalized-content limits, chunk limits, timeout cleanup, and removal of temporary uploads.
- A malicious or prompt-injection passage remaining inert source text and never causing tool calls, network requests, or archive execution.
- A valid IR whose every chunk substring matches its recorded source offsets, with IDs and hashes generated by the backend.

Malicious fixtures must be rejected before any NVIDIA call. The deterministic parser and IR tests should run without network access.
