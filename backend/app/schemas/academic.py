from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AcademicItemKind(str, Enum):
    assignment = "assignment"
    assessment = "assessment"
    policy = "policy"
    office_hours = "office_hours"
    important_date = "important_date"


class AssessmentSubtype(str, Enum):
    exam = "exam"
    quiz = "quiz"
    project = "project"
    presentation = "presentation"
    lab = "lab"
    other = "other"


class AcademicItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: AcademicItemKind
    title: str | None = Field(default=None, max_length=300)
    description: str | None = None
    points: float | None = Field(default=None, ge=0)
    category: str | None = Field(default=None, max_length=100)
    subtype: AssessmentSubtype | None = None
    structured_data: dict[str, Any] | None = None
