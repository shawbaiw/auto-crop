# 01: Extract Blueprint Writing Behind Company Creation

**What to build:** Keep the existing synchronous company creation behavior working, but separate the inner CEO Agent blueprint generation, blueprint parsing, and blueprint record writing flow so it can later be called by an asynchronous Company Creation runner without duplicating logic.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Existing company creation API behavior still produces a draft company with departments, objectives, key results, tasks, and task dependencies.
- [x] The blueprint generation/parsing/writing flow can be invoked independently from the request lifecycle wrapper.
- [x] Existing creation tests still pass or are updated only where they assert private helper shape instead of external behavior.
- [x] The refactor does not introduce Company Creation states, Company Events, Creation Attempts, or idempotency behavior yet.
