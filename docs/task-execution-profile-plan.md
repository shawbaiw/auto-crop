# Task Execution Profile Plan

## Goal

Fix the current one-size-fits-all agent timeout by introducing Task Execution Profiles. The first version should let short writing tasks finish quickly, give engineering and validation tasks enough time, and make timeout/no-proof failures visible without weakening the Proof gate.

## Decisions

- Use `proofSchemaId` as the primary profile selector.
- Use `requiredCapabilities` only for fallback or unknown schemas.
- Keep profiles as runtime-derived data in the first version; do not add database columns.
- Let task-level profile timeout override adapter defaults.
- Superseded by `docs/runtime-observability-and-artifact-workspace-plan.md`: `AUTO_CROP_AGENT_TIMEOUT_MS` should not silently lower a task profile budget. Use `AUTO_CROP_FORCE_AGENT_TIMEOUT_MS` for deliberate full override test runs.
- Keep timed-out tasks in `failed`; Partial Output remains useful but does not make a task complete.
- Keep UI changes inside existing dashboard components.

## Profile Mapping

| Proof schema | Profile | Budget |
| --- | --- | --- |
| `product-brief` | `short` | 120s |
| `research-report` | `short` | 120s |
| `repo-diff` | `medium` | 300s |
| `test-output` | `long` | 600s |
| `landing-page-file` | `long` | 600s |
| fallback | `medium` | 300s |

## Failure Reasons

First-version scheduler events should distinguish:

- `timeout`: the agent process exceeded its budget.
- `agent_failed`: the adapter returned failed for a non-timeout reason.
- `no_proof`: the agent completed but no matching Proof was captured.
- `proof_capture_failed`: Proof collection threw for the current task.

Proof collection errors should fail only the current task and release its lock. They should not fail the whole scheduler tick.

## Implementation Order

1. Add a server-side execution profile resolver.
2. Extend `AgentRunRequest` with an optional task timeout.
3. Have CLI adapters resolve an effective timeout from request timeout and environment rules, without letting normal environment configuration silently reduce a task profile budget.
4. Have the scheduler calculate a task profile, pass its timeout, and emit clearer start/failure messages.
5. Update dashboard task displays using existing `RetroBadge`, `VideotexLog`, and related primitives.
6. Add server and dashboard tests.

## This Version Does Not Do

- No Cumora-style persistent engine sessions or BYOA daemon.
- No automatic retry.
- No automatic follow-up task creation.
- No new `partial` task status.
- No database migration or persisted `failure_reason` / `execution_profile` fields.
- No new dashboard component system.
- No task refresh API.
- No change to the rule that tasks need Proof before they can enter review.

## Suggested Next Steps

- Detect Partial Output after timeout and show entry files/log paths more clearly in the UI.
- Design a follow-up task policy that continues from Partial Output instead of restarting from scratch.
- Decide whether `failureReason` and `executionProfile` should become persisted task or agent-run fields.
- Add a task refresh API so the dashboard can reconcile state after reconnects or missed SSE events.
- Re-evaluate persistent agent sessions once task profiles and failure visibility are stable.

## Verification

- Server tests cover `landing-page-file` resolving to a long timeout.
- Server tests cover `AUTO_CROP_AGENT_TIMEOUT_MS` overriding profile timeout.
- Server tests cover timeout failures producing timeout-specific events/messages.
- Server tests cover Proof collector errors failing only the current task.
- Dashboard tests cover timeout failure messages in existing task displays.
- Dashboard tests cover task start messages including the execution budget.

Run:

```bash
pnpm --filter @auto-crop/server test
pnpm --filter @auto-crop/server typecheck
pnpm --filter @auto-crop/dashboard test
pnpm --filter @auto-crop/dashboard typecheck
```
