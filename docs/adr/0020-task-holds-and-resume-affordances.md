# A Stopped Task Carries An Explicit Hold And An Offered Way Forward

Status: accepted

Auto-Crop had no first-class answer to "why is this task not moving, and who can move it". That answer lived in four unrelated facts that nothing kept in sync — `tasks.status`, the current Business Artifact's `reviewStatus`, the status of the matching Human Action / Founder Decision / Approval, and the newest Task Progress Event — and each surface read a different one.

The reported symptom was a task that CEO Office offered for approval while the API answered `Task is no longer waiting for CEO review.` and the department board showed the same task as blocked, with no offered action that could restart it. That is the shape of the whole class, not one defect: the task had left `review` by some path that did not know an approval was outstanding, and nothing reconciled the two facts or checked that the founder was left with a move.

## Decision

A stopped task carries a **Task Hold**: a persisted record of why it stopped, who can clear it, and which record it is waiting on. Holds are the single source of truth for "this task is parked", and every surface and API guard derives from them.

Three rules make the model worth having, and all three are enforced rather than documented:

1. **Parked implies held.** A task in a Held Task Status (`waiting_dependency`, `blocked`, `review`, `needs_replan`, `failed`) has at least one open Hold; a task in a self-propelling status (`queued`, `running`, `retrying`) or a terminal one (`complete`, `cancelled`) has none. `applyTaskTransition` is the only writer of `tasks.status` and enforces both directions in the same write.
2. **Every Hold has a way out.** `resolveTaskAffordances` maps every `TaskHoldKind` to at least one Resume Affordance other than cancelling, exhaustively over the union. A new Hold kind cannot compile, or pass tests, without declaring how it is resolved.
3. **Affordances are computed once, server-side.** Surfaces and API guards read the same set. A button the API would reject cannot be rendered, and a resolvable Hold cannot be invisible.

The guard on a stale action changes shape too. Refusing an action now returns the task's current affordances alongside the error, so a founder acting on a view the runtime has moved past is redirected to the real next action instead of being handed a dead end.

### Status-bound Holds

`awaiting_ceo_review` is only coherent while the task is in `review`, and `needs_replan` only while it is `needs_replan`. Leaving either status resolves the Hold as `superseded` in the same write. This is the general form of the reported failure: an approval stops being offered the moment the task stops being in review, whatever moved it, because CEO Office projects the offer from the Hold and not from the artifact's `reviewStatus`.

The artifact's `reviewStatus` is deliberately left alone on that path. Collapsing to one authority is the fix; writing both consistently would only be a second chance to drift.

### The catch-all is on purpose

`runtime_interrupted` is the Hold for a stop nobody modelled — a crashed or timed-out run, a restart mid-flight, a transition that declared no Hold. It keeps rule 1 true for situations no one anticipated, at the cost of a vaguer reason string. A vaguer reason with an owner is strictly better than a task no one can move, and that trade is the point: the next stall will come from a situation this ADR did not foresee.

Where facts can sharpen the fallback, they do. `reconcileTaskHolds` refines `runtime_interrupted` into `awaiting_dependency_artifact` or `awaiting_founder_decision` when the task has an upstream that still owes a deliverable — a refinement that needs the repository and so lives outside the pure rule, and that only ever narrows the fallback.

### Standing repair, not a migration

`reconcileTaskHolds` runs on every company-state read and whenever a task's affordances are resolved, and repairs the invariant from current facts: tasks parked before Holds existed, tasks parked by a path that bypasses the seam, and Holds left open on a task that has since moved on. It is deliberately not a one-time pass with a marker (unlike ADR 0017's review reconciliation): the drift it repairs is a recurring class of mistake, not a one-time schema change, so the repair has to be standing.

## Considered Options

- **Fix the review guard for this case:** rejected. It would leave the other twelve paths that write `tasks.status` free to produce the same shape, and leave `blocked` tasks with no offered action at all.
- **Derive Holds purely, with no new table:** rejected. A projection would make the surfaces agree, but nothing would stop the fourteenth direct `updateTaskStatus` call from parking a task with no owner. The persisted record plus a single-writer seam is what makes the invariant enforceable.
- **Encode the reasons in `TaskStatus` instead:** rejected. `blocked` was already a bucket for five unrelated situations; splitting it further would spread the same question across more statuses and break every consumer that switches on status, without giving any of them an actor or a subject.
- **Keep the dashboard's own eligibility predicates:** rejected. `isRecoverableTask` and `isTaskRecoveryEligible` had already drifted — the server accepted recovery for `blocked` tasks and the UI never offered it — which is half of the reported "no way to continue".

## Consequences

`applyTaskTransition` is the only legal caller of `writeTaskStatusUnchecked`, and `taskTransition.test.ts` fails the build on a new direct caller. The dashboard's `isRefreshableTask` / `isRecoverableTask` predicates are gone, replaced by reading `task.affordances`.

The two actions whose runtime has state preconditions — refresh and recover — declare those preconditions once, in `affordanceStatusGates`, so an offered action is one the runtime will accept.

Task summaries grew `holds` and `affordances`; every `summarizeTask` call site now passes repositories. That cost is deliberate: it is what makes it impossible to serialize a task without saying what can be done to it.

