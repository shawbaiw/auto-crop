# Runtime Action Channel Artifact Envelope Implementation Plan

## Goal

Implement ADR 0041: task deliveries enter the runtime as Artifact Envelopes through a Runtime Action Channel, then settlement validates and records the official Business Artifact, Proof links, task transition, Holds, completion events, and downstream handoff state.

This plan is written for a new implementation session. Start by reading ADR 0041, this plan, and the context files listed below. Do not implement a daemon, wake stream, device pairing, or long-running agent computer in this slice.

## Required Reading

- `CONTEXT.md`
- `apps/server/CONTEXT.md`
- `docs/adr/0022-structured-output-contract.md`
- `docs/adr/0028-business-artifact-syntax-repair.md`
- `docs/adr/0035-a-settlement-is-one-transaction.md`
- `docs/adr/0041-runtime-action-channel-artifact-envelopes.md`
- `apps/server/src/runtime/businessArtifact.ts`
- `apps/server/src/runtime/scheduler.ts`
- `apps/server/src/runtime/taskExecutionPrompt.ts`
- `apps/server/src/adapters/types.ts`

## Non-Goals

- Do not build a Cumora-style daemon, device pairing, wake stream, online/offline projection, session recovery, rate-limit scheduler, or same-turn steering.
- Do not move task delivery into final stdout or assistant prose.
- Do not make an agent-submitted envelope a Business Artifact directly.
- Do not trust `taskId`, `companyId`, or `runId` if an envelope contains them.
- Do not create a second settlement path outside the existing one-writer settlement transaction.
- Do not remove the file implementation before the action path is covered by tests.

## Design Baseline

Settled decisions:

1. The Runtime Action Channel is task-delivery scoped in this slice.
2. The first production calling surface is an MCP tool, not a shell CLI.
3. The MCP tool accepts an Artifact Envelope only; identity comes from the current Agent Run context.
4. Calling the action records a run-local candidate.
5. Settlement uses the last valid candidate submitted by the run.
6. The official Business Artifact and Proof rows are written only in settlement.
7. Invalid action calls return structured errors so the agent can correct the envelope in the same run.
8. If the run ends without a valid envelope, settlement fails as an invalid or missing delivery.
9. The current `.auto-crop/business-artifact.json` path remains only as the current implementation path and later compatibility shim. It must convert into the same envelope path rather than remain a second model.

## Target Shape

Introduce a domain type close to:

```ts
export type ArtifactEnvelope = {
  artifactKind: "deliverable" | "blocker" | "decision_request" | "direction_change_request" | "final_report";
  artifactRole: "findings" | "plan" | "spec" | "implementation" | "validation" | "launch" | "report" | "none";
  artifactSubtype: string;
  taskType: string;
  payload: unknown;
  lineage: unknown;
  proofRefs?: ProofReference[];
  fileRefs?: FileReference[];
};
```

`ProofReference` and `FileReference` are candidate pointers. They are not Proof and not handoff packages until settlement records them.

## Implementation Slices

### Slice 1: Envelope Domain Module

Create a module that defines and validates Artifact Envelopes without touching scheduler control flow.

Suggested files:

- `apps/server/src/runtime/artifactEnvelope.ts`
- `apps/server/src/runtime/artifactEnvelope.test.ts`

Tasks:

1. Define `ArtifactEnvelope`, `ProofReference`, and `FileReference`.
2. Add a parser/validator that returns structured success or error details.
3. Reuse existing Business Artifact vocabulary where possible: artifact kind, role, subtype, task type, payload, lineage.
4. Reject trusted identity fields as authoritative. If the parser tolerates extra fields for model friendliness, ensure `taskId`, `companyId`, and `runId` are ignored and never passed through as identity.
5. Add tests for valid envelopes, invalid kind/role, missing payload, optional refs, and ignored identity fields.

Verification:

```bash
npm test -- --run apps/server/src/runtime/artifactEnvelope.test.ts
```

If this repository's test command differs, inspect `package.json` and use the matching targeted test command.

### Slice 2: Convert Current File Delivery Into Envelopes

Keep current behavior working while making the file path feed the same envelope parser.

Suggested files:

- `apps/server/src/runtime/businessArtifact.ts`
- `apps/server/src/runtime/businessArtifact.test.ts`

