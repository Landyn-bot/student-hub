# Presentation and Judge Talking Points

## Core Message
College Survival Dashboard turns authorized course EPUBs into an inspectable semester view. It reads archives safely, uses NVIDIA Nemotron to extract typed academic facts, and connects supported facts and answers to their source passages.

## Suggested Explanation
“The backend reads the EPUB itself. Nemotron receives cleaned academic text and returns structured objects. We validate types, dates, and source references before saving them. If an email or date is missing, we say so instead of guessing.”

## Show Three Things
1. Two-course import leading to combined deadlines.
2. A source passage supporting an extracted fact.
3. A missing-data question that declines to guess.

## Accurate Limitations
The project does not claim 100% accuracy, complete Canvas coverage, real-time synchronization, production security certification, or financial advice. The current repository frontend is Lovable-generated and the FastAPI backend is an approved target, not an already completed implementation.
