# auto-crop

An open-source local "agent company" runtime.

The project goal is to let a founder run a zero-person company from their own computer. A user names a company, chooses a local agent, such as Claude Code or Codex, as CEO, writes a founder vision, and the system turns that vision into OKRs, departments, agent work, proof, and review loops.

The MVP is currently under active implementation. See [docs/quickstart.md](docs/quickstart.md) to run it locally, [docs/architecture.md](docs/architecture.md) for the system model, and [docs/implementation-plan.md](docs/implementation-plan.md) for the task plan.

## Quick Links

- [Quickstart](docs/quickstart.md): clone setup, local commands, dashboard development, E2E notes.
- [Architecture](docs/architecture.md): runtime components, permissions, storage, agents, playbooks, proof, review, kill switch.
- [Implementation Plan](docs/implementation-plan.md): MVP task checklist and acceptance criteria.

## Product Direction

The first version will prove this loop:

```text
Founder Vision
  -> CEO Office
  -> OKR System
  -> Departments
  -> Lead Agents and Worker Agents
  -> Proof and Assets
  -> Review
  -> OKR Update
  -> Next Cycle
```

The MVP targets independent developers, AI power users, and content/growth operators who already use local agents and are comfortable giving a local tool controlled access to a workspace.

## MVP Scope

- Local CLI plus local web dashboard.
- Claude Code and Codex selectable as CEO agents through a plugin-style adapter interface.
- User-defined custom agents through command templates and capability tags.
- A generic company runtime with CEO Office, OKR memory, departments, task scheduling, proof, and review.
- A playbook interface, with the first complete playbook focused on AI tools / SaaS.
- True multi-agent execution using task-level isolated workspaces or git worktrees.
- SQLite for structured state and the file system for memory, artifacts, proof, reviews, diffs, screenshots, and logs.
- REST APIs plus Server-Sent Events for live agent run updates.
- A policy-driven approval system with Safe, Balanced, and Autonomous modes.
- A global kill switch that pauses new work, cancels running work, releases locks, and enters manual review.

## Install And Run

Current clone-based development:

```bash
git clone <repo-url>
cd auto-crop
pnpm install
pnpm test
pnpm typecheck
```

Start the local runtime from a clone:

```bash
AUTO_CROP_PORT=8787 pnpm --filter @auto-crop/cli start
```

Run the dashboard during development:

```bash
VITE_AUTO_CROP_API_URL=http://127.0.0.1:8787 pnpm --filter @auto-crop/dashboard dev
```

Future package usage:

```bash
npx auto-crop start
```

## Current Implementation Status

- Monorepo foundation is initialized with pnpm, TypeScript, Vitest, and shared workspace config.
- `@auto-crop/core` defines shared types and strict schemas for CEO output, company blueprints, tasks, proof, and OKRs.
- `@auto-crop/server` has a SQLite persistence layer for companies, departments, objectives, key results, tasks, proof, agent runs, approvals, and reviews.
- `@auto-crop/server` can create safe local `.auto-crop/` company, department, and task workspace layouts.
- `@auto-crop/server` defines an Agent Adapter interface with mock agents, command-template local agents, and built-in Claude Code / Codex adapter factories.
- `@auto-crop/server` includes Safe, Balanced, and Autonomous action policies for local workspace, command, deployment, external-account, message, and paid-action decisions.
- `@auto-crop/server` includes the first complete execution playbook for AI tools / SaaS, with Product, Research, Growth, and Engineering departments.
- `@auto-crop/server` can build CEO Office prompts and parse strict fenced JSON output against the selected playbook.
- `@auto-crop/server` can create draft companies by selecting a playbook, running a CEO agent, storing the blueprint in SQLite, and creating local department/task workspaces.
- `@auto-crop/server` has a SQLite-backed scheduler that claims queued tasks with locks, dispatches worker agents, writes run logs, emits task events, and moves tasks to review, failed, or blocked.
- `@auto-crop/server` can capture proof from files, diffs, command output, URLs, deployment URLs, and screenshots while enforcing task proof schemas.
- `@auto-crop/server` can route worker failures to department leads, create fix tasks, block tasks for founder input, escalate to CEO review, and write review markdown against key results.
- `@auto-crop/server` includes a kill switch that sets global pause, stops scheduler task claiming, cancels running agent runs, releases task locks, and moves the company into review.
- `@auto-crop/server` exposes REST endpoints for agent detection, company creation/activation, blueprint edits, approvals, task cancellation, proof/review reads, kill switch, and Server-Sent Events for task logs/status.
- `@auto-crop/cli` implements `auto-crop start`, creates local SQLite state under `.auto-crop/`, starts the local API server, prints the dashboard URL, and detects Claude Code / Codex adapters.
- `@auto-crop/dashboard` provides the React onboarding and operating views with company naming, CEO selection, founder vision, permission mode, a CRT-styled creation loading page, the default department workspace, department/task panels, proof, approvals, review, and SSE-driven event updates.
- `@auto-crop/dashboard` includes a Playwright key-flow E2E spec that starts a mock API server, creates and activates a company, observes mock agent SSE output, loads proof/review data, and triggers the kill switch.
- The current SQLite implementation uses Node's built-in `node:sqlite` module, which emits an experimental warning on Node 24.