Holds are per-task. A Hold that blocks several tasks (one Human Action gating three of them) is represented as one Hold per task sharing a subject id, not as a shared record. If cross-task Hold identity is ever needed — resolving one Human Action clearing every task it gates in one write — the subject id is the join key to build it on.

## Amendment (2026-09-14): Founder Approval, and the affordance that honoured nothing

Applying the model exposed a hole in it. `awaiting_founder_approval` satisfied rule 2 — it offered `decide_founder_approval` — but `POST /api/approvals/:id` echoed its request back and wrote nothing, and no surface rendered the action. The rule guaranteed that an affordance *exists*, not that anything *honours* it. An affordance no route honours is worse than none: it renders a button that lies.

Three things follow, and the third is the general one.

**The approval path is real.** Approvals record their outcome (`decided_at`, `note`); the route looks the approval up, guards on the affordance like every other mutating route, and clears the Hold. Granting returns the task to work; denying moves it to `needs_replan`, because a task whose required action the founder has refused cannot run as specified — offering replanning rather than re-presenting the request the founder just declined.

**Permission Mode reaches the scheduler.** The approval path was unreachable, but only by accident: `approvalRequired` was injected by the CLI as a hardcoded `balanced` policy, so a company set to `safe` never asked despite the setting being stored and displayed. It now resolves the task's own company Permission Mode, and the parameter is optional with that as the default — a caller that has to supply a rule is a caller that can get it wrong. The granularity stays deliberately coarse: one pre-dispatch check, with per-action approval left as a separate change.

**Clearing one Hold is not unblocking a task.** A task can be held for several reasons at once, and an actor who answers one has said nothing about the others. `releaseTaskHold` closes the named Hold and moves the task only when nothing else holds it; `applyTaskTransition` gained `resolvesHoldIds` for the case where an answer and a new blocking fact land together.

This was not specific to approvals. All four answer paths — Founder Approval, Human Action confirmation, Wait State check-in, CEO review return — forced the task to `queued` and resolved every Hold with it, and Human Action confirmation was reachable in that state: a task gated on a Human Action can also still owe an upstream deliverable, because the block applies to `waiting_dependency` tasks that already carry a dependency Hold.

The scheduler re-derives dependency readiness before dispatch, so the task was not actually run with an unmet dependency. The damage was to the thing this ADR is about: between the answer and the next scheduler tick, the task read as "queued, about to run" with no Hold saying what it was still waiting on, and the dependency Hold's history showed a false "resolved". A task that cannot move must always say why — including for the few seconds after someone answers one of its reasons.

All four now release rather than force, and each reports the task's actual resulting status in its event instead of asserting `queued`.

### The new enforcement

`taskAffordanceCoverage.test.ts` maps every `TaskAffordanceKind` to the route that honours it, and fails if the union grows without one. Its oracle for a stub is simple and exact: a route that only echoes its request answers `200` for a subject that does not exist, because it never looks anything up. Restoring the old approvals handler fails precisely that one case.

Rule 2 should now be read as: every Hold kind offers a real way forward, *and* something performs it, *and* a surface draws it.

## Amendment (2026-09-14): The enumerated parts, made structural

An audit of this ADR's own implementation found four places where the model was enforced by a list someone had to maintain rather than by something that fails on its own. Each is the shape of the original bug, so each is now structural.

**The seam is default-safe about partial answers.** `applyTaskTransition` into a self-propelling status resolves only the Holds the caller named, and refuses to move the task while any other Hold is open. Callers declare what their reason actually answers — `resolvesHoldIds` for a specific Hold, `resolvesHoldKinds` for a reason addressing a class of them. `releaseTaskHold` is now a shorthand over that rule rather than the only place it lives, so a fifth answer path written without it still cannot start a held task. Three paths that had never been examined for this — the dependency cascade, parent aggregation, and task recovery — now state what they resolve, and two of them were quietly resolving Holds they had no business touching.

**A Hold's status binding is declared with the Hold kind.** `taskHoldStatusBinding` in core is exhaustive over `TaskHoldKind`: a new kind does not compile until it says which status, if any, it belongs to. It replaces two hand-maintained copies of the same two-entry map, in the seam and in the reconciler. "A Hold that outlived its status" is the mechanism of the original failure, and it was being defended by a list.

**Action preconditions have one declaration.** `isAffordanceApplicable` in core is read both by the offer and by the runtime that performs the action; `taskRefresh` and `taskRecovery` no longer restate the rule. The first version of this ADR removed one duplicated eligibility rule and introduced another.

**The dashboard declares where every affordance is rendered.** `taskAffordanceControls` is exhaustive over the union, with each kind either drawn inline (with its handler, which is a compile error to omit), owned by a named surface, or explicitly `unsurfaced` with a written reason. This closed a live instance of the original symptom that the first implementation missed entirely: a task at the Bounded Recovery ceiling is `blocked` and has replanning as its only way forward, but the task row knew only refresh and recover while the Operations page filtered on `status === "needs_replan"` — so the founder saw a stopped task with no button anywhere.

**And the client stopped synthesising.** Holds and affordances were computed for the status the server saw. A live event that moves a task locally now drops them rather than carrying them onto a status they were not computed for, and `adoptSettledTasks` takes the server's version of a task only where the two agree.
