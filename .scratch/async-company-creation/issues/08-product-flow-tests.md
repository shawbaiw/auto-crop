# 08: Replace Timeout-Oriented Creation Tests With Product Flow Tests

**What to build:** Replace old company creation timeout expectations with product-level coverage for the durable asynchronous Company Creation flow, proving the full user promise across slow agents, refresh recovery, duplicate submits, reconnects, failures, retries, and successful completion.

**Blocked by:** 03: Complete Creation In The Background; 04: Make Company Creation Idempotent And Recoverable; 05: Surface Company Events Through SSE And State; 06: Handle Creation Failure And Explicit Retry; 07: Reconcile Stuck Creating Companies.

**Status:** resolved

- [x] A slow CEO Agent no longer causes the dashboard to show a create request timeout.
- [x] Refreshing during creation restores the same creating company and its historical progress.
- [x] Duplicate Create Company clicks or repeated submits do not create duplicate companies.
- [x] Reconnecting after missed live events shows historical progress from company state.
- [x] Creation failure is visible and can be retried on the same company.
- [x] Successful creation moves a watched creating company into the Department Workspace.
- [x] Existing tests that assert the old synchronous timeout behavior are removed or rewritten to the new product behavior.
- [x] The full relevant test suite, typecheck, and lint commands for the touched packages pass.
