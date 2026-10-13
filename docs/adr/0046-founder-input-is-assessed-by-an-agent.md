# Founder Input Is Assessed By An Agent

Status: proposed

A CEO Intake starts a CEO Agent run that decides what the input needs. A new Department Intake does the same with the department's agent. The result returns to the founder as a card.

## Context

The CEO Office composer stores a CEO Intake with status `received`. No code reads it again. The statuses `assessing` through `dispatched` are defined but never reached. The glossary says an intake is "appended to company context for CEO evaluation and planning", but nothing evaluates it. The department input box makes no request at all and only shows "sent" locally. Founders were given two inputs that do nothing.

## Decision

**CEO Intake**

- Submitting an intake starts an assessment run of the CEO Agent, with a Structured Output Contract (ADR 0022).
- The run chooses one outcome:
  - create tasks, placed and planned as the blueprint does;
  - revise the plan through the existing replan path;
  - route the input to one department as a Department Intake;
  - record the input as company context only.
- The intake moves through its existing statuses. Its outcome is a CEO Office Item card in the timeline, written under the Founder Writing Rules (ADR 0045).

**Department Intake**

- A Department Intake is founder input addressed to one department. It uses the same pipeline, and the department's agent assesses it.
- The run chooses one outcome:
  - create a task in that department;
  - attach the input as added context to a task the department is running;
  - pass it to the CEO as a CEO Intake when it is outside the department's responsibility.
- Its outcome is a card on the department page.

**Shared**

- Intakes are assessed only while the company is `active`. Input sent to a paused company waits. A stopped company takes no input (ADR 0044).
- The CEO pipeline is built first. Department Intake reuses it.

## Consequences

Founder input now spends agent time, governed by the company's Permission Mode like any other run. The dashboard's composers are built together with this pipeline (dashboard ADR 0002), so neither ships before it can act on what it sends.

## Clarifications (2026-10-13, CEO Intake implementation)

The founder decided these during implementation:

- **A new plan only for a stuck task.** The replan path stays bound to the `request_replan` affordance (ADR 0043). The assessment is told which tasks offer it, and `revise_plan` may name only those. Other changes to the plan become new tasks or company context. Hold and affordance rules are unchanged.
- **Routing to a department waits for Department Intake.** Until that pipeline exists, the assessment does not offer `route_department`, so no input is routed to something that does not act on it.
- **Company context reaches later work.** Input kept as context is listed in the Company Context of every later task run and of every later intake assessment. The Founder Vision does not change.
- **How the assessment runs.**
  - `runCeoIntakeJobs` assesses `received` intakes off the scheduler tick, oldest first and one at a time, because a later input may refer to an earlier one.
  - The run uses the company's CEO Agent with no tools and a Structured Output Contract. Its prompt carries the Founder Writing Rules (`FOUNDER_WRITING_RULES` in `localePromptText.ts`, ADR 0045).
  - A failed or unreadable run is tried once more, then the intake is `failed` with a reason.
  - The run stops when its company leaves `active`. A paused company's intake goes back to `received` and the attempt does not count; a stopped company's intake fails. A restart puts an abandoned assessment back in the queue.
- **Statuses.**
  - New tasks: `assessing` → `assessment_complete` → `planning` → `planned` → `dispatched`. The tasks are written in one transaction.
  - New plan: `assessing` → `assessment_complete` → `planning` → `dispatched` once the proposal waits for the founder.
  - Context only: `assessing` → `assessment_complete` → `dispatched`.
- **The card.** CEO Office projects two items from each intake, with no new table (ADR 0019): `founder_intake` when it is sent and `intake_outcome` when it is assessed. A `ceo_intake_updated` event tells the dashboard to read the company again.

## Clarifications (2026-10-13, Department Intake implementation)

- **One pipeline.** A Department Intake is the same record as a CEO Intake, with the department it was sent to. The department's lead agent assesses it, under the same retry, pause and stop rules.
- **What a department's agent may choose.** New tasks in its own department only; a note for one of its tasks that has not ended; or passing the input to the CEO. It may not keep input as company context: that is the CEO's call.
- **A note reaches the task's next run.** A running agent process takes no new input, so the note becomes a Settled Fact of the task (`founder_note`), which every later run of it reads. The answer card says so.
- **Routing.** The CEO may send input to one department, and a department's agent may pass input to the CEO. Either way it becomes a new intake that names where it came from, and passed-on input is never passed on again, so it cannot bounce between agents.
- **Where the cards show.** A Department Intake's cards are on its department page, not on the CEO Office timeline. Input passed to the CEO shows on CEO Office, marked with the department that passed it on.
