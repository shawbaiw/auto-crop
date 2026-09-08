# 01: Define CEO Office Item Projection Contract

**What to build:** A shared CEO Office Item contract and one projection seam that turns existing company facts into stable, typed, chronological macro business items. This gives CEO Office, CEO Pending, and CEO decision surfaces one common source of meaning before any UI is rebuilt.

**Blocked by:** None (can start immediately)

**Status:** complete

- [x] A shared CEO Office Item contract can represent Task Briefs, Execution Reports, decision requests, approval requests, Decision Resolutions, Human Actions, Wait States, Blocked Issues, stage changes, and final reports.
- [x] The projection seam accepts broad company state and returns stable, sorted CEO Office Items without writing a new persisted table.
- [x] Items expose stable IDs derived from their source facts.
- [x] Items expose whether they are action-bearing so CEO Pending can be derived from the same projection.
- [x] Unit tests cover multiple business scenarios, including at least three non-SEO fixtures, and fail if the contract relies on SEO-specific task titles, copy, or artifact subtypes.
