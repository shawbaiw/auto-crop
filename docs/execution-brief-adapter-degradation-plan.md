# Execution Brief Adapter Degradation Plan

## Goal

Fix the current Claude Code dispatch blocker without redesigning the full task handoff system.

The immediate failure is in the execution-brief preparation phase: the runtime asks the adapter for a small structured JSON brief, but the installed Claude Code path returns status text such as `Structured output submitted.` or `Planning brief submitted -- no execution performed.` on stdout. The runtime then parses stdout as JSON, reports `invalid_agent_output`, and never dispatches the substantive task work.

This plan keeps the existing structured contract direction. It changes what happens when the pre-dispatch brief contract is unavailable for an adapter: the runtime records a clear degradation event, generates a minimal runtime brief, and continues with the same adapter. Final task completion still depends on artifacts, proof, and verification.

## Non-Goals

- Do not revert to free-form stdout handoff between tasks.
- Do not silently switch a Claude-assigned task to Codex.
- Do not redesign department handoff, verification gates, or artifact storage in this pass.
- Do not relax final artifact/proof validation because the execution brief was degraded.
- Do not treat adapter launch isolation warnings as task-output failures.

## Design Baseline

Settled decisions:

1. The current pass fixes the immediate blocker and adapter compatibility attribution.
2. JSON remains the control plane. Large reports, source files, logs, and checklists remain file/artifact data.
3. If execution-brief structured output fails for Claude Code, the runtime should warn, synthesize a minimal brief, and continue dispatching substantive work with Claude Code.
4. Adapter differences should be represented by a minimal capabilities model for the current needs.
5. A Cumora-style unified runtime command/API handoff is a later architecture direction, not part of this implementation.

Relevant local sources:

- `apps/server/src/runtime/executionBrief.ts`
- `apps/server/src/runtime/scheduler.ts`
- `apps/server/src/adapters/types.ts`
- `apps/server/src/adapters/cliAgent.ts`
- `apps/server/src/runtime/executionBrief.test.ts`
- `apps/server/src/runtime/scheduler.test.ts`
- `docs/adr/0022-structured-output-contract.md`
- `docs/adr/0032-failure-attribution.md`
- `docs/adr/0021-runtime-granted-agent-capabilities.md`
- `docs/adr/0028-business-artifact-syntax-repair.md`
- `docs/agent-capability-grant-plan.md`
- `docs/execution-health-p5-report.md`

Cumora reference direction:

- Engine differences are explicit at the host/daemon layer.
- Correctness does not depend on parsing an engine's final stdout.
- The shared state channel is server-owned and action-oriented.
- Safe-boundary capabilities fail closed; auxiliary planning capabilities may degrade.

## ADR And Related Plan Impact

This plan needs an ADR amendment or a new ADR before implementation. It changes one accepted consequence of ADR 0022: unreadable execution-brief output is not always terminal anymore. ADR 0022 remains correct that runtime-parsed replies need a Structured Output Contract and that the parse must stay, but the current Claude Code evidence adds an adapter-compatibility branch: when the adapter cannot reliably provide that contract, the brief degrades and substantive work may continue.

Recommended ADR action:

- Add a new ADR superseding the execution-brief failure behavior in ADR 0022, or append an amendment section to ADR 0022. Prefer a new ADR if this change lands with code, because it is a product/runtime behavior change rather than a wording clarification.
- Reference ADR 0032 as preserved: terminal preparation failures still report the preparation step and its own budget; recoverable brief degradation is no longer a terminal preparation failure.
- Reference ADR 0021 to preserve the vocabulary split. Adapter support for structured brief output is not an Agent Capability (`research`, `writing`) and not a Runtime Capability (`web_research`, `run_command`). It is an adapter contract capability.
- Reference ADR 0028 as aligned: large artifacts stay file-based and runtime-validated; this plan does not move Business Artifacts into stdout structured output.

Related plan impact:

- `agent-capability-grant-plan.md`: aligned, but the new implementation must keep `noToolGrant` for execution-brief runs even when it skips `outputSchema`.
- `execution-health-p5-report.md`: aligned, but `brief-only-v1` recovery should become a fallback for terminal brief failures, not the expected route for Claude Code structured-brief incompatibility.
- `open-issues-execution-budget-and-brief-quality.md`: aligned. The earlier observation that brief time and task execution time must be distinguished remains true; this plan further distinguishes a degraded brief from a failed task.
- `department-subtask-handoff-and-acceptance-repair-plan.md` and `accepted-business-artifact-gated-dependencies-plan.md`: aligned. This plan preserves accepted/current Business Artifact handoffs and does not loosen downstream readiness.
- `ceo-office-unified-information-layer-plan.md`: no direct conflict. Its "Structured Output Contract" phase is about task completion reports, not the pre-dispatch execution brief.

## Current Failure Chain

1. Scheduler creates a task run request.
2. Scheduler calls `prepareExecutionBrief`.
3. `prepareExecutionBrief` launches the selected adapter with:
   - `grant: noToolGrant`
   - `outputSchema: executionBriefOutputSchema`
   - prompt text requiring `purpose`, `approach`, and `expectedOutcome`
