# Launch Policy And Adapter Translation Plan

## Goal

Make Agent Run launch isolation a project-level semantic contract, then let each CLI adapter translate that contract into the flags its CLI actually supports.

This plan fixes the class of failures where Auto-Crop hardcodes a concrete CLI flag, such as Claude Code `--restricted`, and discovers only at task runtime that the installed CLI does not support it.

## Current Problem

ADR 0021 correctly says an Agent Run should execute under an explicit capability grant rather than inheriting the operator's machine. The current implementation partially encodes that decision directly in adapter argv construction:

- Claude Code always includes `--restricted`.
- Codex uses its own isolation flags such as `--ignore-user-config`, `--ignore-rules`, `--sandbox`, and `--ephemeral`.
- Adapter detection mostly answers "does this command exist?", not "can this installed CLI enforce the launch semantics Auto-Crop needs?"

The result is brittle. A task can be scheduled to an adapter that exists but cannot run the requested launch shape. The failure then appears as an agent task failure instead of an adapter capability mismatch.

## Design Principle

Safety semantics are unified. CLI flags are adapter-specific.

Auto-Crop should own the vocabulary for what an Agent Run requires:

- config isolation
- project-rule isolation
- workspace-scoped file access
- explicit tool grants
- non-interactive denial of ungranted permissions
- ephemeral session behavior

Adapters own the translation from that vocabulary to CLI flags.

## New Module

Add a module under `apps/server/src/adapters/launchPolicy.ts`.

This should be a deep module: callers ask it for a launch profile and command builders consume that profile. Callers should not parse CLI help text, inspect flags, or know which flag belongs to which CLI.

### Interface

```ts
export type LaunchIsolationLevel = "strong" | "compatible" | "unavailable";

export type LaunchPolicy = {
  ignoreUserConfig: boolean;
  ignoreProjectRules: boolean;
  workspaceBoundary: "cli_enforced" | "cwd_only";
  toolGrantControl: "explicit";
  permissionPromptPolicy: "deny_non_interactive";
  ephemeral: boolean;
};

export type AdapterLaunchSupport = {
  adapterId: string;
  isolationLevel: LaunchIsolationLevel;
  supportedFlags: string[];
  missingFlags: string[];
  warnings: string[];
};

export type LaunchPlan = {
  policy: LaunchPolicy;
  support: AdapterLaunchSupport;
};
```

The exact names can change during implementation, but keep the interface small. The caller should need only:

```ts
const launchPlan = await resolveAdapterLaunchPlan(adapterId);
```

or, if simpler inside the existing adapter factory:

```ts
const launchPlan = await probeClaudeCodeLaunchSupport();
```

## Default Policy

The default Agent Run policy should express ADR 0021:

```ts
{
  ignoreUserConfig: true,
  ignoreProjectRules: true,
  workspaceBoundary: "cli_enforced",
  toolGrantControl: "explicit",
  permissionPromptPolicy: "deny_non_interactive",
  ephemeral: true
}
```

When an installed CLI cannot enforce the full policy, the adapter must report a downgraded support profile before task dispatch.

## Claude Code Translation

Claude Code should continue using explicit tool grants:

- `--tools <tools>`
- `--allowedTools <tools>`
- `--strict-mcp-config`
- `--permission-mode acceptEdits`
- `--no-session-persistence`

Add `--restricted` only when the installed `claude --help` reports that it is supported.

If `--restricted` is missing but the other required grant-control flags exist:

- mark isolation as `compatible`
- omit `--restricted`
- include a warning such as:
  `Claude Code does not support --restricted; using compatibility launch isolation.`

If any of these are missing, mark Claude Code unavailable for task runs:

- `--tools`
- `--allowedTools` or `--allowed-tools`
- `--strict-mcp-config`
- `--permission-mode`

Treat `--permission-prompts none` as optional unless the installed CLI supports it. Do not pass it blindly.

### Claude Compatibility Meaning

Without `--restricted`, Claude Code can still get explicit tool grants and MCP isolation, but Auto-Crop should not claim full ADR 0021 isolation. The adapter should record that file/config isolation is compatible, not strong.

