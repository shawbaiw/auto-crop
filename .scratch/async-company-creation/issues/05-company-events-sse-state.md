# 05: Surface Company Events Through SSE And State

**What to build:** Company Creation progress should be visible through durable Company Events in company state and through future Company Events on the existing SSE stream, so users can understand creation progress across refreshes and reconnects.

**Blocked by:** 02: Start A Durable Creating Company.

**Status:** resolved

- [x] `GET /api/companies/:id/state` includes historical Company Events for creating, creation-failed, and draft companies.
- [x] The existing company-scoped SSE endpoint publishes future Company Events for the subscribed company.
- [x] Event payloads distinguish company-level events from task-level events without using fake task ids.
- [x] The creation progress view renders historical events from state before relying on live SSE updates.
- [x] The creation progress view updates when new creation lifecycle events arrive over SSE.
- [x] SSE does not replay historical events on connection; history comes from company state.