4. Claude Code exits successfully but stdout contains a non-JSON status string.
5. `JSON.parse` fails.
6. `prepareExecutionBrief` rewrites the result to:
   - `status: "failed"`
   - `failureReason: "invalid_agent_output"`
   - stderr ending with `substantive work was not dispatched`
7. Scheduler treats preparation as failed and never calls the real task run.
8. Downstream tasks remain blocked by dependency readiness.

The important attribution is that the task did not fail while doing the research or producing proof. The runtime failed to obtain an auxiliary planning contract before dispatch.

## Target Behavior

When structured execution brief preparation succeeds:

1. Preserve current behavior.
2. Emit the founder-facing execution brief in the `task_started` event.
3. Append the announced plan to the substantive task prompt.

When structured execution brief preparation fails because the adapter cannot provide readable structured stdout:

1. Preserve the preparation stdout/stderr in the run log.
2. Record a warning that execution brief output was degraded.
3. Generate a minimal runtime brief from task/company facts.
4. Dispatch the substantive task to the same adapter.
5. Include the minimal brief in the task-start event and execution prompt.
6. Do not mark the task failed unless the substantive task run or final proof fails.

When execution brief preparation fails for a real launch/runtime problem:

1. Keep fail-closed behavior.
2. Do not generate a minimal brief.
3. Do not dispatch substantive work.

## Minimal Adapter Capabilities

Use a focused capability vocabulary. The existing `AgentAdapter.capabilities: string[]` currently describes work skills such as `code`, `research`, and `writing`; avoid mixing runtime contract support into the same list unless the codebase already has a clear convention for namespacing.

Recommended implementation:

```ts
export type AdapterContractCapability =
  | "structured_execution_brief"
  | "restricted_launch_isolation"
  | "artifact_envelope";

export type AgentAdapter = {
  id: string;
  name: string;
  capabilities: AgentCapability[];
  contractCapabilities?: AdapterContractCapability[];
  // ...
};
```

Initial values:

- Codex: include `structured_execution_brief` because `--output-schema` writes through the path currently expected by the runtime.
- Claude Code: omit `structured_execution_brief` until the adapter has a verified parser for the current CLI behavior.
- Both adapters can leave `artifact_envelope` unset unless there is already a concrete runtime-enforced artifact submission path.
- `restricted_launch_isolation` should reflect the launch plan result, not a static claim, if it is used in code. If that makes the first pass noisy, defer this flag and keep using `launchPlan()`.

Completion criterion:

- Code can ask whether an adapter has reliable structured execution brief support without inferring from adapter id strings.
- Existing work-skill matching still behaves unchanged.

## Execution Brief Degradation

Change `prepareExecutionBrief` to return a richer result than `brief | null`.

Recommended shape:

```ts
type ExecutionBriefPreparation =
  | {
      kind: "structured";
      result: AgentRunResult;
      brief: ExecutionBrief;
    }
  | {
      kind: "degraded";
      result: AgentRunResult;
      brief: ExecutionBrief;
      warning: string;
      cause: "unsupported_adapter_capability" | "unreadable_structured_output";
    }
  | {
      kind: "failed";
      result: AgentRunResult;
      brief: null;
    };
```

Rules:

1. If adapter lacks `structured_execution_brief`, skip requesting `outputSchema` and return `kind: "degraded"` with a minimal brief.
2. If adapter claims `structured_execution_brief` but returns known placeholder/status stdout, return `kind: "degraded"` with cause `unreadable_structured_output`.
3. If adapter claims support and returns malformed JSON that looks like an attempted brief, keep the current strict failure or degrade only if the product decision explicitly allows it. The safer first pass is to degrade only for known non-JSON adapter status strings and unsupported capability.
4. If the process fails, times out, or launch support is unavailable, return `kind: "failed"`.

Minimal brief generation:

```ts
{
  purpose: {
    [locale]: `Complete "${task.title}" for ${company.name}.`
  },
  approach: {
    [locale]: "Use the task description, founder vision, accepted upstream handoffs, and granted capabilities to produce the required proof."
  },
  expectedOutcome: {
    [locale]: `A deliverable matching proof schema ${task.proofSchemaId}.`
  }
}
```

Prefer localized strings for `zh` and `en`; keep them plain and factual. The minimal brief must not claim work has been done.

Completion criterion:

- A Claude Code adapter without reliable structured brief support still reaches the substantive `controlledAdapter.run` call.
- The generated prompt clearly labels the brief as runtime-generated or degraded so the agent knows it is not its own announced plan.

## Scheduler Changes

Update scheduler handling around the preparation result.

Current branch:

- `preparation.brief && remainingMs > 0` starts substantive work.
- otherwise the task fails before dispatch.

Target branch:

- `kind === "structured"`: current happy path.
- `kind === "degraded"`: emit warning, then run the same happy path using the minimal brief.
- `kind === "failed"` or `remainingMs <= 0`: current fail-before-dispatch path.

