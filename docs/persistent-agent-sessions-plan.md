# Persistent Agent Sessions Implementation Plan

## Goal

Add an experimental Persistent Agent Session capability for planning and coordination work so eligible agents can reuse context across Agent Runs without changing Auto-Crop's Proof-gated task model.

## Architecture

Auto-Crop keeps One-shot Agent Runs as the default. A Session Policy may allow selected planning paths to attempt an Agent Session when `AUTO_CROP_EXPERIMENTAL_AGENT_SESSIONS=1` is set and the selected adapter exposes a session capability. If the session path is unavailable before task execution starts, the runtime falls back to one-shot and records concise Agent Activity.

Persistent sessions are an execution optimization, not a deliverable channel. The scheduler must still build the task prompt from the task description, upstream handoffs, Consumable Proof, and Handoff Package paths. Session Memory must never replace Proof, Dependency Readiness, or Handoff Package inputs.

## Non-Goals

- Do not build a BYOA daemon, Cumora-style Computer concept, or long-running orchestration engine.
- Do not make sessions the default execution model.
- Do not let sessions change Effective Timeout, bounded recovery, `needs_replan`, Proof capture, or dependency gating.
- Do not allow Worker tasks to share cross-task session context in the first version.
- Do not add dashboard session UI in the first version.
- Do not persist a recoverable session handle in SQLite in the first version.

## Cumora Lessons To Borrow

- **Optional session adapter:** Cumora's engine adapter shape uses a persistent `startSession` path with one-shot `run` fallback. Auto-Crop should use the same discipline without copying the daemon architecture.
- **Standing prompt plus per-run delta:** Deliver stable instructions once per session when supported, but still send each task's explicit prompt delta and handoff context.
- **Separate local session state:** Keep session state outside task workspaces, under `.auto-crop/sessions/<companyId>/<agentId>/<permissionMode>/`.
- **Probe before relying on sessions:** A failed session probe should mean "run one-shot", not "agent unavailable".
- **Reset bad sessions:** Stale resume ids, context overflow, dead processes, or permission errors should drop the session instead of wedging future work.
- **Code mechanisms over prompt rules:** Correctness must come from scheduler policy, Proof, and Handoff Package contracts, not from asking the agent to remember boundaries.

## Domain Rules

- **Agent Run** remains the auditable task attempt.
- **Agent Session** is a reusable context container for a company, agent, and Permission Mode.
- **Session Memory** is not Proof, Consumable Proof, a Task Deliverable, or a Handoff Package.
- **Session Policy** decides eligibility; Proof Schema only describes the required deliverable.
- **Emergency Stop** is the user-facing command that stops active Agent Runs and active Agent Sessions.

## Session Key

Use:

```text
companyId + agentId + permissionMode
```

Permission Mode is part of the key so a session created under one execution policy cannot silently carry assumptions into another policy.

## First Eligible Paths

Start with explicit runtime call sites only:

- CEO blueprint generation.
- Replan planner proposal generation.

Do not infer eligibility from `proofSchemaId`, `requiredCapabilities`, task title, or task description. Do not enable ordinary Worker task sessions in the first version.

## Adapter Shape

Keep the current `AgentAdapter.run()` contract. Add optional session support beside it:

```ts
type AgentSessionMode =
  | "one_shot"
  | "persistent_used"
  | "persistent_fallback";

type AgentSessionKey = {
  companyId: string;
  agentId: string;
  permissionMode: string;
};

type AgentSessionProbeResult =
  | { status: "available" }
  | { status: "unavailable"; reason: string };

type AgentSession = {
  id: string;
  key: AgentSessionKey;
  alive: boolean;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  stop(reason: string): void;
};

type AgentSessionCapability = {
  probe?(key: AgentSessionKey): Promise<AgentSessionProbeResult>;
  getOrStart(key: AgentSessionKey): Promise<AgentSession | null>;
};
```

The exact names can change during implementation, but the shape should preserve these constraints:

- Existing adapters remain valid without session support.
- Session setup can return `null` to request one-shot fallback.
- One session can run only one Agent Run at a time.
- The scheduler/runtime owns lifecycle and fallback behavior.

## Fallback Rules

- If sessions are not enabled, do not mention sessions.
- If sessions are enabled but the adapter has no session capability, run one-shot.
- If probe or `getOrStart` fails before execution starts, run one-shot and record: `Session unavailable; ran one-shot.`
- If session execution has already started and produced output or side effects, do not rerun one-shot automatically. Treat the result as the Agent Run result.
- If a session dies after a run, drop it so the next eligible run starts fresh or falls back.

## Lifecycle Rules

- Session handles are process-local in the first version.
- Server restart does not resume a prior Agent Session.
- Session state on disk is disposable runtime state, not a source of truth.
- Emergency Stop closes active Agent Sessions for the company as well as active Agent Runs.
- Session cleanup must not delete Proof, Handoff Packages, logs, or task artifacts.

## Telemetry

First implementation can use Agent Activity only. Suggested messages:

- `Session unavailable; ran one-shot.`
- `Persistent session used.`
- `Persistent session reset: <reason>.`

Design toward future `agent_runs` fields without requiring them immediately:

- `session_mode`
- `session_key`
- `session_id`
- `session_fallback_reason`

Do not create an `agent_sessions` table in the first version.

