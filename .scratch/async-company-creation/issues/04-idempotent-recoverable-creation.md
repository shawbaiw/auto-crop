# 04: Make Company Creation Idempotent And Recoverable

**What to build:** Duplicate submits, browser refreshes, and interrupted requests should resolve back to the same Company Creation using the Creation Idempotency Key and locally remembered company id, instead of creating duplicates or returning the user to onboarding.

**Blocked by:** 02: Start A Durable Creating Company.

**Status:** resolved

- [x] Repeating `POST /api/companies` with the same Creation Idempotency Key and same payload returns the existing company creation state.
- [x] Repeating `POST /api/companies` with the same Creation Idempotency Key and different payload returns `409`.
- [x] A completed idempotent submit returns enough company state for the dashboard to enter the Department Workspace.
- [x] A failed idempotent submit returns the failed company creation state without starting a retry.
- [x] The dashboard stores the current company id and Creation Idempotency Key locally while creation is active.
- [x] Refreshing during creation restores the creation progress view for the same company.
- [x] Repeated clicks on Create Company do not create duplicate companies.
