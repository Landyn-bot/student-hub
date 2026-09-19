from __future__ import annotations

MAX_NORMALIZED_CHARACTERS = 400_000
MAX_CHUNKS = 100
MAX_CHUNK_CHARACTERS = 8_000
CHUNK_OVERLAP = 300


def chunk_text(text: str, *, max_chunk_characters: int = MAX_CHUNK_CHARACTERS) -> list[tuple[int, int, str]]:
    if len(text) > MAX_NORMALIZED_CHARACTERS:
        raise ValueError("CONTENT_TOO_LARGE: normalized EPUB text exceeds the limit")
    if not text:
        return []

    chunks: list[tuple[int, int, str]] = []
    start = 0
    while start < len(text):
        target_end = min(start + max_chunk_characters, len(text))
        end = target_end
        if target_end < len(text):
            boundary = text.rfind("\n", start + max_chunk_characters // 2, target_end)
            if boundary > start:
                end = boundary
        if end <= start:
            end = target_end
        chunks.append((start, end, text[start:end]))
        if end == len(text):
            break
        start = max(end - CHUNK_OVERLAP, start + 1)

    if len(chunks) > MAX_CHUNKS:
        raise ValueError("CONTENT_TOO_LARGE: EPUB text produces too many chunks")
    return chunks
