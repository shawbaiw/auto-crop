# Deliverable-Gated Dependencies And Bounded Recovery

Auto-Crop will start dependent tasks only after upstream tasks produce Consumable Proof, and will treat timeout recovery as bounded profile escalation followed by `needs_replan` rather than unbounded retry. This keeps Proof as the completion gate, prevents downstream agents from running on missing inputs, and gives oversized tasks a clear replanning path instead of repeatedly burning time under unchanged conditions.

## Stale Running Tasks

An Agent Run can disappear without writing a final outcome, leaving its task in `running` after the Effective Timeout has passed. Auto-Crop treats this as a timed-out execution, not as active work.

The scheduler and company-state read path should reconcile stale running tasks by:

- marking the running Agent Run `failed` with failure reason `timeout`
- setting the task to `failed`
- recording the timeout failure in the Task Execution Summary
- deleting the stale task lock
- appending normal Agent Activity and Department Workspace progress events

The dashboard should present this state as "timed out, waiting for recovery" so the next user action is clear.

## Task Recovery Requests

After a task fails, times out, or is reconciled from stale running, Auto-Crop may accept a Task Recovery Request. The user-facing action is "Recover Task".

Recovery is bounded:

- if controlled Proof Recovery can register valid Proof, the task moves to CEO review instead of rerunning
- if no Partial Output exists, the original task may be requeued
- if Partial Output exists, Auto-Crop creates or reuses one follow-up task and moves downstream dependencies to that task
- after the long-profile recovery path is exhausted, the task requires replanning rather than another retry

Recovery does not bypass Proof or CEO review. A recovered task still needs recorded Proof and a CEO Review Decision before it can complete.
