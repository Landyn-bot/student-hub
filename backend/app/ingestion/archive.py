from __future__ import annotations

import io
import re
import stat
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath
from pathlib import Path

MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_MEMBERS = 1_000
MAX_MEMBER_BYTES = 8 * 1024 * 1024
MAX_TOTAL_UNCOMPRESSED_BYTES = 80 * 1024 * 1024
MAX_COMPRESSION_RATIO = 100

_ALLOWED_COMPRESSION = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
_DRIVE_PREFIX = re.compile(r"^[A-Za-z]:")


class EPUBParseError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class ArchiveMember:
    name: str
    info: zipfile.ZipInfo


class SafeEPUBArchive:
    def __init__(self, content: bytes) -> None:
        if len(content) > MAX_ARCHIVE_BYTES:
            raise EPUBParseError("CONTENT_TOO_LARGE", "The EPUB exceeds the archive size limit.")

        try:
            self._zip = zipfile.ZipFile(io.BytesIO(content))
        except (OSError, zipfile.BadZipFile) as error:
            raise EPUBParseError("INVALID_EPUB", "The uploaded file is not a valid EPUB archive.") from error

        self.members = self._validate_members()
        self._validate_mimetype()

    @classmethod
    def from_path(cls, path: Path) -> "SafeEPUBArchive":
        try:
            size = path.stat().st_size
            if size > MAX_ARCHIVE_BYTES:
                raise EPUBParseError("CONTENT_TOO_LARGE", "The EPUB exceeds the archive size limit.")
            return cls(path.read_bytes())
        except FileNotFoundError as error:
            raise EPUBParseError("INVALID_EPUB", "The EPUB file could not be read.") from error

    def _validate_members(self) -> dict[str, ArchiveMember]:
        infos = self._zip.infolist()
        if len(infos) > MAX_MEMBERS:
            raise EPUBParseError("CONTENT_TOO_LARGE", "The EPUB contains too many archive members.")
        if not infos or infos[0].filename != "mimetype":
            raise EPUBParseError("INVALID_EPUB", "The EPUB mimetype must be the first archive entry.")

        members: dict[str, ArchiveMember] = {}
        casefolded: set[str] = set()
        total_uncompressed = 0
        for info in infos:
            name = _safe_member_name(info.filename)
            if info.is_dir():
                continue
            if info.flag_bits & 0x1:
                raise EPUBParseError("UNSAFE_ARCHIVE", "Encrypted EPUB entries are not supported.")
            file_mode = (info.external_attr >> 16) & 0xFFFF
            if file_mode and stat.S_IFMT(file_mode) not in {0, stat.S_IFREG}:
                raise EPUBParseError("UNSAFE_ARCHIVE", "The EPUB contains a special archive entry.")
            if info.compress_type not in _ALLOWED_COMPRESSION:
                raise EPUBParseError("UNSUPPORTED_PACKAGE", "The EPUB uses unsupported compression.")
            if info.file_size > MAX_MEMBER_BYTES:
                raise EPUBParseError("CONTENT_TOO_LARGE", "An EPUB member exceeds the size limit.")
            if info.file_size and info.file_size / max(info.compress_size, 1) > MAX_COMPRESSION_RATIO:
                raise EPUBParseError("UNSAFE_ARCHIVE", "The EPUB compression ratio is too high.")

            key = name.casefold()
            if key in casefolded:
                raise EPUBParseError("UNSAFE_ARCHIVE", "The EPUB contains duplicate member paths.")
            casefolded.add(key)
            total_uncompressed += info.file_size
            if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES:
                raise EPUBParseError("CONTENT_TOO_LARGE", "The EPUB contains too much uncompressed content.")
            members[name] = ArchiveMember(name=name, info=info)

        return members

    def _validate_mimetype(self) -> None:
        member = self.members.get("mimetype")
        if member is None or member.info.compress_type != zipfile.ZIP_STORED:
            raise EPUBParseError("INVALID_EPUB", "The EPUB must contain an uncompressed mimetype entry.")
        if self.read("mimetype") != b"application/epub+zip":
            raise EPUBParseError("INVALID_EPUB", "The EPUB mimetype is invalid.")

    def read(self, name: str) -> bytes:
        member = self.members.get(name)
        if member is None:
            raise EPUBParseError("INVALID_EPUB", "The EPUB references a missing archive member.")
        try:
            with self._zip.open(member.info, "r") as stream:
                content = stream.read(MAX_MEMBER_BYTES + 1)
        except (OSError, RuntimeError, zipfile.BadZipFile) as error:
            raise EPUBParseError("INVALID_EPUB", "The EPUB member could not be read safely.") from error
        if len(content) > MAX_MEMBER_BYTES:
            raise EPUBParseError("CONTENT_TOO_LARGE", "An EPUB member exceeds the size limit.")
        return content


def _safe_member_name(raw_name: str) -> str:
    if not raw_name or "\x00" in raw_name or "\\" in raw_name:
        raise EPUBParseError("UNSAFE_ARCHIVE", "The EPUB contains an unsafe archive path.")
    if raw_name.startswith("/") or _DRIVE_PREFIX.match(raw_name):
        raise EPUBParseError("UNSAFE_ARCHIVE", "The EPUB contains an absolute archive path.")

    path = PurePosixPath(raw_name.rstrip("/"))
    if any(part in {"", ".", ".."} for part in path.parts):
        raise EPUBParseError("UNSAFE_ARCHIVE", "The EPUB contains an unsafe archive path.")
    if not path.parts:
        raise EPUBParseError("UNSAFE_ARCHIVE", "The EPUB contains an empty archive path.")

    return str(path)
