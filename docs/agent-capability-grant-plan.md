# Agent Capability Grant Implementation Plan

## Goal

Replace the single hardcoded agent launch command with an **Agent Capability Grant** computed per Agent Run from the company's Permission Mode and the task's Capability Needs. Research tasks must reach the live web; no task may hold a capability it did not ask for; and no run may inherit the operator's machine configuration. See ADR 0021.

## Reported Failure This Fixes

`Research SEO keyword opportunities` (proof schema `research-report`) delivered keyword screening "from experience, in a sandbox environment with no live keyword tooling", and Automatic Acceptance passed it.

There was no sandbox. `createClaudeCodeAdapter` launched `claude -p --permission-mode acceptEdits --no-session-persistence`, and `acceptEdits` auto-approves file edits only. Verified against the real CLI:

| Command | Result |
| --- | --- |
| `claude -p --permission-mode acceptEdits …` | `Claude requested permissions to use WebSearch, but you haven't granted it yet.` |
| `… --allowedTools WebSearch WebFetch` | live search results returned |
| `… --restricted --strict-mcp-config --permission-prompts none --tools Read Write Edit Glob Grep WebSearch WebFetch --allowedTools WebSearch WebFetch --permission-mode acceptEdits` | search returns results; `Bash` is absent from the toolset; file writes still succeed |

## Decisions

- Derive the grant in one module. Adapters translate a grant into flags and read nothing else about the task.
- Fail closed at the base launch, then grant capabilities back. Never widen a permissive default.
- Keep **Runtime Capability** (what a process may do) separate from **Agent Capability** (what an adapter is good at, used for selection). Do not overload `requiredCapabilities`.
- Express the web decision in the Action Policy the runtime already owns, as `read_public_web`, so Permission Mode stays the single policy surface.
- Tell the agent its grant in the prompt. A capability the agent has to discover is a capability it will narrate incorrectly.
- Refute an Environment-Blocked Blocker that names a granted capability, rather than degrading the task.
- Raise the execution budget floor from the grant, not from a new proof-schema row.
- Do not add database columns in this version. The grant is runtime-derived, like Task Execution Profile before it.

## Runtime Capability Vocabulary

| Runtime Capability | Meaning | Claude Code tools | Codex |
| --- | --- | --- | --- |
| `workspace_read` | Read files inside the run's working directories | `Read`, `Glob`, `Grep` | always on |
| `workspace_write` | Create and edit files there | `Write`, `Edit` | `--sandbox workspace-write` |
| `run_command` | Run shell commands | `Bash` | `--sandbox workspace-write` (shell enabled) |
| `web_research` | Search the public web and fetch pages | `WebSearch`, `WebFetch` | `-c tools.web_search=true` |

`workspace_read` and `workspace_write` are in every grant. The table is exhaustive over the union, so a capability added later must state its mapping for every adapter.

## Task Capability Needs

Derived from the task, in `resolveTaskCapabilityNeeds`:

| Signal | Adds |
| --- | --- |
| always | `workspace_read`, `workspace_write` |
| `requiredCapabilities` contains `research` | `web_research` |
| proof schema `research-report` | `web_research` |
| `requiredCapabilities` contains `code`, `frontend`, `test`, or `refactor` | `run_command` |
| proof schema `repo-diff`, `test-output`, or `landing-page-file` | `run_command` |

`product-brief` is deliberately absent from the web row. A brief synthesizing accepted upstream handoffs needs no web, and granting it one on schema alone would push every brief past the `short` budget for a capability most never use — leaving `short` unreachable. A brief that does need the web says so by declaring `research`.

CEO blueprint, replan planner, and Final Founder Report runs are not tasks. They get a fixed planning grant: workspace read/write plus `web_research`, no `run_command`. An Execution Brief run, which only reasons and returns JSON, gets a grant of nothing — "do not use tools" becomes a property of the launch rather than an instruction.

## Permission Mode Mapping

Add `read_public_web` to `actionTypes`:

| Mode | `read_public_web` |
| --- | --- |
| `safe` | `ask` |
| `balanced` | `auto` |
| `autonomous` | `auto` |

`ask` resolves through the existing pre-dispatch Founder Approval check, which already uses one coarse decision for the whole task, so `safe` gains no second approval surface. A capability whose decision is `deny` is dropped from the grant and named in the prompt as unavailable.

Policy only narrows. The final grant is `needs ∩ policy-allowed`, never the union.

## Launch Shape

Built by the adapter from the grant, replacing `commandTemplate`.

Claude Code:

