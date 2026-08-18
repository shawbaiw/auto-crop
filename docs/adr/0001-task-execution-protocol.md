# Task Execution Protocol

Task scheduling uses a dependency DAG, and a queued task is runnable only when all required dependencies have produced accepted proof. Before dispatch, the scheduler writes a `task-prompt.md` task packet into the task workspace; workers must write `proof.json` and durable outputs under `artifacts/` so the runtime can capture proof deterministically instead of inferring completion from prose.

## Confirmed Decisions

- Keep the existing candidate implementation and audit it instead of reverting it immediately.
- Use a dependency DAG for execution order.
- Use `task-prompt.md` plus referenced company workspace paths for context handoff.
- Use `proof.json` plus `artifacts/` for proof handoff.
- Defer frontend task-state refresh work until after the backend execution contract is verified.

## Follow-Up

The next verification pass should use an authenticated real local agent and confirm dependency gating, task packet delivery, and structured proof capture end to end.
