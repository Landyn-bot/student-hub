from __future__ import annotations

import io
import zipfile

import pytest

from app.ingestion.archive import EPUBParseError
from app.ingestion.package import parse_epub


def make_epub(*, content_documents: list[tuple[str, str]], mimetype: str = "application/epub+zip", include_container: bool = True, include_package: bool = True, container_path: str = "OPS/package.opf", opf_spine: list[str] | None = None, extra_members: dict[str, bytes] | None = None) -> bytes:
    manifest_ids = [f"page{index}" for index in range(len(content_documents))]
    spine_ids = opf_spine or manifest_ids
    manifest = "\n".join(
        f'<item id="{item_id}" href="{path.removeprefix("OPS/")}" media-type="application/xhtml+xml" />'
        for item_id, (path, _) in zip(manifest_ids, content_documents)
    )
    spine = "\n".join(f'<itemref idref="{item_id}" />' for item_id in spine_ids)
    opf = f'''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Course</dc:title></metadata>
  <manifest>{manifest}</manifest>
  <spine>{spine}</spine>
</package>'''.encode()
    container = f'''<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="{container_path}" media-type="application/oebps-package+xml" /></rootfiles></container>'''.encode()
    output = io.BytesIO()
    overrides = extra_members or {}
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("mimetype", mimetype, compress_type=zipfile.ZIP_STORED)
        if include_container and "META-INF/container.xml" not in overrides:
            archive.writestr("META-INF/container.xml", container)
        if include_package and container_path not in overrides:
            archive.writestr(container_path, opf)
        for path, text in content_documents:
            if path not in overrides:
                archive.writestr(path, text)
        for path, content in overrides.items():
            archive.writestr(path, content)
    return output.getvalue()


def test_valid_epub_preserves_spine_order_and_provenance() -> None:
    content = make_epub(content_documents=[
        ("OPS/second.xhtml", "<h1>Second</h1><p>Later text.</p>"),
        ("OPS/first.xhtml", "<h1>First</h1><p>Earlier text.</p>"),
    ])

    parsed = parse_epub(content, import_id="test-import")

    assert [source.archive_path for source in parsed.sources] == ["OPS/second.xhtml", "OPS/first.xhtml"]
    assert [source.spine_index for source in parsed.sources] == [0, 1]
    assert parsed.sources[0].text == "Second\nLater text."
    assert parsed.sources[0].source_id != parsed.sources[1].source_id
    assert parsed.sources[0].chunks[0].text == parsed.sources[0].text


def test_headings_lists_tables_and_active_content_are_normalized() -> None:
    html = '''<html><head><title>Ignored title</title><style>.x{}</style><script>alert(1)</script></head>
    <body><h1>Assignments</h1><ul><li>Essay due Friday</li><li>Quiz 1</li></ul>
    <table><tr><th>Item</th><th>Date</th></tr><tr><td>Exam</td><td>October 1</td></tr></table>
    <iframe>bad</iframe><object>bad</object><embed>bad</embed><p>https://example.com</p></body></html>'''

    parsed = parse_epub(make_epub(content_documents=[("OPS/page.xhtml", html)]))
    text = parsed.sources[0].text

    assert "Assignments" in text
    assert "Essay due Friday" in text and "Quiz 1" in text
    assert "Item" in text and "Date" in text and "Exam" in text and "October 1" in text
    assert "alert(1)" not in text and "bad" not in text
    assert "https://example.com" in text


def test_malformed_zip_is_rejected() -> None:
    with pytest.raises(EPUBParseError, match="valid EPUB"):
        parse_epub(b"not a zip")


def test_missing_or_invalid_mimetype_is_rejected() -> None:
    with pytest.raises(EPUBParseError, match="mimetype"):
        parse_epub(make_epub(content_documents=[], mimetype="wrong"))


def test_missing_container_and_opf_are_rejected() -> None:
    with pytest.raises(EPUBParseError, match="container"):
        parse_epub(make_epub(content_documents=[], include_container=False))
    with pytest.raises(EPUBParseError, match="package"):
        parse_epub(make_epub(content_documents=[], include_package=False))


def test_broken_spine_reference_is_rejected() -> None:
    with pytest.raises(EPUBParseError, match="missing manifest"):
        parse_epub(make_epub(content_documents=[("OPS/page.xhtml", "<p>text</p>")], opf_spine=["missing"]))


def test_traversal_member_is_rejected() -> None:
    with pytest.raises(EPUBParseError, match="unsafe archive path"):
        parse_epub(make_epub(content_documents=[], extra_members={"../evil.xhtml": b"bad"}))


def test_xml_entity_attack_is_rejected() -> None:
    malicious = b'''<?xml version="1.0"?><!DOCTYPE container [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><container>&xxe;</container>'''
    with pytest.raises(EPUBParseError, match="XML is invalid or unsafe"):
        parse_epub(make_epub(content_documents=[], extra_members={"META-INF/container.xml": malicious}))


def test_missing_spine_content_fails_clearly() -> None:
    with pytest.raises(EPUBParseError, match="no readable content"):
        parse_epub(make_epub(content_documents=[("OPS/page.xhtml", "<script>only</script>")]))


def test_chunk_offsets_are_exact_and_large_content_is_rejected() -> None:
    text = "<p>" + ("Academic paragraph. " * 500) + "</p>"
    parsed = parse_epub(make_epub(content_documents=[("OPS/page.xhtml", text)]))
    source = parsed.sources[0]
    assert all(chunk.text == source.text[chunk.start_offset:chunk.end_offset] for chunk in source.chunks)
    assert len(source.chunks) >= 2

    oversized = "<p>" + ("unique academic text " * 25_000) + "</p>"
    with pytest.raises(EPUBParseError, match="too many chunks|normalized EPUB text"):
        parse_epub(make_epub(content_documents=[("OPS/page.xhtml", oversized)]))
