# An Agent Run Executes On A Capability Grant, Not On The Operator's Machine

Status: accepted

## Context

A keyword research task (`Research SEO keyword opportunities`, proof schema `research-report`, `requiredCapabilities: ["research","writing"]`) returned a deliverable stating that, "in a sandbox environment with no live keyword tooling", it had qualitatively screened eight keyword opportunities from prior knowledge. Automatic Acceptance passed it. The company's first business decision was therefore made on guesses labelled as research.

There was no sandbox. Every Agent Run was launched from one constant in `createClaudeCodeAdapter`:

```
claude -p --permission-mode acceptEdits --no-session-persistence -- {prompt}
```

`acceptEdits` auto-approves file edits and nothing else. `WebSearch` and `WebFetch` still require a permission answer, and `-p` is non-interactive, so no answer ever arrives. Reproduced directly against that exact command: it answers `Claude requested permissions to use WebSearch, but you haven't granted it yet.` The same command with `--allowedTools WebSearch WebFetch` returns live results. The network was never blocked and the process was never confined.

Three defects fall out of that one constant:

1. **A capability the task needs is absent.** The agent meets the denial mid-run with no vocabulary for it, invents one — "sandbox" — degrades the deliverable to estimates, and still submits `artifact_kind: "deliverable"`, which Automatic Acceptance cannot distinguish from researched findings.
2. **Capabilities the task does not need are present.** `Bash`, host-wide file reads, and the operator's MCP servers are available to every task in every Permission Mode, including `safe`.
3. **The run inherits the operator's machine.** The workspace `.auto-crop/workspaces/task_*` sits inside the operated repository, so a run picks up whatever `.claude/` settings, skills, hooks, and `CLAUDE.md` that machine happens to carry. The same task is a different task on a different laptop, and nothing records which one ran.

The runtime already computes an Action Policy from the company's Permission Mode, and every task already declares `requiredCapabilities`. Neither reaches the agent process. The grant is a constant where it should be a function.

## Decision

An Agent Run executes under an **Agent Capability Grant**: the explicit set of Runtime Capabilities the runtime computes for that run from the company's Permission Mode and the task's Capability Needs, and passes to the agent process as launch flags. Nothing is inherited from the host machine, and nothing about the grant is discovered by the model at run time.

Four rules, each enforced rather than documented:

1. **Fail closed, then grant back.** The base launch removes the command-running and code-running tools, ignores user, project, and local settings files, skips host MCP servers, confines the file tools to the run's working directories, and denies anything that would otherwise prompt. Capabilities return only by appearing in the grant. Claude Code expresses this as `--restricted --strict-mcp-config --permission-prompts none --tools <granted>`; Codex as `--ignore-user-config --ignore-rules --sandbox workspace-write`. The posture is borrowed from Cumora's BYOA daemon, which denies its agents web and shell tools by default and hands back one audited surface. We take the posture without the daemon — ADR 0004 already declined the daemon shape, and nothing here reverses that.

2. **The grant is derived at one seam.** `resolveAgentCapabilityGrant` is the only place that decides what a run may do. It reads the company's Permission Mode and the task's Capability Needs and returns a grant; adapters translate a grant into their own flags and decide nothing. A per-task flag tweak in an adapter is the defect this ADR exists to remove, so the adapter is given no task to look at.

3. **The agent is told its grant.** The task prompt states which Runtime Capabilities this run holds and which it does not. An agent that has to discover a denial will narrate the denial, and the narration is what became "sandbox environment". Being told up front is also what makes rule 4 fair.

4. **The runtime is the authority on what it granted, so a capability blocker is refutable.** An Environment-Blocked Blocker naming a capability the run was *granted* is rejected: the task fails rather than degrading, and the failure names the contradiction. This is the mirror of ADR 0016. There, runtime-held evidence could *confirm* a blocker the agent could not prove; here, runtime-held evidence *refutes* one the agent should not have filed. Both rest on the same principle — the runtime decides from facts it owns, not from the agent's account of its environment.

### Runtime Capability is not Agent Capability

Two vocabularies that a shared word would collapse:

- **Agent Capability** (`code`, `frontend`, `research`, `writing`, `test`, `refactor`) describes what an adapter is *good at*. It selects which agent runs the task. Unchanged.
- **Runtime Capability** (`workspace_read`, `workspace_write`, `run_command`, `web_research`) describes what a process is *permitted to do*. It is what the grant contains.

