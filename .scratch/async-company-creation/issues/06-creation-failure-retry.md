# 06: Handle Creation Failure And Explicit Retry

**What to build:** If the CEO Agent fails, blueprint parsing fails, or record writing fails, the company should become `creation_failed`, show a useful failure state, and let the user explicitly retry on the same company with a new Creation Attempt.

**Blocked by:** 03: Complete Creation In The Background; 05: Surface Company Events Through SSE And State.

**Status:** resolved

- [x] CEO Agent failure moves the company to `creation_failed`.
- [x] Blueprint parse failure moves the company to `creation_failed`.
- [x] Record writing failure moves the company to `creation_failed`.
- [x] Failure records a failed Creation Attempt and failed Company Event with a short user-facing message.
- [x] Detailed diagnostics are available through prompt/log paths rather than large API response bodies.
- [x] `POST /api/companies/:id/retry-creation` starts a new Creation Attempt on the same company when status is `creation_failed`.
- [x] Retry is rejected with `409` for `creating`, `draft`, `active`, `paused`, and `review` companies.
- [x] Retrying returns the dashboard to the creation progress view for the same company.
