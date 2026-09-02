Status: resolved

# Async Company Creation

## Problem Statement

Creating a company currently uses one synchronous request that waits for the selected CEO Agent to produce a Company Blueprint. Local agents can take longer than the dashboard's request timeout, so the user can see a timeout even though the backend is still working or has already created the company.

This makes the first-run experience confusing and brittle. A slow CEO Agent, browser refresh, network interruption, or duplicate click can leave the user unsure whether the company exists, whether creation is still running, or whether retrying will create duplicates.

## Solution

Company Creation becomes a durable asynchronous flow. When the user creates a company, the backend immediately persists a `creating` company, associates it with a Creation Idempotency Key, starts one Creation Attempt in the background, and returns quickly. The dashboard shows a company-level creation progress view and subscribes to company-level events over SSE.

When the CEO Agent finishes successfully, the backend writes the Company Blueprint records and moves the company to `draft`. If creation fails, the company moves to `creation_failed`, keeps its Creation Progress Events and attempt diagnostics, and can be retried explicitly. Refreshes, reconnects, and duplicate submissions resolve to the same company instead of creating hidden duplicates.

## User Stories

1. As a founder, I want Create Company to return quickly, so that a slow CEO Agent does not look like a broken app.
2. As a founder, I want to see a `creating` company immediately after submitting the form, so that I know my request was accepted.
3. As a founder, I want creation progress messages, so that I can tell whether the app is calling the CEO Agent, parsing the blueprint, writing records, or has failed.
4. As a founder, I want refreshing the browser during creation to return me to the same creating company, so that I do not lose the creation flow.
5. As a founder, I want network interruption and reconnect to show the latest known creation state, so that I do not have to guess whether work continued.
6. As a founder, I want repeated clicks on Create Company to resolve to the same company, so that duplicate companies are not created by accident.
7. As a founder, I want a completed creation to move me into the Department Workspace when I am watching that creation, so that I can continue naturally.
8. As a founder, I want creating companies to appear in the company list, so that I can leave and return to the creation progress view.
9. As a founder, I want creating companies to show `taskCount = 0`, so that list rows keep a stable shape before tasks exist.
10. As a founder, I want a failed creation to remain visible, so that I can inspect what happened instead of losing the request.
11. As a founder, I want failed creation retry to reuse the same company, so that the history and diagnostics stay attached to one place.
12. As a founder, I want retry to start a new Creation Attempt, so that each attempt has clear diagnostics.
13. As a founder, I want a successful creation to become `draft`, so that I can review the blueprint before activating work.
14. As a founder, I want creation to avoid auto-activating the company, so that task execution does not begin before I choose it.
15. As a founder, I want duplicate submissions with changed input under the same Creation Idempotency Key to be rejected, so that one key cannot silently change meaning.
16. As a dashboard user, I want company-level creation activity to appear in activity history, so that creation is part of the company record.
17. As a dashboard user, I want creation progress to be scoped to the current company, so that activity from other companies does not leak into the current view.
18. As a developer, I want Company Creation to be separate from task events, so that the task model is not polluted with fake task ids.
19. As a developer, I want Creation Attempts to be persisted, so that failures, retries, and stuck creating companies can be diagnosed.
20. As a developer, I want only one active Creation Attempt per creating company, so that two CEO Agent runs cannot race to write different blueprints.
21. As a developer, I want historical Creation Progress Events available through the company state endpoint, so that SSE does not need to replay history.
22. As a developer, I want SSE to carry future company events, so that the dashboard updates without polling while creation is active.
23. As a developer, I want stuck creating companies to become `creation_failed` after their attempt budget plus grace expires, so that crashed processes do not leave permanent loading states.
24. As a developer, I want existing synchronous blueprint generation logic to remain testable behind the new runner, so that the lifecycle wrapper does not obscure parsing and record creation.
25. As a developer, I want `POST /api/companies` to remain the user-facing create endpoint, so that API naming still follows the product action.

## Implementation Decisions

