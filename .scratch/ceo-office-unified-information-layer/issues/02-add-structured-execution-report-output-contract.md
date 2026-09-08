# 02: Add Structured Execution Report Output Contract

**What to build:** New task outputs can provide a structured Execution Report with conclusion, vision impact, remaining gap, and recommendation. Older Task Outcome Summary prose remains readable as compatibility fallback, but new task outputs should have a reliable structure for CEO Office to render.

**Blocked by:** 01 (Define CEO Office Item Projection Contract)

**Status:** done

- [x] New deliverable output supports structured Execution Report fields: conclusion, vision impact, remaining gap, and recommendation.
- [x] Existing Task Outcome Summary prose still works as fallback for old data.
- [x] Validation or parsing treats the structured report as the preferred new contract without requiring old completed tasks to be backfilled.
- [x] Agent-facing task instructions tell completing agents to produce the structured Execution Report.
- [x] Tests prove structured reports render field-by-field and fallback prose remains readable.
- [x] Notes preserve the future direction that Task Briefs should later become structured through department assessment.

**Implementation note:** New structured Business Artifact outputs using `artifact_kind` / `artifact_role` / `artifact_subtype` must include `payload.execution_report`; legacy `artifactType` outputs and already-persisted Task Completion Events can still fall back to `outcomeSummaryText`. Task Briefs remain projected from task facts for now; later department assessment should produce structured brief fields.