Event/log requirements:

- The task event stream should show a warning such as:
  - `Task warning: <title> / execution brief degraded / Claude Code did not return readable structured brief output; using runtime minimal brief.`
- The run log should retain:
  - preparation stdout
  - preparation stderr
  - degradation warning
  - whether substantive work was dispatched
- The final task failure message should no longer say `invalid_agent_output` for a degraded brief if the substantive task later succeeds.

Completion criterion:

- Dashboard users can distinguish "pre-dispatch brief degraded, work continued" from "task failed".
- Downstream tasks are blocked only by real task/proof/verification failure, not by a recoverable brief contract issue.

## Failure Attribution

Do not reuse `invalid_agent_output` for recoverable brief degradation.

Preferred additions:

- Warning/event type or message: `execution_brief_degraded`
- Cause labels:
  - `unsupported_adapter_capability`
  - `unreadable_structured_output`

Only add a new `AgentFailureReason` if a run can still fail terminally with this classification. If degradation continues execution, model it as a warning, not a failure reason.

Keep terminal failures for:

- adapter process failure
- timeout before any remaining execution budget exists
- unavailable launch isolation
- budget exhaustion
- final artifact/proof failure
- verifier rejection

Completion criterion:

- A reader of the events can tell whether no substantive work was dispatched.
- The current Claude Code status-string case is no longer presented as an agent failing the task.

## Tests

Add or update unit tests before implementation where practical.

### `executionBrief.test.ts`

Add tests:

1. Adapter without `structured_execution_brief` returns degraded minimal brief and does not request `outputSchema`.
2. Claude-style stdout `Structured output submitted.` returns degraded minimal brief.
3. Claude-style stdout `Planning brief submitted -- no execution performed.` returns degraded minimal brief.
4. Process failure still returns `kind: "failed"` and does not synthesize a brief.
5. Existing valid structured JSON still returns `kind: "structured"`.
6. Existing malformed attempted JSON behavior is pinned to the chosen rule.

Update existing tests that assert `invalid_agent_output` for every unreadable stdout. Keep a test for strict parse protection, but narrow it to adapters that claim structured support and return a malformed attempted brief, if that remains terminal.

### `scheduler.test.ts`

Add tests:

1. Degraded brief dispatches substantive work.
2. Degraded brief emits a warning/progress event.
3. Degraded brief does not set `preparationFailed`.
4. Terminal brief failure still prevents dispatch.
5. Downstream dependency status reflects the substantive task result, not the degraded brief.

### Adapter tests

Update `registry.test.ts` or adapter-specific tests:

1. Codex adapter exposes `structured_execution_brief`.
2. Claude Code adapter does not expose `structured_execution_brief` until verified.
3. Existing launch-plan warning tests for `--restricted` remain unchanged.

### Real smoke tests

Use non-paid or mock tests first:

```bash
pnpm test -- apps/server/src/runtime/executionBrief.test.ts apps/server/src/runtime/scheduler.test.ts apps/server/src/adapters/registry.test.ts
pnpm typecheck
```

Then, after unit tests pass, run the existing smoke suite that does not call paid models:

```bash
pnpm smoke:execution-health
```

A real Claude Code task run should be a separate manual validation because it may spend provider quota.

## Manual Validation Scenario

Use a fresh company/workspace. Start backend with budget policy if the validation target is the new budget path:

```bash
AUTO_CROP_PORT=8787 AUTO_CROP_EXECUTION_POLICY=budget-v1 pnpm --filter @auto-crop/cli start
```

Start dashboard:

```bash
VITE_AUTO_CROP_API_URL=http://127.0.0.1:8787 pnpm --filter @auto-crop/dashboard dev
```

Create and activate a company with a vision that decomposes into the SEO flow. Confirm:

1. Task 01 enters running/executing after preparation.
2. The event stream contains an execution-brief degradation warning if Claude Code cannot provide structured brief output.
3. The task log includes the original preparation stdout.
4. The task performs substantive work.
5. Downstream tasks remain queued only until task 01 produces accepted output, not because preparation failed.

## Rollback

Rollback should be local to the degradation behavior.

Safe rollback path:

1. Revert the `prepareExecutionBrief` result-shape change.
2. Revert scheduler handling of `kind: "degraded"`.
3. Keep any tests or documentation that only clarify the failure mode if they still pass.

Do not rollback artifact/proof/verification behavior as part of this change; it is not in scope.

## Future Architecture Direction

Record this as a follow-up, not as part of this patch:

Move task handoff toward a Cumora-style unified runtime action channel.

Target shape:

- Agents submit a small artifact envelope through a runtime command/API.
- Large outputs are files or attachments referenced by the envelope.
- Runtime stores the shared state and version/fingerprint.
- Consumers receive accepted upstream handoffs from runtime state, not predecessor stdout.
- Adapter stdout remains observability, not the source of truth for task completion.

This future direction should become its own ADR or implementation plan once the current dispatch blocker is fixed and the test path is stable.
