# 02: Start A Durable Creating Company

**What to build:** When the user submits Create Company, the backend should quickly accept the request, persist a `creating` company with a Creation Idempotency Key, create the first Creation Attempt and Company Event, and return a skeleton company so the dashboard can enter a creation progress view immediately.

**Blocked by:** 01: Extract Blueprint Writing Behind Company Creation.

**Status:** resolved

- [x] `POST /api/companies` returns quickly with `202 Accepted` and a skeleton company in `creating` status.
- [x] The skeleton company persists the submitted company name, Founder Vision, selected CEO Agent, Permission Mode, playbook, assets, and Creation Idempotency Key.
- [x] A first Creation Attempt is persisted for the company.
- [x] A first Company Event records that Company Creation was accepted.
- [x] `GET /api/companies` includes the creating company with `taskCount = 0`.
- [x] The dashboard enters a company-level creation progress view after the initial create response.
