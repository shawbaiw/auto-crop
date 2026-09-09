# 05: Project Execution Reports Only For Accepted Outcomes

**What to build:** `projectCeoOfficeItems` stops emitting an `execution_report` for completion events whose outcome is not `accepted`. Non-accepted work is already represented by its exception card.

**Blocked by:** None (pure projection logic; can start immediately)

**Status:** ready-for-agent

- [ ] The completions loop in `projectCeoOfficeItems` emits `execution_report` only when `event.outcome === "accepted"`.
- [ ] `blocked` / `needs_replan` / `failed_to_review` completion outcomes are covered by a `blocked_issue` item; verify `blocked_issue` projection covers the `failed_to_review` completion outcome specifically, and add it if it does not.
- [ ] `awaiting_founder_decision` is covered by the `decision_request` card (no report).
- [ ] A task that goes `awaiting_founder_decision` then `accepted` via founder-decision resolution projects exactly one `execution_report` (from the accepted event) — confirm no dedup code is needed because the filter already selects only the accepted event.
- [ ] `timelineOrder` is unchanged (`execution_report` before `decision_request`).
- [ ] Non-accepted `TaskCompletionEvent` rows are not deleted — they remain durable facts, just not rendered as reports.
- [ ] Tests in `ceoOffice.test.ts`: `blocked` / `needs_replan` / `failed_to_review` produce no `execution_report` but do produce a `blocked_issue`; the awaiting-then-accepted sequence produces exactly one `execution_report` plus a `decision_resolution`.

**Implementation note:** `appendTaskCompletionEvent` appends, so two completion events for one task is expected on the founder-decision path; this filter is what collapses them in the timeline.
