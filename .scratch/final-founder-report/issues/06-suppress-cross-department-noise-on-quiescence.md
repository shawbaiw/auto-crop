# 06: Mechanical cross-department rollups disappear once a company is quiescent

**What to build:** A fully-finished company stops showing mechanical noise. Once a company is quiescent, `createAttentionCandidates` no longer raises a `cross_department_impact` reason for a Task Completion Event whose task is `complete` and whose downstream is also settled — those rollups are redundant with the Final Founder Report and were the `INFORMATIONAL` clutter the founder saw on an all-green company. A non-quiescent company is unchanged: genuine in-flight cross-department signals still surface. This is the only change to existing rollup behaviour; `exception_outcome` and the other reasons are untouched.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] `cross_department_impact` is not raised for accepted, settled work when the company is quiescent.
- [ ] Running companies, and quiescent companies' genuinely unsettled cross-department items, are unaffected.
- [ ] Tests — Seam 2 (`routes.test.ts`): a quiescent company's response omits `cross_department_impact` rollups for its accepted tasks; a non-quiescent company with in-flight cross-department work still has them.
- [ ] Tests — Seam 3 (`App.test.tsx`): a quiescent-company snapshot renders no such rollup entries.
