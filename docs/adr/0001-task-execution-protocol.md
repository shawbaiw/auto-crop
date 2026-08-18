# Task Execution Protocol

Task scheduling uses a dependency DAG, and a queued task is runnable only when all required dependencies have produced accepted proof. Before dispatch, the scheduler writes a `task-prompt.md` task packet into the task workspace; workers must write `proof.json` and durable outputs under `artifacts/` so the runtime can capture proof deterministically instead of inferring completion from prose.
