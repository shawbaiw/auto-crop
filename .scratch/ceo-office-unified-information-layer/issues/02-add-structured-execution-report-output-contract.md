# 02: Add Structured Execution Report Output Contract

**What to build:** New task outputs can provide a structured Execution Report with conclusion, vision impact, remaining gap, and recommendation. Older Task Outcome Summary prose remains readable as compatibility fallback, but new task outputs should have a reliable structure for CEO Office to render.

**Blocked by:** 01 (Define CEO Office Item Projection Contract)

**Status:** ready-for-agent

- [ ] New deliverable output supports structured Execution Report fields: conclusion, vision impact, remaining gap, and recommendation.
- [ ] Existing Task Outcome Summary prose still works as fallback for old data.
- [ ] Validation or parsing treats the structured report as the preferred new contract without requiring old completed tasks to be backfilled.
- [ ] Agent-facing task instructions tell completing agents to produce the structured Execution Report.
- [ ] Tests prove structured reports render field-by-field and fallback prose remains readable.
- [ ] Notes preserve the future direction that Task Briefs should later become structured through department assessment.

