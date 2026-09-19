from __future__ import annotations

import hashlib
import posixpath
from pathlib import PurePosixPath
from uuid import NAMESPACE_URL, uuid4, uuid5
from urllib.parse import unquote, urlsplit

from defusedxml import ElementTree

from app.ingestion.archive import EPUBParseError, SafeEPUBArchive
from app.ingestion.chunk import chunk_text
from app.ingestion.normalize import normalize_html
from app.schemas.ir import IRChunk, IRSource, IRWarning, ParsedEPUB

_READABLE_MEDIA_TYPES = {"application/xhtml+xml", "text/html"}


def parse_epub(source: bytes | bytearray | str, *, import_id: str | None = None) -> ParsedEPUB:
    content = _read_source(source)
    archive = SafeEPUBArchive(content)
    import_id = import_id or str(uuid4())
    try:
        container_bytes = archive.read("META-INF/container.xml")
    except EPUBParseError as error:
        raise EPUBParseError("INVALID_EPUB", "The EPUB is missing container.xml.") from error
    container = _parse_xml(container_bytes, "container.xml")
    opf_path = _find_opf_path(container)
    try:
        package_bytes = archive.read(opf_path)
    except EPUBParseError as error:
        raise EPUBParseError("UNSUPPORTED_PACKAGE", "The EPUB is missing its OPF package.") from error
    package = _parse_xml(package_bytes, "OPF package")
    package_dir = str(PurePosixPath(opf_path).parent)
    manifest, spine, metadata_title = _read_package(package, package_dir, archive)

    sources: list[IRSource] = []
    warnings: list[IRWarning] = []
    for spine_index, item_id in enumerate(spine):
        item = manifest.get(item_id)
        if item is None:
            raise EPUBParseError("UNSUPPORTED_PACKAGE", "The EPUB spine references a missing manifest item.")
        if item["media_type"] not in _READABLE_MEDIA_TYPES:
            continue
        path = item["path"]
        normalized_text = normalize_html(archive.read(path))
        if not normalized_text:
            warnings.append(IRWarning(code="EMPTY_DOCUMENT", message="A spine document contained no readable text."))
            continue
        source_id = str(uuid5(NAMESPACE_URL, f"{import_id}:{path}"))
        try:
            raw_chunks = chunk_text(normalized_text)
        except ValueError as error:
            raise EPUBParseError("CONTENT_TOO_LARGE", str(error).split(": ", 1)[-1]) from error
        chunk_records = [
            IRChunk(
                chunk_id=str(uuid5(NAMESPACE_URL, f"{source_id}:{ordinal}")),
                start_offset=start,
                end_offset=end,
                text=chunk,
            )
            for ordinal, (start, end, chunk) in enumerate(raw_chunks)
        ]
        sources.append(
            IRSource(
                source_id=source_id,
                archive_path=path,
                title=metadata_title or item.get("title"),
                media_type=item["media_type"],
                spine_index=spine_index,
                text=normalized_text,
                text_sha256=hashlib.sha256(normalized_text.encode("utf-8")).hexdigest(),
                chunks=chunk_records,
            )
        )

    if not sources:
        raise EPUBParseError("NO_READABLE_CONTENT", "The EPUB spine contains no readable content.")
    return ParsedEPUB(
        ir_version="1.0",
        import_id=import_id,
        file_sha256=hashlib.sha256(content).hexdigest(),
        sources=sources,
        warnings=warnings,
    )


def _read_source(source: bytes | bytearray | str) -> bytes:
    if isinstance(source, (bytes, bytearray)):
        return bytes(source)
    with open(source, "rb") as file:
        return file.read()


def _parse_xml(content: bytes, label: str):
    try:
        return ElementTree.fromstring(content)
    except Exception as error:
        raise EPUBParseError("INVALID_EPUB", f"The EPUB {label} XML is invalid or unsafe.") from error


def _find_opf_path(container) -> str:
    rootfiles = [element for element in container.iter() if _local_name(element.tag) == "rootfile"]
    candidates = [element.attrib.get("full-path") for element in rootfiles if element.attrib.get("media-type") == "application/oebps-package+xml"]
    candidates = [path for path in candidates if path]
    if len(candidates) != 1:
        raise EPUBParseError("UNSUPPORTED_PACKAGE", "The EPUB must contain exactly one OPF package.")
    return _safe_reference(candidates[0], "")


def _read_package(package, package_dir: str, archive: SafeEPUBArchive):
    metadata_title: str | None = None
    manifest: dict[str, dict[str, str | None]] = {}
    spine: list[str] = []
    for element in package.iter():
        name = _local_name(element.tag)
        if name == "title" and metadata_title is None and element.text:
            metadata_title = element.text.strip() or None
        if name == "item":
            item_id = element.attrib.get("id")
            href = element.attrib.get("href")
            media_type = element.attrib.get("media-type")
            if not item_id or not href or not media_type:
                continue
            manifest[item_id] = {
                "path": _safe_reference(href, package_dir),
                "media_type": media_type,
                "title": None,
            }
        if name == "itemref":
            item_id = element.attrib.get("idref")
            if item_id:
                spine.append(item_id)
    if not spine:
        raise EPUBParseError("UNSUPPORTED_PACKAGE", "The EPUB package has no readable spine.")
    for item in manifest.values():
        if item["path"] not in archive.members:
            raise EPUBParseError("UNSUPPORTED_PACKAGE", "The EPUB package references a missing manifest file.")
    return manifest, spine, metadata_title


def _safe_reference(reference: str, base_dir: str) -> str:
    parsed = urlsplit(reference)
    if parsed.scheme or parsed.netloc or "%2f" in reference.lower() or "%5c" in reference.lower():
        raise EPUBParseError("UNSAFE_ARCHIVE", "The EPUB contains an external or unsafe package reference.")
    decoded = unquote(parsed.path)
    if "\x00" in decoded or "\\" in decoded:
        raise EPUBParseError("UNSAFE_ARCHIVE", "The EPUB contains an unsafe package reference.")
    combined = posixpath.normpath(posixpath.join(base_dir, decoded))
    if combined == "." or combined == ".." or combined.startswith("../") or combined.startswith("/"):
        raise EPUBParseError("UNSAFE_ARCHIVE", "The EPUB package reference escapes the archive.")
    return combined


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]