Tasks:

1. Extract the current `.auto-crop/business-artifact.json` parse path so it produces an `ArtifactEnvelope` first.
2. Convert the envelope into the existing `BusinessArtifact` capture result.
3. Preserve current validation behavior, including execution report requirements, action intents, open decisions, verification requirements, and environment-blocked blocker handling.
4. Keep Artifact Syntax Repair behavior unchanged for the current file path.
5. Make tests prove the file path and envelope path share validation code rather than diverging.

Verification:

```bash
npm test -- --run apps/server/src/runtime/businessArtifact.test.ts
npm test -- --run apps/server/src/runtime/artifactSyntaxRepair.test.ts
```

### Slice 3: Run-Local Action Candidate Store

Add an in-process run-local store for submitted Artifact Envelope candidates. This is not product state and not the final Business Artifact.

Suggested files:

- `apps/server/src/runtime/runtimeActionChannel.ts`
- `apps/server/src/runtime/runtimeActionChannel.test.ts`

Tasks:

1. Add a small interface for submitting an envelope candidate for a run.
2. The submit function must take run identity from trusted runtime context, not from the envelope.
3. Return structured errors for invalid envelopes.
4. Store action-call diagnostics separately from product state. Do not reuse Activity Summary for envelope contents.
5. If multiple valid envelopes are submitted for one run, make the last valid candidate the settlement candidate.
6. Provide a way for settlement to read and consume the candidate for the current run.
7. Add cleanup semantics so candidates do not leak after settlement or failed runs.

Verification:

```bash
npm test -- --run apps/server/src/runtime/runtimeActionChannel.test.ts
```

### Slice 4: MCP Tool Surface

Expose the Runtime Action Channel through an MCP tool available only when the adapter/run context supports it.

Suggested files:

- Existing adapter/MCP wiring files, discovered during implementation.
- `apps/server/src/adapters/types.ts`
- tests near the selected adapter or runtime action module.

Tasks:

1. Use the existing `AdapterContractCapability` value `artifact_envelope`.
2. Add an MCP tool shape such as `submit_artifact_envelope`.
3. The MCP tool must accept only the envelope payload.
4. The tool implementation must call the run-local action channel with trusted run context.
5. Do not expose runtime URL, task id, company id, database access, or arbitrary filesystem access through this tool.
6. If MCP integration is too large for one slice, add the server-side tool handler and a narrow fake adapter test seam first, then stop and report that production adapter wiring remains.

Verification:

Add or update tests that prove:

- an action-capable adapter prompt can refer to the action surface;
- a submitted envelope reaches the run-local candidate store;
- malformed envelopes return structured errors.

### Slice 5: Prompt Surface Selection

Make task prompts describe the real delivery surface.

Suggested files:

- `apps/server/src/runtime/taskExecutionPrompt.ts`
- `apps/server/src/runtime/taskExecutionPrompt.test.ts`
- scheduler code that calls `buildTaskExecutionPrompt`

Tasks:

1. Extend prompt input with the selected adapter contract capabilities, or an explicit delivery surface value derived by the scheduler.
2. If `artifact_envelope` is available, tell the agent to call `submit_artifact_envelope`.
3. If it is not available during migration, tell the agent to use the deprecated file shim.
4. Update the Environment-Blocked Blocker instructions so they use the same selected surface.
5. Do not ask the agent to use both action and file output.

Verification:

```bash
npm test -- --run apps/server/src/runtime/taskExecutionPrompt.test.ts
```

### Slice 6: Settlement Integration

Teach scheduler settlement to prefer the run-local Artifact Envelope candidate and fall back to the file shim only while migration remains.

Suggested files:

- `apps/server/src/runtime/scheduler.ts`
- `apps/server/src/runtime/scheduler.test.ts`
- `apps/server/src/runtime/deliveryFinalization.ts`
- `apps/server/src/runtime/dependencyReadiness.ts`

Tasks:

