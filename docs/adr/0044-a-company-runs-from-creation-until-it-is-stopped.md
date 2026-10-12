# A Company Runs From Creation Until It Is Stopped

Status: proposed

A company starts operating as soon as its Company Blueprint is written. There is no draft to activate. It can be paused and resumed. It ends only by Stop Operating, which is final. Its statuses are `creating`, `creation_failed`, `active`, `paused` and `stopped`.

## Context

Today a company waits in `draft` until the founder activates it, and only `active` companies dispatch (ADR 0033). Activation was the only point where the founder looked at the blueprint before work began. Founders who want to approve work already choose the `safe` Permission Mode, which stops every task for Founder Approval before dispatch. Draft review added a step that most founders skipped.

The Kill Switch did not match its role. It paused every company through a global flag that nothing could clear. It cancelled the running tasks, and each one then needed a manual recovery. It moved the company to `review`, a status with no exit except activation, and activation did not clear the global flag. Nothing stopped or ended a company for good. "Back to Setup" let the founder start a new company from inside a running one, so the company being edited was unclear.

## Decision

**Statuses**

- `creating` and `creation_failed` are unchanged. A completed Company Creation moves the company straight to `active`.
- `draft` and `review` are removed. Existing companies are test data and are deleted, not migrated.
- `paused` is a company the founder paused. `stopped` is a company the founder ended. Only `active` dispatches.

**Pause Operating and Resume Operating** replace the Kill Switch

- Pausing applies to one company. There is no global pause.
- Pausing stops the company's live Agent Runs and Agent Sessions. Each interrupted task is parked by `applyTaskTransition` with a `company_paused` Hold (ADR 0020). It is not cancelled.
- Resuming moves the company back to `active` and resolves every `company_paused` Hold, so those tasks queue again. The step that was running when the company paused starts again from its beginning.

**Stop Operating**

- Stop Operating is final. The founder confirms it by typing the company name.
- The company becomes `stopped` at once. Its live runs are stopped as for a pause, and nothing dispatches again.
- A Final Founder Report is then authored in the background, as at Company Quiescence. If it fails, the deterministic fallback applies and the founder can ask for the report again.
- A stopped company is read-only. The server offers no Resume Affordance on any of its tasks, so the dashboard shows no action without a rule of its own.
- A `creation_failed` company can also be stopped. It has no blueprint, so no report is written.

**Creation**

- A new company is created only from Settings, or by the first-run Onboarding Wizard when no company exists. "Back to Setup" is removed.
- Retrying a failed creation may change the original input. The retry route accepts a new name, Founder Vision, CEO Agent and Permission Mode for the same company.
- Several companies may operate at once. The scheduler keeps its single global concurrency limit.

## Consequences

- The founder no longer sees the blueprint before agents begin to spend. `safe` mode is the way to approve work before it runs.
- Company Quiescence still triggers a Final Founder Report for an `active` company. Stop Operating is a second trigger.