## Implementation Tasks

### Task 1: Add Session Domain Terms And ADR

- [x] Add glossary terms for Agent Session, Session Memory, One-shot Agent Run, Session Policy, and Emergency Stop.
- [x] Add ADR 0004 recording optional persistent sessions as an opt-in architecture choice.

### Task 2: Add Session Policy Module

Status: Done.

Files:

- Create: `apps/server/src/runtime/sessionPolicy.ts`
- Test: `apps/server/src/runtime/sessionPolicy.test.ts`

Behavior:

- [x] Reads `AUTO_CROP_EXPERIMENTAL_AGENT_SESSIONS`.
- [x] Returns disabled by default.
- [x] Allows only explicit planning/coordination call sites.
- [x] Produces a session key from company id, agent id, and Permission Mode.
- [x] Never uses Proof Schema or capabilities to infer eligibility.

Verification:

- [x] Env unset: no session attempt.
- [x] Env set: CEO blueprint/replan planner eligible.
- [x] Worker task: not eligible even with env set.

### Task 3: Extend Adapter Types With Optional Session Capability

Status: Done.

Files:

- Modify: `apps/server/src/adapters/types.ts`
- Test: `apps/server/src/adapters/registry.test.ts`

Behavior:

- [x] Existing adapters still satisfy `AgentAdapter`.
- [x] Session capability is optional.
- [x] No real Claude/Codex session flags are introduced in this task.

Verification:

- [x] Typecheck existing mock, CLI, Claude, and Codex adapters.
- [x] Add a fake adapter with session capability for runtime tests.

### Task 4: Add Runtime Session Manager

Status: Done.

Files:

- Create: `apps/server/src/runtime/agentSessions.ts`
- Test: `apps/server/src/runtime/agentSessions.test.ts`

Behavior:

- [x] Holds process-local sessions keyed by company id, agent id, and Permission Mode.
- [x] Serializes one in-flight run per session.
- [x] Falls back to one-shot before execution starts when probe/start fails.
- [x] Drops dead sessions.
- [x] Exposes `stopCompanySessions(companyId, reason)` for Emergency Stop.

Verification:

- [x] Same key reuses a live session.
- [x] Busy session does not run concurrent turns.
- [x] Stop company sessions calls `stop()` only for matching company sessions.
- [x] Different Permission Mode creates a different session.
- [x] Failed probe returns fallback.

### Task 5: Wire Explicit Planning Paths

Status: Done.

Files:

- Modify: `apps/server/src/runtime/createCompany.ts`
- Modify: `apps/server/src/runtime/replan.ts`
- Tests near existing create company and replan planner tests.

Behavior:

- [x] CEO blueprint generation may attempt a session when enabled and eligible.
- [x] Replan planner generation may attempt a session when enabled and eligible.
- [x] Ordinary scheduler Worker tasks remain one-shot.
- [x] Prompts still include explicit task context and handoff contracts where applicable.
- [x] New companies persist Permission Mode so replan planner session keys do not guess policy context.

Verification:

- [x] Env disabled: current behavior unchanged.
- [x] Env enabled with fake session adapter: planning path uses session.
- [x] Env enabled but session unavailable: planning path falls back one-shot and records concise Agent Activity.

### Task 6: Emergency Stop Session Shutdown

Status: Done.

Files:

- Modify: `apps/server/src/runtime/killSwitch.ts`
- Test: `apps/server/src/runtime/killSwitch.test.ts`

Behavior:

- [x] Emergency Stop closes active Agent Sessions for the company.
- [x] Queued tasks are not deleted.
- [x] Scheduler is not permanently stopped.
- [x] Current internal function names can remain `killSwitch`.

Verification:

- [x] Active session receives stop reason.
- [x] Existing kill switch task/run behavior remains unchanged.

### Task 7: Real Adapter Session Probe Only

Status: Not started.

Files:

- Modify: `apps/server/src/adapters/cliAgent.ts`
- Tests in adapter registry/CLI adapter tests.

Behavior:

- Add optional probe shape only if the real CLI can be tested cheaply.
- Do not start real persistent Claude/Codex sessions in this task.
- Report unavailable wake/session path as fallback, not adapter failure.

Verification:

- Missing CLI still reports adapter unavailable through existing detection.
- Session probe failure does not block one-shot adapter use.

## Manual Smoke Criteria Before Real CLI Sessions

Do not enable real Claude Code or Codex persistent sessions until all are true:

- A probe confirms the CLI's persistent session path is available.
- One-shot fallback passes existing task execution smoke tests.
- A planning session can run twice without losing Proof/Handoff prompt inputs.
- Emergency Stop leaves no stuck running Agent Run or Agent Session.
- No session state appears in Proof or Handoff Package outputs.

## Success Metrics

- Eligible planning tasks repeat less static context in prompts.
- Fallback does not reduce task completion or review readiness.
- No regression in Proof capture, Handoff Package generation, Dependency Readiness, or bounded recovery.
- Emergency Stop leaves no stuck running session.

## Open Questions For Implementation Time

- Whether to persist `session_mode` on `agent_runs` in the first code change or defer it until dashboard/reporting needs it.
- Whether session fallback warnings should be deduped per session key or per company.
- Whether real Claude Code and Codex session support should land in separate PRs after the policy and manager exist.