## Codex Translation

Codex should translate the same policy into Codex flags:

- `codex exec`
- `-C <workspace>`
- `--ignore-user-config`
- `--ignore-rules`
- `--skip-git-repo-check`
- `--sandbox read-only` when `run_command` is not granted
- `--sandbox workspace-write` when `run_command` is granted
- `--ephemeral`
- `-c tools.web_search=true|false`

Probe `codex exec --help` or the most reliable available help command before task dispatch. If Codex lacks a required flag, mark it unavailable for task runs rather than discovering the mismatch inside a task log.

## Where The Seam Lives

Keep the external seam at the adapter interface:

- `AgentAdapter.detect()` should mean the adapter is usable for Auto-Crop's launch semantics, not merely that the executable exists.
- `CliAgentAdapter.commandPreview()` should show the actual command for the probed support profile.
- `AgentRunRequest.grant` remains the runtime capability input; it should not grow CLI-specific fields.

Use an internal seam for CLI help probing so tests can inject help text without spawning real CLIs.

Suggested internal helper:

```ts
type CliHelpProbe = {
  command: string;
  args: string[];
  parse(output: string): AdapterLaunchSupport;
};
```

## Scheduler Behavior

Do not dispatch a task to an adapter whose launch support is `unavailable`.

For `compatible` support, choose one of these explicit behaviors:

1. Dispatch with a task warning event before the run.
2. Dispatch only when a feature flag allows compatible isolation.

Prefer option 1 for now because Auto-Crop is local-first and should stay usable while still surfacing the downgrade.

The warning should be visible in task events and logs. It should not be buried only in server stdout.

## Tests

Replace tests that assert one hardcoded flag list with semantic and variant tests.

### Claude Tests

Add tests for:

- Claude help with `--restricted`: command includes `--restricted`.
- Claude help without `--restricted`: command omits `--restricted`, adapter support is `compatible`, and warning is present.
- Claude help without `--tools`: adapter is unavailable.
- Research grant exposes and pre-approves `WebSearch` and `WebFetch`.
- Non-research grant omits `WebSearch` and `WebFetch`.
- Shell capability remains absent for research-only grants.

### Codex Tests

Add tests for:

- Research grant sets `tools.web_search=true`.
- Non-research grant sets `tools.web_search=false`.
- Grant with `run_command` uses `--sandbox workspace-write`.
- Grant without `run_command` uses `--sandbox read-only`.
- Missing required Codex isolation flag marks adapter unavailable.
- Codex command never includes Claude-only flags such as `--restricted`.

### Registry Tests

Add tests for:

- `selectByCapabilities` skips adapters whose executable exists but launch support is unavailable.
- Compatible adapters remain selectable and carry warnings.

## Execution Steps

1. Add launch support types and probe helpers in `apps/server/src/adapters/launchPolicy.ts`.
2. Update `createCliAgentAdapter` or adapter-specific factories so build commands can receive a launch plan.
3. Update Claude Code adapter to include `--restricted` only when supported.
4. Update Codex adapter to report required flag support from help output.
5. Update adapter detection so it accounts for launch support.
6. Surface compatible-mode warnings in task events before agent execution.
7. Rewrite adapter tests around semantics and help-output variants.
8. Run:

```bash
pnpm --filter @auto-crop/server test
pnpm --filter @auto-crop/server typecheck
pnpm test
pnpm typecheck
```

## Non-Goals

- Do not change `AgentCapabilityGrant` semantics.
- Do not change permission-mode policy decisions.
- Do not add a new runtime capability.
- Do not make Codex and Claude share a flag list.
- Do not silently fall back from explicit tool control to unrestricted execution.

## Acceptance Criteria

- A Claude Code install that lacks `--restricted` no longer fails with `unknown option '--restricted'`.
- The same install records a visible compatible-isolation warning.
- A Claude Code install that supports `--restricted` still uses it.
- Codex launches never receive Claude-only flags.
- Adapter tests cover supported, compatible, and unavailable launch profiles.
- Task failure logs no longer contain CLI unknown-option failures for flags Auto-Crop could have probed before dispatch.