**Task Capability Needs** maps the first to the second, from the task's proof schema and required capabilities. A task needing `research` needs `web_research`. A task producing `repo-diff`, `test-output`, or `landing-page-file` needs `run_command`. Every task needs workspace read and write. The mapping is exhaustive over Runtime Capability, so a capability added later cannot silently default to granted.

### Permission Mode decides, through the policy it already owns

`read_public_web` joins `actionTypes`: `ask` in `safe`, `auto` in `balanced` and `autonomous`. An `ask` decision routes through the Founder Approval the scheduler already performs before dispatch, so `safe` mode asks once for the whole task rather than growing a second approval surface. `deny` is expressible and no default mode uses it.

Permission Mode can only narrow a grant. A task that does not need `run_command` does not get it in `autonomous`; a company in `autonomous` does not get capabilities its tasks never asked for. Need and policy are an intersection, not a maximum.

### A grant is part of a session's identity

`AgentSessionKey` gains the grant. A Persistent Agent Session is a live process holding whatever capabilities it was started with, so serving a second run from it hands that run the first run's grant. Today sessions are limited to `ceo_blueprint` and `replan_planner`, whose grants happen to match, which is exactly the condition under which this would have been found late and in production. Keying on the grant makes a mismatch start a second session instead.

### An execution budget follows the grant, not the proof schema

`research-report` resolved to the `short` profile — 120 seconds. That was sized for a task writing down what it already knew, and the observed research tasks bore it out: one failed at 120s and the one that completed needed the 300s the escalation gave it. Real web round-trips do not fit either. A grant carrying `web_research` now raises the run's floor to `medium`, derived from the grant rather than added to the proof-schema table, so a later capability that costs wall-clock time inherits the rule instead of needing a new row.

### Scope: this grants the web, not keyword data

`web_research` grants search and page fetch. It does not produce search volume, keyword difficulty, or CPC — those come from Google Ads, DataForSEO, Search Console, or a similar source, and belong in a later `keyword_data` capability delivered as an MCP server whose credentials stay in the runtime and never enter a prompt or a workspace. Until then an SEO research task can produce evidence-backed findings with cited sources and must declare the absent metrics as a validation limit, or file an Environment-Blocked Blocker naming `keyword_data`. What it may not do is supply the numbers from priors and call the result research. Rule 4 does not refute that blocker, because `keyword_data` is a capability the runtime does not grant.

## Considered options

- **Append `--allowedTools WebSearch WebFetch` to the constant.** One line, fixes the reported symptom, and leaves defects 2 and 3 exactly as they are — while making the constant more load-bearing and more obviously wrong to change again next time.
- **`--dangerously-skip-permissions`.** Grants everything to everything, makes Permission Mode decorative, and is the documented wrong choice for a process with network access.
- **Let the adapter read the task and choose its own flags.** Puts the policy decision in three places at once and guarantees Claude Code and Codex drift apart.
- **Accept estimate-based research as a deliverable shape.** Honest about the constraint, but the constraint was imaginary, and a company whose first artifact is an accepted guess has no way to notice later.

## Consequences

- Research tasks reach the live web, and their findings carry sources. The reported failure cannot recur silently: with the capability granted, the estimate path is a refuted blocker or a validation-limited deliverable, and both are visible.
- A task runs the same way on every machine. Operator settings, skills, hooks, and MCP servers no longer reach an Agent Run, which also means a workflow someone relied on through their own `.claude/` config stops working and must become a declared capability.
- `safe` companies ask before a task touches the public web, through the approval path that already existed.
- Blocked capabilities become a runtime fact rather than a sentence in a deliverable. "The environment did not allow X" is now checkable against what the runtime handed out.
- Known limitation: `--restricted` confines the file tools to the run's working directory. The scheduler already resolves one run workspace that is both cwd and the Proof collection root, and the dashboard sends `assets: []`, so nothing needs a second directory today. A Company Creation whose `assets` name real paths outside the company workspace would no longer be readable, and that path needs an `--add-dir` derived from the grant when assets become real.
- Known limitation: rule 4 refutes a blocker by capability name, so an agent that files `environment_blocked` under a plausible-but-ungranted capability name still degrades the task. Tightening this means registering the capability names a blocker may claim, which is worth doing once a second grantable capability exists and is not worth a registry for one.
- Known limitation: the grant is fixed for the whole run. A task that needs `run_command` only to verify its own output holds it throughout. Per-action grant narrowing during execution is the same change the server context already defers for per-action approval, and it should arrive with it.