1. During finalization, look for a valid submitted envelope candidate for the current run.
2. If found, capture Business Artifact from that envelope and its refs.
3. If not found and file shim is still enabled, use the existing file path and convert it to an envelope.
4. If neither exists, fail as missing delivery, preserving current user-facing failure quality.
5. Keep all official writes inside the existing settlement transaction.
6. Preserve ADR 0035: no proof rows, artifact rows, task transition, Hold, completion event, or handoff pointer should be written by a losing settlement.
7. Ensure proofRefs and fileRefs are captured/snapshotted during settlement, not at action-call time.

Verification:

Add scheduler tests for:

- action envelope delivery completes a task;
- malformed action call can be corrected by a later valid call in the same run;
- last valid envelope wins;
- no valid envelope and no file shim fails clearly;
- file shim still works during migration;
- losing settlement writes no artifact/proof/handoff.

Run the targeted scheduler tests:

```bash
npm test -- --run apps/server/src/runtime/scheduler.test.ts
```

### Slice 7: Handoff Snapshot And Dependency Readiness

Bind refs to accepted artifact revisions so downstream consumers do not read live workspace drift.

Suggested files:

- `apps/server/src/runtime/proof.ts`
- `apps/server/src/runtime/verificationContract.ts`
- `apps/server/src/runtime/dependencyReadiness.ts`
- related tests.

Tasks:

1. Define how File References become snapshot files or handoff package entries.
2. Define how Proof References become Proof rows or are rejected.
3. Ensure `TaskHandoff` points to accepted runtime state, not agent-submitted refs.
4. Keep verification snapshots reading runtime-made snapshots.
5. Add tests for file refs, proof refs, and stale live workspace mutation after settlement.

Verification:

```bash
npm test -- --run apps/server/src/runtime/proof.test.ts
npm test -- --run apps/server/src/runtime/dependencyReadiness.test.ts
npm test -- --run apps/server/src/runtime/plannedVerification.test.ts
```

### Slice 8: Remove Formal File Prompting When Action Path Is Ready

Once production adapters used in tests support `artifact_envelope`, remove the file path from the normal prompt.

Tasks:

1. Keep the file shim parser only for explicit migration/test fallback.
2. Remove prompt language that says the file path is the normal delivery path.
3. Update tests that hard-code `.auto-crop/business-artifact.json` as the only successful delivery path.
4. Leave ADR 0028 repair tests only for the deprecated shim.

Verification:

Run the relevant runtime test group and at least one full scheduler path test.

## Suggested Execution Order

1. Slice 1: envelope module.
2. Slice 2: file-to-envelope conversion.
3. Slice 3: run-local action candidate store.
4. Slice 5: prompt surface selection with file fallback.
5. Slice 6: settlement integration.
6. Slice 4: MCP production tool surface, if not already required by Slice 5/6 tests.
7. Slice 7: ref snapshot/handoff strengthening.
8. Slice 8: remove formal file prompting when action-capable adapters are ready.

The order intentionally keeps current behavior passing until the action path can complete a task.

## Review Checkpoints

Stop and ask for review after:

1. Slice 2, when file delivery converts through the envelope parser but behavior should still be unchanged.
2. Slice 4, if MCP adapter integration requires a larger adapter refactor than expected.
3. Slice 6, before changing settlement behavior beyond selecting the source candidate.
4. Slice 8, before removing file delivery from normal prompts.

## Expected Final Verification

Before marking complete, run the smallest reliable set that covers the changed surfaces:

```bash
npm test -- --run apps/server/src/runtime/artifactEnvelope.test.ts
npm test -- --run apps/server/src/runtime/runtimeActionChannel.test.ts
npm test -- --run apps/server/src/runtime/businessArtifact.test.ts
npm test -- --run apps/server/src/runtime/taskExecutionPrompt.test.ts
npm test -- --run apps/server/src/runtime/scheduler.test.ts
npm test -- --run apps/server/src/runtime/proof.test.ts
npm test -- --run apps/server/src/runtime/dependencyReadiness.test.ts
```

Also run the repository's normal typecheck/lint/test command if available in `package.json`.

## Handoff Prompt For A New Session

Use this prompt in the new implementation conversation:

```text
Implement docs/runtime-action-channel-artifact-envelope-plan.md. Start by reading ADR 0041 and the required context files. Review the plan critically before coding. Use a feature branch or worktree. Stop for review at the listed checkpoints. Do not build daemon/pairing/wake-stream features in this slice.
```
