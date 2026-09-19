from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator


class IRWarning(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=300)


class IRChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunk_id: str = Field(min_length=1, max_length=64)
    start_offset: int = Field(ge=0)
    end_offset: int = Field(gt=0)
    text: str = Field(min_length=1, max_length=8_000)

    @model_validator(mode="after")
    def validate_range(self) -> "IRChunk":
        if self.end_offset <= self.start_offset:
            raise ValueError("chunk end_offset must be greater than start_offset")
        if len(self.text) != self.end_offset - self.start_offset:
            raise ValueError("chunk text length must match its offset range")
        return self


class IRSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str = Field(min_length=1, max_length=64)
    archive_path: str = Field(min_length=1, max_length=1_024)
    title: str | None = Field(default=None, max_length=300)
    media_type: str = Field(min_length=1, max_length=200)
    spine_index: int | None = Field(default=None, ge=0)
    text: str = Field(min_length=1, max_length=400_000)
    text_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    chunks: list[IRChunk] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_chunks(self) -> "IRSource":
        for chunk in self.chunks:
            if chunk.text != self.text[chunk.start_offset : chunk.end_offset]:
                raise ValueError("chunk text must match the source text slice")
        return self


class ParsedEPUB(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ir_version: str = Field(pattern=r"^1\.0$")
    import_id: str = Field(min_length=1, max_length=64)
    file_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    sources: list[IRSource] = Field(min_length=1, max_length=100)
    warnings: list[IRWarning] = Field(default_factory=list, max_length=1_000)
