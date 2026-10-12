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
