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

- `GET /api/agents`
- `POST /api/companies`
- `POST /api/companies/:id/activate`
- `PATCH /api/companies/:id/blueprint`
- `GET /api/companies/:id/reviews`
- `GET /api/tasks/:id/proof`
- `POST /api/tasks/:id/cancel`
- `POST /api/approvals/:id`
- `POST /api/kill-switch`
- `GET /api/events` for Server-Sent Events

SSE is used for task logs and status updates.

## Agents

Agents implement a small adapter interface:

- `id`
- `name`
- `capabilities`
- `detect()`
- `run()`

Built-in command-template adapter factories exist for Claude Code and Codex. Custom command-template agents can be added with capability tags and command interpolation for `{workspace}` and `{promptPath}`.

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

Queued tasks can declare task dependencies. The scheduler only treats a queued task as runnable after every dependency has reached review or complete with captured proof. Before dispatch, it writes a `task-prompt.md` task packet into the task workspace with the company context, task brief, key result, dependency proof summaries, artifact guidance, and proof contract.

## Proof And Review

Proof can include:

- files
- diffs
- command output
- local URLs
- screenshots
- optional deployment URLs

Worker agents should write durable outputs under the task workspace's `artifacts/` directory and summarize them in `proof.json`. The proof collector reads `proof.json`, scans `artifacts/`, and validates proof against the task proof schema before a task can be treated as review-ready. Reviews compare proof against key results and write review markdown into the company workspace.

## Permission Modes

- Safe: most conservative local execution.
- Balanced: default. Workspace reads/writes and safe commands are automatic; install/deploy ask; outside-workspace writes and paid actions are denied.
- Autonomous: broader automatic execution for trusted local use, while destructive or paid actions remain policy-controlled.

## Kill Switch

The global kill switch sets global pause, prevents new scheduler claims, cancels running agent runs, releases task locks, and moves the company into review.

## Known Limits

- `node:sqlite` is experimental on Node 24.
- The packaged dashboard serving/opening flow is still future work.
- Advanced blueprint editing, approval decision UI, and real-agent smoke tests remain planned.
- Playwright E2E requires a working Chromium environment.