## Supported Agents

- Claude Code and Codex are supported through built-in command-template adapter factories.
- Custom local agents can be added with a command template, capability tags, and variable interpolation for `{workspace}` and `{promptPath}`.
- The mock agent is used for automated tests and local fixture flows.

## Permission Modes

- Safe: conservative mode for low-risk local reads and writes.
- Balanced: default mode. Workspace reads/writes and safe commands are automatic; dependency install and deployment ask; outside-workspace writes and paid actions are denied.
- Autonomous: broader automatic execution for trusted local use, while destructive or paid actions still remain policy-controlled.

## Local Files

auto-crop stores runtime state inside the project it is operating:

```text
.auto-crop/
  state.sqlite
  companies/<companyId>/
    departments/<departmentId>/Memory.md
    tasks/
    artifacts/
    proof/
    reviews/
    logs/
  workspaces/<taskId>/
```

Do not run the tool against a repository unless you are comfortable with it creating and modifying files under that workspace.

## Testing

Core checks:

```bash
pnpm smoke:mock
pnpm test
pnpm typecheck
```

Optional real-agent check:

```bash
pnpm smoke:real-agent
```

`pnpm smoke:real-agent` requires a working local agent and defaults to Claude Code. To try Codex instead:

```bash
AUTO_CROP_REAL_AGENT=codex pnpm smoke:real-agent
```

Dashboard checks:

```bash
pnpm --filter @auto-crop/dashboard test
pnpm --filter @auto-crop/dashboard typecheck
pnpm --filter @auto-crop/dashboard exec playwright install chromium
pnpm --filter @auto-crop/dashboard e2e
```

If Playwright browsers are already installed outside the current package version, the E2E runner can be pointed at a local Chromium executable:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium pnpm --filter @auto-crop/dashboard e2e
```

On this development machine, Playwright browser launch is currently blocked by macOS `bootstrap_check_in` permission errors. The E2E spec is committed and typechecked; run it in an unrestricted local or CI environment with a compatible Playwright Chromium install.

## Known Limitations

- `node:sqlite` emits an experimental warning on Node 24.
- `auto-crop start` currently starts the local API server and prints its URL. The packaged dashboard serving/opening flow is still future work.
- The dashboard can create companies, land in the department workspace, open the operating dashboard from the menu, and load proof/review data, but advanced blueprint editing and live approval decisions are still planned.
- E2E requires a working Playwright Chromium browser installation.
- On this machine, Claude Code is detected but currently returns `Not logged in · Please run /login` during real-agent creation. Codex CLI is installed, but `codex exec` currently fails during local app-server initialization with `Operation not permitted` and a read-only local state DB warning.

## Documentation Rule

When functionality changes, update this README and the implementation documentation in the same change. This project is open source, so installation, architecture, local permissions, supported agents, and known limitations must stay visible to users.
