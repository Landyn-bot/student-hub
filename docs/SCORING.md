# Internal Evaluation and Demo Readiness

This is an internal readiness rubric, not an official SteelHacks scoring rubric.

| Category | Points |
|---|---:|
| End-to-end utility | 25 |
| Trust and accuracy | 25 |
| Technical implementation | 20 |
| Usability | 15 |
| Demo and explanation | 15 |

A release-blocking security failure or fake live result blocks readiness regardless of score.

## Metrics
Report field precision and recall, date accuracy, invented missing-date count, stored schema validity, citation resolution, citation entailment, abstention on five unsupported questions, retrieval recall, end-to-end latency, and provider call count. Targets are design goals, not results: 100% stored validity and citation resolution, zero invented dates, at least 90% precision, and at least 80% recall on a labeled small fixture set.

## Required Cases
Test full dates, missing years, missing email, repeated mentions, contradictory dates, prompt-injection text, unknown citations, foreign workspace IDs, last-chunk failure, and duplicate uploads.

## Results Sheet
| Field | Actual result |
|---|---|
| Parser/prompt/schema/model versions | Not run |
| Fixture names and sizes | Not generated |
| Precision/recall/date accuracy | Not measured |
| Stored validity/citation resolution | Not measured |
| Supported and absent questions | Not run |
| Latency/provider calls | Not measured |
| Real authorized EPUB coverage | Not inspected |
| Security and browser smoke | Not run |
