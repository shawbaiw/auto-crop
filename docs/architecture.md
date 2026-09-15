# Architecture

auto-crop is a local-first TypeScript system that coordinates local AI agents as a small operating company.

## Runtime Loop

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

The user starts with an intent and assets. The CEO Office converts that input into a company blueprint: objectives, key results, departments, tasks, proof expectations, and priorities. The runtime stores that blueprint, creates local workspaces, dispatches tasks to agents, captures proof, reviews work against key results, and prepares the next cycle.

## Packages

- `@auto-crop/core`: shared TypeScript types and Zod schemas.
- `@auto-crop/server`: SQLite persistence, workspace creation, adapters, policies, playbooks, runtime orchestration, REST, and SSE.
- `@auto-crop/cli`: local entrypoint for starting the runtime.
- `@auto-crop/dashboard`: React dashboard for onboarding, activation, monitoring, proof, review, and kill switch controls.

## Dashboard Interface

The dashboard uses a reusable flat CRT / Classic Macintosh interface layer rather than page-specific controls. Shared UI lives under `apps/dashboard/src/ui/`:

- `crt/`: global CRT viewport, display presets, and quality handling.
- `layout/`: shell, page header, and workspace layout primitives.
- `menu/`: reusable application menu components.
- `retro/`: hard-edged form, button, panel, badge, textarea, select, and status primitives.
- `theme/`: palette skins and theme state.

The application menu is inside the CRT screen face at the top of the dashboard. `DashboardMenuBar` maps runtime state to reusable menu groups:

- `Auto-Crop`: product-level commands.
- `Company`: create company, activate company, return to setup, and kill switch.
- `Agents`: detected CEO agents, current-agent checked state, and disabled unavailable agents.
- `Work`: task and department navigation.
- `Proof`: load proof, load review, and evidence navigation.
- `View`: skin submenu, CRT/fullscreen controls.
- `Help`: visible disabled placeholders for documentation-oriented commands.

The menu model is shared across onboarding and dashboard pages. Desktop shows the full menu strip; mobile collapses the same command model into one `Menu` entry. Disabled commands stay visible, command items expose checked and shortcut metadata, and submenu state is reusable so future command-palette work can consume the same action model.

## Storage

Structured state is stored in SQLite:

```text
.auto-crop/state.sqlite
```

File-based memory and artifacts are stored under the operated project:

```text
.auto-crop/
  companies/<companyId>/
    departments/<departmentId>/Memory.md
    tasks/
    artifacts/
    proof/
    reviews/
    logs/
  workspaces/<taskId>/
```

The workspace layer rejects paths that escape the project root.

## API Surface

The local API server currently exposes:

Reads:

- `GET /api/agents`
- `GET /api/companies`
- `GET /api/companies/:id/state` — the full company snapshot the dashboard renders
- `GET /api/companies/:id/reviews`
- `GET /api/tasks/:id/proof`
- `GET /api/events` for Server-Sent Events

Company lifecycle:

- `POST /api/companies`
- `POST /api/companies/:id/activate`
- `POST /api/companies/:id/retry-creation`
- `POST /api/companies/:id/ceo-intakes`
- `POST /api/kill-switch`

Moving a stopped task forward — each of these is a Resume Affordance, and each is guarded by one:

- `POST /api/ceo-review-decisions` — approve or return work awaiting CEO Office
- `POST /api/founder-decisions` — resolve a Founder Decision
- `POST /api/approvals/:id` — grant or deny Founder Approval before dispatch
- `POST /api/companies/:id/human-actions/:actionId/confirm` — submit evidence a Human Action was done
- `POST /api/tasks/:id/refresh` — re-derive dependency readiness, or recapture proof from the workspace
- `POST /api/tasks/:id/recover` — re-run the work, or continue it from Partial Output
- `POST /api/tasks/:id/replan-proposals` — ask the CEO Agent for a replan
- `POST /api/replan-proposals/:id/confirm` — accept a replan and rewire dependencies
- `POST /api/tasks/:id/cancel`

SSE is used for task logs and status updates.

### Task summaries carry their own affordances

Every task the API serializes includes `holds` (why it is stopped, who owns it, what it waits on) and `affordances` (what can be done to it right now). Clients render actions from that list and never re-derive eligibility from status and failure reason — see ADR 0020 and `apps/server/CONTEXT.md`.

The route that performs an action checks the same affordance before doing it. A stale request is answered `409` with the task's current `holds` and `affordances` in the body, not with a bare error, so a client looking at a view the runtime has moved past can show the real next action instead of a dead end.

## Agents

Agents implement a small adapter interface:

- `id`
- `name`
- `capabilities`
- `detect()`
- `run()`

Built-in adapter factories exist for Claude Code and Codex. Custom agents can still be added as command templates with capability tags and interpolation for `{workspace}` and `{promptPath}`.

The built-in two no longer use a fixed command template. Each Agent Run carries an **Agent Capability Grant** — what the task needs (`workspace_read`, `workspace_write`, `run_command`, `web_research`), intersected with what the company's Permission Mode allows — and the adapter turns that grant into launch flags. The launch is fail-closed: shell and code-running tools removed, user/project/local settings files ignored, host MCP servers skipped, file tools confined to the working directory, and anything that would prompt denied. Capabilities come back only because the grant named them. A run therefore behaves the same on every machine, and a research task can actually search the web. See ADR 0021.

## Playbooks

Playbooks define how a company should be assembled for a class of work. The first complete playbook is AI tools / SaaS and creates:

- Product
- Research
- Growth
- Engineering

Each playbook defines department templates, OKR templates, task templates, proof schemas, and review criteria.

## CEO Office And OKR System

The CEO Office prompt includes founder vision, selected playbook, available agents, existing assets, permission mode, and a required strict JSON schema. The parser ignores prose and validates only the fenced JSON payload.

The OKR system stores objectives, key results, task priorities, and review outputs so the runtime can keep working after the first prompt.

## Scheduler

The scheduler claims queued tasks from SQLite with locks, creates isolated task workspaces, dispatches work to a matching agent, writes logs, emits SSE events, captures proof, and moves tasks to review, failed, or blocked states.

Every one of those state moves goes through `applyTaskTransition`, the single writer of task status. A task that stops carries a Task Hold saying why it stopped and who can restart it; a task the runtime is carrying carries none. Before dispatch the scheduler also checks the company's Permission Mode, and a task needing Founder Approval is held on its Approval record rather than run. See `apps/server/CONTEXT.md`.

## Proof And Review

Proof can include:

- files
- diffs
- command output
- local URLs
- screenshots
- optional deployment URLs

Proof is validated against the task proof schema before a task can be treated as review-ready. Reviews compare proof against key results and write review markdown into the company workspace.

## Permission Modes

- Safe: most conservative local execution.
- Balanced: default. Workspace reads/writes, safe commands, and public web reads are automatic; install/deploy ask; outside-workspace writes and paid actions are denied.
- Autonomous: broader automatic execution for trusted local use, while destructive or paid actions remain policy-controlled.

Permission Mode decides two things: whether a task needs Founder Approval before it is dispatched, and which Runtime Capabilities its Agent Capability Grant may contain. It can only narrow a grant — a task never receives a capability it did not need, however permissive the mode.

## Kill Switch

The global kill switch sets global pause, prevents new scheduler claims, cancels running agent runs, releases task locks, and moves the company into review.

## Known Limits

- `node:sqlite` is experimental on Node 24.
- The packaged dashboard serving/opening flow is still future work.
- Approval decision UI and real-agent smoke tests remain planned.
- Playwright E2E requires a working Chromium environment.