```
claude -p
  --restricted                # removes shell/code tools and WebFetch; ignores user, project and local settings;
                              # confines file tools to the working directories; refuses bypassPermissions
  --strict-mcp-config         # no host MCP servers
  --permission-prompts none   # anything that would prompt is denied deterministically, not accidentally
  --tools <granted tool names>        # "" for a grant of nothing
  --allowedTools <granted tool names> # omitted when the grant is empty
  --permission-mode acceptEdits
  --no-session-persistence
  -- <prompt>
```

`--tools` sets which built-in tools exist; `--allowedTools` pre-answers the permission prompt for the ones that would otherwise ask. Both are needed: the first without the second reproduces the original bug for `WebSearch`.

No `--add-dir`: the scheduler already resolves one run workspace (`resolveRunWorkspace`) and uses it as both cwd and the Proof collection root, so `--restricted`'s confinement to the working directory is the right boundary as it stands.

Codex:

```
codex exec -m <model> -C <workspace>
  --ignore-user-config --ignore-rules   # the config-isolation half, as Cumora does it
  --skip-git-repo-check --ephemeral
  --sandbox workspace-write | read-only  # read-only when the grant has no run_command
  -c tools.web_search=true|false
  <prompt>
```

The Codex `web_search` config key is mapped but **not smoke-tested against a live run**; the Claude Code path is the verified one — the generated Claude Code command was run end to end and returned live search results and a written file.

## Prompt And Proof Contract

The task prompt gains a `## Granted Capabilities` section listing what this run holds and what it does not, and one rule: when the task cannot be done with what was granted, file an Environment-Blocked Blocker naming the missing capability — do not substitute estimates and submit a deliverable.

Findings that rest on assumptions rather than retrieved evidence belong in the artifact's `validationLimits`, not in prose that reads as research.

## Grant Refutation

`verifyEnvironmentBlockerClaim` gains the mirror of ADR 0016's confirmation path. A blocker whose `payload.capability` names a Runtime Capability the run was granted is **refuted**: the task does not degrade to a deliverable, and it fails with a message naming the granted capability. A blocker naming a capability outside the grant (`keyword_data`, `browser_screenshot`) is untouched by this rule.

## Execution Budget

`resolveTaskExecutionProfile` keeps its proof-schema table, and a grant containing `web_research` raises the result to at least `medium`. Observed: `research-report` resolved to `short` (120s); one research task failed there and the one that completed needed the 300s that bounded recovery escalated to. Deriving the floor from the grant means a later wall-clock-costly capability inherits the rule.

## Sessions

An Agent Session is a live process holding the capabilities it was started with, so the grant joins `AgentSessionKey`. Two runs with different grants must not share a session. This extends the existing reason Permission Mode is in the key (`docs/persistent-agent-sessions-plan.md`, Session Key) rather than replacing it.

This change also completes **Task 7** of that plan — a real adapter probe — and no more. The probe reports whether the CLI exposes the persistent stream-json session path; failure means one-shot, never adapter-unavailable.

The session command shape, for when the plan's Manual Smoke Criteria are met:

```
claude -p --input-format stream-json --output-format stream-json --verbose <grant flags>
```

## Implementation Order

1. Add `read_public_web` to `actionTypes` and to the three default policies.
2. Create `apps/server/src/policies/capabilityGrant.ts`: Runtime Capability union, `resolveTaskCapabilityNeeds`, `resolveAgentCapabilityGrant`, planning grant, and a stable `grantId` for session keying.
3. Extend `AgentRunRequest` with `grant`, and `AgentSessionKey` with the grant id.
4. Replace `commandTemplate` in `cliAgent.ts` with a grant-driven argument builder per adapter; keep `commandPreview`.
5. Add the probe (`persistent-agent-sessions-plan.md` Task 7).
6. Raise the execution profile floor from the grant.
7. Add the `## Granted Capabilities` prompt section and the no-silent-degradation proof-contract rule.
8. Add grant refutation to the environment-blocker verification path.
9. Wire the scheduler, `createCompany`, and `replan` to resolve and pass a grant.
10. Tests: grant derivation, policy narrowing, flag construction per adapter, profile floor, refutation, and a regression test pinning that a `research` task's grant contains `web_research`.

## This Version Does Not Do

- No `keyword_data` capability. Real search volume, difficulty, and CPC need a credentialed source (Google Ads, DataForSEO, Search Console) behind an MCP server whose keys stay in the runtime. Until then a research task cites sources and declares the absent metrics as validation limits.
- No live persistent Claude Code or Codex session. The plan's Manual Smoke Criteria gate that, and they need supervised real runs.
- No BYOA daemon, device pairing, or MCP tool bridge. ADR 0004 declined that shape; this change borrows Cumora's fail-closed posture only.
- No per-action grant narrowing during a run. It arrives with per-action approval.
- No database columns and no dashboard surface for grants.
