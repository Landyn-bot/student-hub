from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

from app.models import AcademicItem, Base, Course, Evidence, ImportRecord, Source
from app.schemas.academic import AcademicItemCreate, AcademicItemKind


@pytest.fixture
def database_engine(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection: object, _: object) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    return engine


def test_table_creation(database_engine) -> None:
    table_names = set(inspect(database_engine).get_table_names())

    assert table_names == {"imports", "courses", "sources", "academic_items", "evidence"}


def test_relationships_and_persistence_across_sessions(database_engine) -> None:
    with Session(database_engine) as first_session:
        import_record = ImportRecord(filename="course.epub", sha256="a" * 64)
        course = Course(import_record=import_record, course_name="Computer Science")
        source = Source(
            import_record=import_record,
            archive_path="EPUB/syllabus.xhtml",
            normalized_text="Quiz 1 is worth 20 points.",
        )
        item = AcademicItem(
            course=course,
            kind=AcademicItemKind.assessment,
            title="Quiz 1",
            subtype="quiz",
            points=20,
        )
        evidence = Evidence(
            academic_item=item,
            course=course,
            source=source,
            field_name="points",
            quote="Quiz 1 is worth 20 points.",
            start_offset=0,
            end_offset=29,
        )
        first_session.add(import_record)
        first_session.commit()
        import_id = import_record.id
        item_id = item.id
        source_id = source.id

    with Session(database_engine) as second_session:
        saved_import = second_session.get(ImportRecord, import_id)
        saved_item = second_session.get(AcademicItem, item_id)
        saved_source = second_session.get(Source, source_id)

        assert saved_import is not None
        assert saved_import.course is not None
        assert saved_import.sources[0].id == source_id
        assert saved_item is not None
        assert saved_item.course.import_id == import_id
        assert saved_item.evidence[0].source_id == source_id
        assert saved_source is not None
        assert saved_source.evidence[0].academic_item_id == item_id


def test_nullable_fields(database_engine) -> None:
    with Session(database_engine) as session:
        import_record = ImportRecord(filename="minimal.epub", sha256="b" * 64)
        course = Course(import_record=import_record)
        session.add(import_record)
        session.commit()

        assert course.course_code is None
        assert course.instructor_email is None
        assert course.description is None


def test_invalid_academic_item_kind_is_rejected() -> None:
    with pytest.raises(ValidationError):
        AcademicItemCreate(kind="not_a_kind")


def test_database_kind_constraint(database_engine) -> None:
    with Session(database_engine) as session:
        import_record = ImportRecord(filename="course.epub", sha256="c" * 64)
        course = Course(import_record=import_record)
        session.add(import_record)
        session.flush()
        session.add(AcademicItem(course=course, kind="not_a_kind"))

        with pytest.raises((StatementError, IntegrityError)):
            session.commit()


def test_foreign_keys_are_enforced(database_engine) -> None:
    with Session(database_engine) as session:
        session.add(Source(import_id="missing-import", archive_path="x.xhtml", normalized_text="text"))

        with pytest.raises(IntegrityError):
            session.commit()


def test_one_course_per_import(database_engine) -> None:
    with Session(database_engine) as session:
        import_record = ImportRecord(filename="course.epub", sha256="d" * 64)
        session.add(import_record)
        session.flush()
        session.add_all([
            Course(import_id=import_record.id, course_name="First"),
            Course(import_id=import_record.id, course_name="Second"),
        ])

        with pytest.raises(IntegrityError):
            session.commit()
