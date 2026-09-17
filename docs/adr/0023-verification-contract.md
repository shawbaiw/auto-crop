# A Verification Verdict Is A Runtime Fact, Bound To What Was Verified

Status: accepted

## Context

A department split turned "Build the crawlable web prototype" into three subtasks: Define, Execute, Validate. All three inherited the parent's upstream dependencies, and none depended on another. The scheduler ran them one after another only because it happened to pick them in that order.

Validate ran in its own workspace. `resolveRunWorkspace` picks the first *direct* dependency with an artifact workspace; Validate's direct dependencies were the product brief and the SEO architecture, neither of which had one, so it ran in an empty directory. The agent listed the directory, found nothing, and wrote a structurally perfect report: eleven requirement checks, all `false`, conclusion "verification did not pass".

That report was `valid`. Artifact Validation checks shape — kind, role, required fields — and the shape was right. Nothing anywhere read the verdict. The only reason it did not flow on as a successful delivery was an unrelated keyword match ("Search Console" in the prose) that sent it to manual CEO review, where approving it would have been one click. Replaying the acceptance rule with that word removed accepted the failed report automatically.

So there were two faults, and fixing either alone is not enough:

- **The verifier never received the output it was meant to verify.** Order and handoff were accidents of dispatch, not declared relationships.
- **A failed verdict was indistinguishable from a successful delivery** to every path that decides acceptance: automatic acceptance, CEO approval, Founder Decision acceptance, review reconciliation, proof recovery, parent aggregation.

## Decision

Introduce a **Verification Contract**, carried by declared dependency roles and enforced by the runtime.

**Dependencies say what they supply.** `task_dependencies.input_role` is `context` (the historical meaning, and the default), `verification_requirements`, or `verification_target`. The department split template declares its inputs by stage: Execute consumes Define as context; Validate consumes Define as `verification_requirements` and Execute as `verification_target`. Order comes from those edges, never from array position or titles.

**Requirements come from upstream, not from the verifier.** A task that some consumer takes as `verification_requirements` must deliver `payload.verification_requirements` — a non-empty list of `{ id, description }` — or its artifact is invalid. A verifier cannot narrow what it is judged against.

**A verifier works on a snapshot, never a live workspace.** Before dispatch, `prepareVerificationInputs` copies each target's delivered artifact record and artifact workspace into `.auto-crop-inputs/<producer>/` inside the verifier's own workspace, excluding runtime bookkeeping, `.git`, `node_modules` and env files, and refusing symbolic links. It fingerprints each snapshot from its contents. A producer with nothing to hand over stops the verifier *before* the run with a named `missing_deliverable` Hold — an empty directory is never offered as input again.

**What was handed over is recorded outside the agent's reach.** The requirements, their source, and each target's artifact id and fingerprint are persisted in `verification_handoffs`, not in the workspace. The workspace is the agent's to write: an earlier version of this change read a manifest back from it, and a verifier could drop the requirement it could not meet by editing that file. When the report is captured, each snapshot is fingerprinted again; a snapshot changed or removed during the run is an issue, so the verdict cannot be `passed`.

**The verdict is aggregated by the runtime, not stated by the agent.** The verifier reports `payload.verification.checks`: exactly one `{ requirement_id, outcome: passed | failed | not_run, evidence }` per requirement. Dropping or inventing a requirement makes the artifact invalid. The runtime aggregates those per-check outcomes — any `failed` is `failed`; anything short of every requirement `passed` against unchanged, still-current targets is `inconclusive` — and records it with the targets on `business_artifacts.verification`. Prose is never read for the verdict. The per-check outcomes themselves are the agent's report: `evidence` must be non-empty, but the runtime does not independently check that it is true.

**Verification duty belongs to the task, not to the artifact kind.** Whether an artifact must carry a verdict is decided by the task's `verification_target` dependencies. A verifier filing a `final_report` instead of a `deliverable` is judged all the same, and one filing any non-blocker artifact without `payload.verification` is invalid. An earlier version keyed the contract on `deliverable`, and a failed report relabelled `final_report` carried no verdict — which the shared predicate reads as "not under the contract" — and was reviewable.

**One predicate guards every success path.** `isVerificationSatisfied` (core) is asked by `isReviewableBusinessArtifact`, CEO Office's pending projection, CEO approval, dependency readiness, parent aggregation, and — as a backstop that throws — `acceptTaskBusinessArtifact`, which every acceptance route goes through. Where the task and repositories are at hand, two more questions are asked: `acceptTaskBusinessArtifact` refuses a verifier's artifact that records no verdict, and it, dependency readiness and parent aggregation refuse a verdict whose targets or requirements have since been superseded by a newer artifact (`isVerificationCurrent`).

**A failed verdict parks the task on its own Hold.** The run is recorded `complete` (the process did its job), the task goes to `blocked` with failure reason `verification_failed`, and a new `verification_failed` Hold offers running the verification again or replanning. The report stays as evidence.

## Considered options

- **Keyword exceptions in automatic acceptance.** Removes the accident that caught this case and nothing else; the replay showed the failed report is then accepted.
- **Run the verifier inside the producer's workspace**, as ordinary context consumers do. It sees the files, but it can change what it judges, and a report cannot name the version it verified.
- **Ask the agent for an overall pass/fail.** A second generated field restating the checks, which the model may phrase optimistically — the pattern `recommended_option_index` already replaced.
- **Mark a failed report `invalid`.** It is not invalid: it is the most useful evidence the run produced. Validity and verdict are different facts.

## Consequences

- A failed or inconclusive verification cannot be accepted, auto-accepted, approved, summarized into a parent, or consumed downstream, whichever path reaches it.
- Agent Run success and task success are now separable for verifiers: a `complete` run can leave a `verification_failed` task.
- Known limitations, deliberately left to later changes:
  - Whether a task is split, and into which three stages, is still decided by `isLargeDepartmentTask`, which matches title and description text. The stages are now structural once created; the trigger is not.
  - Subtask deliverables still go through automatic acceptance and can land in CEO review. The internal-readiness boundary and a single readiness rule shared by aggregation and dispatch are the next change.
  - A failed verification stops; it does not yet trigger bounded automatic rework of the producer.
  - Only dependencies declared with verification roles are under the contract. Validation tasks the CEO blueprint plans directly have no such roles yet, so a company whose plan verifies through them is not protected. The runtime cannot infer the duty: the same `test-output` proof schema is used by verification tasks and by unrelated ones. Declaring roles and requirement lists in the blueprint is a required follow-up, not an optional one.
  - Currency is checked by artifact id after capture, not by re-reading bytes. A context consumer that later runs in the producer's workspace (the parent's summarization, a CEO-planned diff capture) can change files without a new artifact, and a passed verdict will not notice. Moving every consumer onto snapshots is a larger change.
  - Existing companies are not migrated: their subtasks keep the dependencies they were created with.
