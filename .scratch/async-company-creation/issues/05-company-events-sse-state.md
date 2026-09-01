# 05: Surface Company Events Through SSE And State

**What to build:** Company Creation progress should be visible through durable Company Events in company state and through future Company Events on the existing SSE stream, so users can understand creation progress across refreshes and reconnects.

**Blocked by:** 02: Start A Durable Creating Company.

**Status:** ready-for-agent

- [ ] `GET /api/companies/:id/state` includes historical Company Events for creating, creation-failed, and draft companies.
- [ ] The existing company-scoped SSE endpoint publishes future Company Events for the subscribed company.
- [ ] Event payloads distinguish company-level events from task-level events without using fake task ids.
- [ ] The creation progress view renders historical events from state before relying on live SSE updates.
- [ ] The creation progress view updates when new creation lifecycle events arrive over SSE.
- [ ] SSE does not replay historical events on connection; history comes from company state.
