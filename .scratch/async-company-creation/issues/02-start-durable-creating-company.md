# 02: Start A Durable Creating Company

**What to build:** When the user submits Create Company, the backend should quickly accept the request, persist a `creating` company with a Creation Idempotency Key, create the first Creation Attempt and Company Event, and return a skeleton company so the dashboard can enter a creation progress view immediately.

**Blocked by:** 01: Extract Blueprint Writing Behind Company Creation.

**Status:** ready-for-agent

- [ ] `POST /api/companies` returns quickly with `202 Accepted` and a skeleton company in `creating` status.
- [ ] The skeleton company persists the submitted company name, Founder Vision, selected CEO Agent, Permission Mode, playbook, assets, and Creation Idempotency Key.
- [ ] A first Creation Attempt is persisted for the company.
- [ ] A first Company Event records that Company Creation was accepted.
- [ ] `GET /api/companies` includes the creating company with `taskCount = 0`.
- [ ] The dashboard enters a company-level creation progress view after the initial create response.