- Add `creating` and `creation_failed` to Company Status. `creating` means the Company Creation has been accepted but the Company Blueprint has not been written. `creation_failed` means no valid Company Blueprint was produced, but the company remains available for diagnosis and retry.
- Keep `POST /api/companies` as the create endpoint, but change its behavior to start or recover a durable Company Creation. The initial successful response should be `202 Accepted` with a skeleton company and creation state, not a complete blueprint.
- Store the Creation Idempotency Key in the create request body as `creationIdempotencyKey`. The key is generated by the dashboard and persisted locally before submission.
- Bind each Creation Idempotency Key permanently to one company. Reusing the same key returns that company's current creation result or full state. Reusing the same key with different submitted creation input returns `409`.
- Persist the creation input needed for retry and recovery: company name, Founder Vision, selected CEO Agent, Permission Mode, playbook, and assets.
- Add a durable Company Event model for company-level activity that is not tied to a task. Company Creation progress uses Company Events instead of Task Events.
- Creation Progress Events should use coarse lifecycle stages: accepted, agent started, blueprint parsed, records created, completed, and failed.
- Add Creation Attempts as a durable model. A Company Creation can have multiple attempts over time, but only one active attempt at once.
- A Creation Attempt records status, start time, finish time, failure message, and diagnostic file paths such as prompt/log path. Large stdout/stderr should live in workspace files, not response bodies.
- `POST /api/companies` creates the skeleton company and starts the Creation Attempt in the same Node process with a background async runner. The endpoint must return before the CEO Agent finishes.
- Keep the existing blueprint creation/parsing/writing flow as the inner operation used by the Company Creation runner, rather than folding lifecycle concerns into the parser-level logic.
- On successful CEO Agent output and parse, write departments, objectives, key results, tasks, and task dependencies, then move the company from `creating` to `draft`.
- Creation does not activate the company. `active` remains the result of the user's activation action.
- On CEO Agent failure, parse failure, or record creation failure, move the company to `creation_failed`, finish the attempt as failed, and append a failed Company Event.
- Add `POST /api/companies/:id/retry-creation`. Only `creation_failed` companies can be retried. Retry reuses the same company id, creates a new Creation Attempt, and appends events.
- Reject retry for `creating`, `draft`, `active`, `paused`, and `review` companies with `409`.
- Ensure backend concurrency prevents more than one active Creation Attempt for the same company.
- Treat stuck creating companies as failed after the active attempt's effective timeout plus a grace period. The first version may reconcile this on startup and on company state reads.
- Extend `GET /api/companies` so creating and creation-failed companies appear in the list. Creating companies report `taskCount = 0`.
- Extend `GET /api/companies/:id/state` so creating companies return a skeleton Company State Snapshot with empty departments, objectives, key results, tasks, proof, reviews, and durable Company Events.
- Extend `GET /api/companies/:id/state` so creation-failed companies return failure status, Company Events, attempt summary, and retry availability.
- Use the existing `/api/events?companyId=<id>` SSE endpoint for future Company Events and Task Events. Event payloads must carry enough scope/type information for the dashboard to distinguish company-level events from task-level events.
- SSE should not replay historical events. Historical restoration comes from `GET /api/companies/:id/state`; SSE only carries future events after connection.
- On `company_creation_completed`, the dashboard calls `GET /api/companies/:id/state` and enters the Department Workspace if the user is currently viewing that creation.
- If the user is elsewhere when creation completes, the dashboard should not steal focus. The company list/activity should reflect the completed state.
- The dashboard should allow the user to leave a creating company and return to its creation progress view from the company list or current-company recovery path.
- The dashboard should persist the current company id and Creation Idempotency Key locally so browser refresh can recover the current creating company.
- Failed creation UI should show the failed stage and short failure message, with detailed diagnostics available via log/prompt paths where surfaced.
- The dashboard should keep a short request timeout for `POST /api/companies`, because the endpoint should no longer wait for the long-running CEO Agent.

## Testing Decisions

- Tests should verify external behavior at the highest useful seam: API responses, persisted runtime state, emitted SSE events, and dashboard user flows. Avoid tests that assert private helper ordering unless concurrency or idempotency requires it.
- API tests should cover quick `202 Accepted` creation responses, skeleton company persistence, idempotent duplicate submit, changed payload conflict, completed idempotent submit returning complete state, failed idempotent submit returning failed state, and retry eligibility.
- Runtime tests should cover Creation Attempt creation, Company Event persistence, successful transition from `creating` to `draft`, failed transition to `creation_failed`, stuck creating reconciliation, and prevention of concurrent active attempts.
- Dashboard tests should cover entering creation progress after submit, restoring a creating company after refresh, showing creating companies in the list, avoiding duplicate creates on repeated submit, reacting to completed SSE by fetching state and entering Department Workspace, and showing retry for creation failures.
- SSE behavior should be tested through API/dashboard seams where possible: subscribe to a company and verify future Company Events arrive for that company.
- Existing route tests for synchronous creation should be updated to the new asynchronous contract instead of keeping old timeout-driven assumptions.
- Existing dashboard tests that expect `Request timed out after 10000ms` during company creation should be replaced with the new creation-progress behavior.

## Out of Scope

- Do not auto-activate the company after creation completes.
- Do not add Cancel Creation in the first version.
- Do not create a separate worker process for Company Creation.
- Do not move Company Creation into the scheduler in the first version.
- Do not replay historical events over SSE.
- Do not use company name plus Founder Vision as deduplication.
- Do not store full agent stdout/stderr in API responses.
- Do not allow blueprint regeneration for `draft`, `active`, `paused`, or `review` companies.
- Do not solve multi-device global creation recovery beyond persisted company state and the local dashboard's stored current company id/idempotency key.

## Further Notes

This spec deliberately fixes the product lifecycle instead of increasing the frontend timeout. Longer request timeouts may mask the symptom, but they do not handle refresh, network interruption, duplicate submit, failed retry, or future slower agents.

The first implementation can use an in-process async runner because the local runtime already runs as a single Node process. The durable state model should make it possible to move creation attempts into the scheduler or a worker later without changing the dashboard contract.
