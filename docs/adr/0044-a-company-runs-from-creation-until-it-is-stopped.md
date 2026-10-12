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
- Pausing changes the status first, so no new run starts. It then asks the company's live Agent Runs and Agent Sessions to stop.
- The scheduler settles each interrupted run only when its process has exited, and then puts the task back in `queued`. It is not cancelled.
  - A task is never rewritten under a live agent. A workspace is shared by the runs of a task, so requeueing a task while its old process still writes would let the next dispatch start in a directory that something else is writing to.
  - A process that never exits is isolated as `termination_unconfirmed`, as with any other stop.
  - A run that this server process cannot reach, because another worker owns it, is reported as unreachable and is not counted as stopped.
- A requeued task needs no Hold. A paused company dispatches nothing, and the company status says why.
- Resuming moves the company back to `active`, so the requeued tasks dispatch again. The step that was running when the company paused starts again from its beginning.

**Stop Operating**

- Stop Operating is final. The founder confirms it by typing the company name.
- The company becomes `stopped` at once. Its live runs are stopped as for a pause, but their tasks are cancelled when the processes exit. Nothing dispatches again.
- A Final Founder Report is then authored in the background, as at Company Quiescence. A stopped company counts as quiescent. If the agent run fails, the deterministic fallback applies. If the report job fails for any other reason, the scheduler queues it again on its next tick, because a stopped company without a current report is always due one.
- A stopped company is read-only. The server offers no Resume Affordance on any of its tasks, so the dashboard shows no action without a rule of its own.
- A `creation_failed` company can also be stopped. It has no blueprint, so no report is written.

**Creation**

- A new company is created only from Settings, or by the first-run Onboarding Wizard when no company exists. "Back to Setup" is removed.
- Retrying a failed creation may change the original input. The retry route accepts a new name, Founder Vision, CEO Agent and Permission Mode for the same company.
- Several companies may operate at once. The scheduler keeps its single global concurrency limit.

## Consequences

- The founder no longer sees the blueprint before agents begin to spend. `safe` mode is the way to approve work before it runs.
- Company Quiescence still triggers a Final Founder Report for an `active` company. Stop Operating is a second trigger.
