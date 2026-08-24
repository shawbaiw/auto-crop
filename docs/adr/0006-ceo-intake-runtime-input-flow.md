# CEO Intake Runtime Input Flow

Auto-Crop will treat user input submitted from the CEO Workspace as a durable CEO Intake. A CEO Intake is the post-creation counterpart to Founder Vision: it carries new user intent into the running company without overwriting the original Founder Vision.

## Considered Options

- **Frontend-only staged message:** fastest UI path, but it makes CEO Workspace input look real while losing the request on refresh and giving the scheduler nothing to consume.
- **Immediately invoke CEO Agent and mutate objectives/tasks:** closest to the final product behavior, but it couples a small UI action to blueprint parsing, dependency creation, failure handling, and partial planning before those recovery paths are designed.
- **Create a durable CEO Intake first:** gives the user a real submitted object with visible status while keeping automatic CEO planning as a later, explicit scheduler capability.

## Decision

Create a durable CEO Intake record when the user submits new input from the CEO Workspace.

CEO Intake may later be consumed by CEO Agent or scheduler logic to add objectives, key results, tasks, task dependencies, and department assignments. The first implementation will persist the intake and show its user-facing progress flow, but it will not automatically invoke CEO Agent or mutate objectives/tasks beyond creating the intake.

The CEO Intake flow vocabulary is:

```text
received
assessing
assessment_complete
planning
planned
dispatching
dispatched
failed
```

The UI should render the full flow skeleton for each intake and mark the current known state. Each flow title should show a short summary of the user's original input so multiple intakes remain distinguishable.

## Consequences

The data model needs a CEO Intake entity and status/progress representation separate from ordinary tasks. The dashboard needs a CEO Workspace composer that reuses the department message composer treatment, plus an intake progress area. Future planner work can consume queued intakes without changing the UI concept.

This preserves the product promise that CEO Workspace input is meaningful while avoiding hidden, immediate replanning behavior. It also keeps Founder Vision stable as the creation-time input and makes CEO Intake the canonical term for runtime user input to CEO Office.
