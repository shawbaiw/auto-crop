# Replan Revises A Stuck Task, Not Only Splits An Oversized One

Status: proposed

A Replan Proposal has two modes. A **Split** replaces a task too large for one run with two to five smaller ones, as replanning does today. A **Revision** keeps the task and rewrites what it is asked to do, and may amend the planned verification requirements that judge it in the same proposal, confirmed by the founder once. Replanning is available exactly where a task's Holds offer `request_replan`.

## Context

Task Holds offer `request_replan` on many Holds — an invalid delivery, a failed verification, an exhausted recovery — because replanning is the way out when the task as specified cannot succeed (ADR 0020). The handler accepted only tasks in `needs_replan`, so every other offered replan failed with "does not need replanning": an exit shown to the founder that did not lead out. Even where it ran, the planner was told only to split an "oversized" task, and never why the task was stuck.

The first real e2e run showed why splitting is not enough. A keyword task could not obtain a numeric KD in its environment; no split helps, because every piece still needs KD. What had to change was the requirement — and that requirement was not written on the keyword task at all. It was a check, `meets-thresholds`, in the requirements its verifier judged it against. Revising the keyword task alone would have produced a delivery the verifier failed again, and Verification Rework would have sent it straight back.

The glossary already said a Replan Required task "should be split or rewritten". Only the split was built.

## Decision

**Who may replan, and how it is asked**

- The replan handler's precondition is the task's `request_replan` affordance, not its status. The Hold policy that offers the exit is the one place that decides whether the exit exists.
- `awaiting_dependency_artifact` stops offering `request_replan`. A replan always changes the task that is stuck, and a downstream task cannot fix a dead upstream; its exit names the upstream to deal with instead.
- `awaiting_human_action` offers `request_replan`, so a founder who will not or cannot supply what an Unblock Request asks for has a way out (ADR 0042).
- The founder may name the mode and add a note; without a mode the planner picks one. A rejected proposal may be rejected with a note and requested again.
- The note goes to the planner only. The task's agent works from the confirmed task and requirements, which are the single statement of what is asked; the note reaches them by being written into the proposal the founder confirmed.

**What the planner is told**

- Why the task is stuck: the reasons of its open Holds, its current Blocker Report including any Unblock Request, and the failed checks of any Verification Verdict on it — plus the founder's note and requested mode, if any.

**What a Revision may change**

- The task's title, description, acceptance criteria and Proof Schema. Its required capabilities too, still bounded by the company's Permission Mode, and flagged in the proposal when the capability set changes.
- Not its dependencies, department or assigned agent. A task whose inputs must change is a Split, or an upstream problem.
- The planned Verification Requirements on a verifier that judges the task. Requirements a verifier takes from a `verification_requirements` producer are that producer's delivery: the proposal says so and points at revising that producer instead of editing its artifact.
- A Split never changes requirements: it divides the work toward the same standard. Changing the standard is always a Revision.

**When a Revision is confirmed**

- The task always runs again. It usually holds a blocker or a failed delivery, and deciding whether its old output already meets the new standard would itself take an agent.
- Every open Hold on the task is resolved as superseded by the revision, and its Bounded Recovery attempts restart from zero. A verifier whose requirements were amended starts a new verification round budget. Only a founder-confirmed revision resets either count; the ceilings themselves stay, counted from that confirmation.
- A Verification Verdict records a fingerprint of the requirement set it judged against, beside the target artifacts it already records. Whether a verdict is current is derived by comparing both against the present facts — never by writing a "stale" mark when requirements change. Amending a requirement therefore makes the verifier's whole verdict non-current, for every target it covers; its next run judges all of them again.

**A proposal is bound to the state it was made from**

- A proposal records the task state it was written against: its open Holds, its current artifact and the verdicts on it. Confirming compares that record with the present; if the task has moved — a Human Action confirmed, a recovery run, an upstream redelivered — confirmation is refused and the founder is asked to request a new proposal.

## Consequences

- Every run of a task, not only a revised one, is given its Settled Facts: resolved Founder Decisions, Human Action Confirmations and Verification Rework feedback, each with its source, built by one function at dispatch from runtime state. Re-running a revised keyword task must not ask the founder to choose the keyword again.
- A verifier's targets outside the revised task wait one more verification round after a requirement amendment, because the verdict is whole.
- The replan proposal view shows the task change and the requirement changes side by side, and says when a proposal has gone stale.

## Considered Options

- **A per-check waiver on a failed verdict.** The founder marks one failed check as waived, with a reason. Quick, but it is an exception, not a change: the plan keeps saying "KD ≤ 15" while the company works to something else, and the waiver is bound to one artifact version, so the next rework needs it again. It may still be worth adding for a check that is right in general and wrong only once; it is not how a requirement that is unattainable in the environment should be changed.
- **Revise only the task, never the requirements.** Leaves the verifier holding the old standard, which is the loop described above.
- **A separate "edit requirements" action.** Splits one decision — "this is what we now accept" — across two confirmations that can disagree.
- **Per-check staleness.** Only the checks an amendment touches would go stale. It needs a version per requirement and makes "is this verdict current" a partial answer; one fingerprint per verdict keeps it a yes or no.
- **Skip the re-run when the old output may already pass.** Saves a run in a minority of cases at the cost of an extra judgement step on every revision.
