from __future__ import annotations

from datetime import UTC, date, datetime, time
from enum import Enum
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, Date, DateTime, Enum as SqlEnum, Float, ForeignKey, Integer, String, Text, Time, UniqueConstraint, Index
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.schemas.academic import AcademicItemKind


class Base(DeclarativeBase):
    pass


def new_id() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class ImportStatus(str, Enum):
    pending = "pending"
    completed = "completed"
    failed = "failed"


class ImportRecord(Base):
    __tablename__ = "imports"
    __table_args__ = (Index("ix_imports_sha256", "sha256"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[ImportStatus] = mapped_column(
        SqlEnum(ImportStatus, native_enum=False, create_constraint=True, validate_strings=True),
        nullable=False,
        default=ImportStatus.pending,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    course: Mapped[Course | None] = relationship(back_populates="import_record", uselist=False, cascade="all, delete-orphan")
    sources: Mapped[list[Source]] = relationship(back_populates="import_record", cascade="all, delete-orphan")


class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (UniqueConstraint("import_id", name="uq_courses_import_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    import_id: Mapped[str] = mapped_column(ForeignKey("imports.id", ondelete="CASCADE"), nullable=False)
    course_code: Mapped[str | None] = mapped_column(String(100))
    course_name: Mapped[str | None] = mapped_column(String(300))
    instructor: Mapped[str | None] = mapped_column(String(300))
    instructor_email: Mapped[str | None] = mapped_column(String(320))
    semester: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    import_record: Mapped[ImportRecord] = relationship(back_populates="course")
    academic_items: Mapped[list[AcademicItem]] = relationship(back_populates="course", cascade="all, delete-orphan")
    evidence: Mapped[list[Evidence]] = relationship(back_populates="course", cascade="all, delete-orphan")


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    import_id: Mapped[str] = mapped_column(ForeignKey("imports.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str | None] = mapped_column(String(300))
    archive_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    normalized_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    import_record: Mapped[ImportRecord] = relationship(back_populates="sources")
    evidence: Mapped[list[Evidence]] = relationship(back_populates="source", cascade="all, delete-orphan")


class AcademicItem(Base):
    __tablename__ = "academic_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[AcademicItemKind] = mapped_column(
        SqlEnum(
            AcademicItemKind,
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            name="academic_item_kind",
        ),
        nullable=False,
    )
    title: Mapped[str | None] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    date: Mapped[date | None] = mapped_column(Date)
    time: Mapped[time | None] = mapped_column(Time)
    points: Mapped[float | None] = mapped_column(Float)
    category: Mapped[str | None] = mapped_column(String(100))
    subtype: Mapped[str | None] = mapped_column(String(50))
    structured_data: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    course: Mapped[Course] = relationship(back_populates="academic_items")
    evidence: Mapped[list[Evidence]] = relationship(back_populates="academic_item", cascade="all, delete-orphan")


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    academic_item_id: Mapped[str | None] = mapped_column(ForeignKey("academic_items.id", ondelete="CASCADE"))
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    field_name: Mapped[str] = mapped_column(String(100), nullable=False)
    quote: Mapped[str] = mapped_column(Text, nullable=False)
    start_offset: Mapped[int | None] = mapped_column(Integer)
    end_offset: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    academic_item: Mapped[AcademicItem | None] = relationship(back_populates="evidence")
    course: Mapped[Course] = relationship(back_populates="evidence")
    source: Mapped[Source] = relationship(back_populates="evidence")
