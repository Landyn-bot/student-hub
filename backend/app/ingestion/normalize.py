from __future__ import annotations

import re
import unicodedata
from html.parser import HTMLParser

_IGNORED_TAGS = {"script", "style", "iframe", "object", "embed", "template"}
_STRUCTURAL_TAGS = {
    "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt",
    "h1", "h2", "h3", "h4", "h5", "h6", "li", "ol", "p", "pre", "section",
    "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
}
_WHITESPACE = re.compile(r"[ \t\f\v]+")


class InertHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._ignored_depth = 0
        self._hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if self._ignored_depth:
            if tag in _IGNORED_TAGS:
                self._ignored_depth += 1
            return
        if tag in _IGNORED_TAGS:
            self._ignored_depth = 1
            return
        if self._hidden_depth:
            self._hidden_depth += 1
            return
        attributes = {name.lower(): value for name, value in attrs}
        if "hidden" in attributes or attributes.get("aria-hidden", "").lower() == "true":
            self._hidden_depth += 1
            return
        if not self._hidden_depth and tag in _STRUCTURAL_TAGS:
            self._break()

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self._ignored_depth:
            if tag in _IGNORED_TAGS:
                self._ignored_depth -= 1
            return
        if self._hidden_depth:
            self._hidden_depth -= 1
            return
        if tag in _STRUCTURAL_TAGS:
            self._break()

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth and not self._hidden_depth:
            self.parts.append(data)

    def _break(self) -> None:
        if self.parts and not self.parts[-1].endswith("\n"):
            self.parts.append("\n")


def normalize_html(content: bytes) -> str:
    parser = InertHTMLParser()
    parser.feed(content.decode("utf-8", errors="replace"))
    parser.close()
    text = "".join(parser.parts)
    text = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    lines = [_WHITESPACE.sub(" ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line).strip()
