# Only A Running Company Dispatches

Status: accepted

## Context

`fetchQueuedTasks` — the one query that decides which tasks a tick may dispatch — joined `companies` only to order by creation time. It never read the company's status. So a company dispatched from the moment its plan was persisted, while still `draft`.

A real smoke showed the consequence plainly: the first task was already `running` before the company was activated. The founder's activation step changed a status field and nothing else. Reviewing the plan before agents start spending on it was not a thing the system supported, though its API, its dashboard button and its company lifecycle all say it is.

The same tick already gates two other things on running-ness: `isGlobalPaused` stops the whole scheduler, and the Final Founder Report job refuses a company that is not `active` — "a `creating` / `creation_failed` / `draft` / `paused` company is not 'done', it just is not going yet". Dispatch was the one that did not ask.

## Decision

**Dispatch requires `companies.status = 'active'`**, enforced in `fetchQueuedTasks`.

- A `draft` company holds a plan the founder has not accepted; `creating` has no plan yet; `paused` and `review` were stopped on purpose. None of them dispatch.
- The gate lives in the query rather than in `runSchedulerOnce`, because that query is what every dispatch path reads. A second caller cannot reach a different answer.
- A task in a company that is not running keeps its own status. It is not parked on a Task Hold: nothing about the task has stopped, and the exit belongs to the company — activation — not to the task. This is the one wait that is answered a level up, and the company's status is where it is already visible.

## Considered options

- **Check the status in `runSchedulerOnce` instead.** Same behaviour today, but it leaves the unfiltered query available to the next caller, which is how this class of bug returns.
- **Park every task of a non-running company on a Hold.** Truthful about the wait, but it writes a Hold per task for a company-level fact, and has to unwind them all on activation — state churn for something one status field already says.
- **Treat `draft` as running and rely on the founder to pause.** Makes activation meaningless in the other direction.

## Consequences

- Activation means what it says: nothing runs, and nothing is spent, until the founder accepts the plan.
- Tests that created a company and then dispatched had to activate it first, as the API does. Several were using the dispatch query as a convenient "give me a task" helper; they now read the tasks they seeded. Both changes make the tests match how the product is driven.
- A company put into `review` by the kill switch (ADR 0009) now also stops dispatching by this rule, not only by the global pause flag.
- Known limitation: a queued task in a non-running company shows as `queued` with nothing moving it. The company's status is the explanation, and the dashboard shows it, but the task itself does not say so.
