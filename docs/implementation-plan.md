# Agent Company MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an open-source local runtime that lets a founder choose Claude Code, Codex, or a custom local agent as CEO, turn a vision into OKRs and departments, execute real work through local agents, collect proof, and run review cycles.

**Architecture:** The product is a local-first TypeScript system: a CLI starts a Node local server, a Vite React dashboard connects through REST and SSE, SQLite stores structured state, and the file system stores department memory, artifacts, logs, proof, reviews, screenshots, and diffs. A company runtime coordinates CEO Office planning, OKR memory, department Lead/Worker agents, task-level isolated workspaces, policy-gated actions, proof capture, review, and the next cycle.

**Tech Stack:** Node.js, TypeScript, pnpm, Vite, React, SQLite, REST, Server-Sent Events, child_process, git worktrees or task sandbox directories, Vitest, Playwright, mock agent adapter.

---

## Decisions

- MVP proof target: CEO can dispatch local Claude Code / Codex to execute real tasks and return proof.
- Target users: independent developers, AI power users, and content/growth operators.
- Company type strategy: free-form founder vision mapped internally to execution playbooks.
- CEO choice: user can choose Claude Code or Codex in the first version.
- Execution model: true multi-agent execution.
- Proof model: proof schemas vary by task type.
- Product form: CLI plus local web dashboard.
- Playbook architecture: build the generic runtime plus playbook interface; complete one playbook first.
- First complete playbook: AI tool / SaaS.
- Local permissions: controlled execution with policy gates.
- Deployment: optional development-account integration for GitHub, Vercel, Netlify, or Cloudflare.
- Loop cadence: semi-automatic; low-risk work can continue, risky work requires approval.
- Department structure: each department has Lead Agent, Worker Agents, and Memory.md.
- Workspace isolation: task-level workspace or git worktree.
- Persistence: SQLite plus file system.
- UI style: company operating dashboard.
- User role: Founder / chairperson.
- Revenue metrics: playbook-specific; AI SaaS uses proxy traction or checkout-ready proof.
- External accounts: first version only supports development-related accounts.
- Agent access: plugin-style adapter interface; MVP implementation uses local CLI commands.
- Custom agents: simple command template plus capability tags.
- CEO output: free-form analysis followed by strict JSON; the runtime only trusts JSON.
- Blueprint editing: edit key fields during creation, advanced editing inside the dashboard.
- Open-source install path: support git clone development usage first, keep the structure ready for npm CLI usage.
- Runtime stack: Node.js / TypeScript full stack.
- Dashboard: Vite + React.
- Local API: REST + Server-Sent Events.
- Scheduler: SQLite-backed queue.
- Logs: SQLite index plus file logs.
- Failure handling: department Lead handles task-level failures; CEO Office handles strategic failures.
- Approval model: action policy decides auto / ask / deny.
- Default permission setup: user chooses Safe / Balanced / Autonomous at first launch; Balanced is default.
- Safety: global kill switch.
- Test strategy: backend tests plus frontend key-flow tests, with mock agent E2E.
- Docs: README, Quickstart, and Architecture must be updated as features evolve.
- Project name: keep `auto-crop` for now.

## Runtime Model

```text
Founder Vision + Assets
  -> CEO Office
  -> Company Blueprint
  -> OKR System / Priority Memory
  -> Department Routing
  -> Department Lead Agents
  -> Worker Agents in isolated workspaces
  -> Proof + Assets + Skills + Memory
  -> Review against Key Results
  -> OKR Update
  -> Priority Signal back to CEO Office
```

## Planned File Structure

```text
apps/
  cli/
    src/
      index.ts
      commands/start.ts
  server/
    src/
      index.ts
      api/
      runtime/
      db/
      events/
      policies/
      adapters/
      playbooks/
  dashboard/
    src/
      main.tsx
      App.tsx
      api/
      components/
      pages/
packages/
  core/
    src/
      types.ts
      schemas.ts
      paths.ts
      ids.ts
docs/
  implementation-plan.md
  architecture.md
  quickstart.md
```

## Core Data Model

The runtime should persist these entities in SQLite:

```ts
type Company = {
  id: string;
  name: string;
  founderVision: string;
  selectedCeoAgentId: string;
  playbookId: string;
  status: "draft" | "active" | "paused" | "review";
  createdAt: string;
  updatedAt: string;
};

type Department = {
  id: string;
  companyId: string;
  name: "CEO Office" | "Product" | "Research" | "Growth" | "Engineering" | string;
  responsibility: string;
  leadAgentId: string;
  memoryPath: string;
};

type Objective = {
  id: string;
  companyId: string;
  title: string;
  status: "active" | "complete" | "paused";
  priority: number;
};

type KeyResult = {
  id: string;
  objectiveId: string;
  title: string;
  metricName: string;
  targetValue: string;
  currentValue: string;
  status: "active" | "met" | "missed";
};

type Task = {
  id: string;
  companyId: string;
  departmentId: string;
  keyResultId: string | null;
  title: string;
  description: string;
  assigneeAgentId: string;
  requiredCapabilities: string[];
  proofSchemaId: string;
  workspacePath: string | null;
  status: "queued" | "running" | "blocked" | "review" | "complete" | "failed" | "cancelled";
  riskLevel: "low" | "medium" | "high";
};

type Proof = {
  id: string;
  taskId: string;
  type: "file" | "diff" | "url" | "screenshot" | "command_output" | "test_result" | "deployment";
  uri: string;
  summary: string;
  verifiedAt: string | null;
};

type AgentRun = {
  id: string;
  taskId: string;
  agentId: string;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  logPath: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type Approval = {
  id: string;
  companyId: string;
  taskId: string | null;
  actionType: string;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "approved" | "denied";
  requestedAt: string;
};
```

## Task 1: Initialize Monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [x] Create a pnpm workspace with `apps/*` and `packages/*`.
- [x] Add scripts: `dev`, `test`, `typecheck`, `lint`.
- [x] Add a root TypeScript config shared by CLI, server, dashboard, and core.
- [x] Add `.gitignore` entries for `node_modules`, `.auto-crop`, `dist`, `.env`, and Playwright artifacts.
- [x] Verify with `pnpm install` and `pnpm test`.
- [x] Update `README.md` with the actual install command if it changes.

## Task 2: Core Types and Schemas

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/schemas.ts`
- Create: `packages/core/src/ids.ts`
- Create: `packages/core/src/paths.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/schemas.test.ts`

- [x] Define the shared entity types from the Core Data Model section.
- [x] Define strict schemas for CEO JSON output, company blueprint, OKRs, departments, tasks, proof schemas, and reviews.
- [x] Write tests that reject missing departments, tasks without proof schema IDs, and CEO output without strict JSON.
- [x] Write tests that accept a valid AI SaaS company blueprint.
- [x] Verify with `pnpm --filter @auto-crop/core test`.

## Task 3: SQLite Persistence

**Files:**
- Create: `apps/server/src/db/schema.ts`
- Create: `apps/server/src/db/client.ts`
- Create: `apps/server/src/db/repositories.ts`
- Test: `apps/server/src/db/repositories.test.ts`

- [x] Create SQLite tables for companies, departments, objectives, key_results, tasks, proofs, agent_runs, approvals, and reviews.
- [x] Add repository functions for create, read, update status, append proof, create approval, and fetch active queue.
- [x] Add tests for task lifecycle transitions: queued -> running -> review -> complete.
- [x] Add tests for queue recovery after a simulated server restart.
- [x] Verify with `pnpm --filter @auto-crop/server test`.

## Task 4: File System Layout

**Files:**
- Create: `apps/server/src/runtime/workspace.ts`
- Test: `apps/server/src/runtime/workspace.test.ts`

- [x] Implement creation of `.auto-crop/companies/<companyId>/`.
- [x] Create department directories with `Memory.md`, `tasks/`, `artifacts/`, `proof/`, `reviews/`, and `logs/`.
- [x] Create task workspaces under `.auto-crop/workspaces/<taskId>/`.
- [x] Add tests that paths cannot escape the project root.
- [x] Verify with `pnpm --filter @auto-crop/server test`.

## Task 5: Agent Adapter Interface

**Files:**
- Create: `apps/server/src/adapters/types.ts`
- Create: `apps/server/src/adapters/registry.ts`
- Create: `apps/server/src/adapters/cliAgent.ts`
- Create: `apps/server/src/adapters/mockAgent.ts`
- Test: `apps/server/src/adapters/registry.test.ts`

- [x] Define `AgentAdapter` with `id`, `name`, `capabilities`, `detect()`, and `run()`.
- [x] Implement CLI command-template adapters for Claude Code, Codex, and custom agents.
- [x] Implement mock agent for tests.
- [x] Write tests for adapter selection by capability.
- [x] Write tests for command template variable interpolation using `{workspace}` and `{promptPath}`.
- [x] Verify with `pnpm --filter @auto-crop/server test`.

## Task 6: Policy Engine

**Files:**
- Create: `apps/server/src/policies/policy.ts`
- Create: `apps/server/src/policies/defaults.ts`
- Test: `apps/server/src/policies/policy.test.ts`

- [x] Define action types: read_workspace, write_workspace, run_safe_command, install_dependency, deploy, access_external_account, write_outside_workspace, destructive_file_change, send_message, paid_action.
- [x] Implement Safe, Balanced, and Autonomous policies.
- [x] Make Balanced the default: read/write workspace auto, safe commands auto, install/deploy ask, outside workspace deny, paid actions deny.
- [x] Add tests for auto / ask / deny decisions.
- [x] Verify with `pnpm --filter @auto-crop/server test`.

## Task 7: AI SaaS Playbook

**Files:**
- Create: `apps/server/src/playbooks/types.ts`
- Create: `apps/server/src/playbooks/aiSaas.ts`
- Create: `apps/server/src/playbooks/selectPlaybook.ts`
- Test: `apps/server/src/playbooks/aiSaas.test.ts`

- [x] Define the playbook interface: suitableFor, defaultDepartments, okrTemplates, taskTemplates, proofSchemas, reviewCriteria.
- [x] Implement the AI SaaS playbook with Product, Research, Growth, and Engineering departments.
- [x] Add proof schemas for product brief, research report, landing page file, repo diff, test output, local URL, screenshot, and optional deployment URL.
- [x] Add tests that free-form SaaS visions map to the AI SaaS playbook.
- [x] Verify with `pnpm --filter @auto-crop/server test`.

## Task 8: CEO Office Prompt and Parser

**Files:**
- Create: `apps/server/src/runtime/ceoPrompt.ts`
- Create: `apps/server/src/runtime/ceoParser.ts`
- Test: `apps/server/src/runtime/ceoParser.test.ts`

- [x] Build the CEO prompt with founder vision, selected playbook, available agents, existing assets, permission mode, and required JSON schema.
- [x] Require two sections: human-readable CEO brief and strict JSON.
- [x] Parse and validate only the strict JSON.
- [x] Add tests for valid output, malformed JSON, missing proof schemas, and unsupported departments.
- [x] Verify with `pnpm --filter @auto-crop/server test`.

## Task 9: Company Creation Runtime

**Files:**
- Create: `apps/server/src/runtime/createCompany.ts`
- Test: `apps/server/src/runtime/createCompany.test.ts`

- [x] Accept founder vision, selected CEO, permission mode, and optional assets.
- [x] Select the AI SaaS playbook when appropriate.
- [x] Run CEO adapter or mock CEO to produce a blueprint.
- [x] Store company, departments, objectives, key results, tasks, and memory files.
- [x] Return editable key fields before activation.
- [x] Verify with `pnpm --filter @auto-crop/server test`.

## Task 10: SQLite-Backed Scheduler

**Files:**
- Create: `apps/server/src/runtime/scheduler.ts`
- Create: `apps/server/src/runtime/locks.ts`
- Test: `apps/server/src/runtime/scheduler.test.ts`

- [x] Claim queued tasks from SQLite with a lock.
- [x] Create a task-level workspace or git worktree for writable tasks.
- [x] Dispatch to the selected Worker Agent.
- [x] Stream output to file logs and SSE.
- [x] Move tasks to review when proof is present, failed when no proof is present, and blocked when approval is required.
- [x] Add tests with mock agents for parallel task execution and lock release.
- [x] Verify with `pnpm --filter @auto-crop/server test`.

## Task 11: Proof Capture

**Files:**
- Create: `apps/server/src/runtime/proof.ts`
- Test: `apps/server/src/runtime/proof.test.ts`

- [x] Capture file proof from declared paths.
- [x] Capture diff proof from git worktree changes.
- [x] Capture command output proof from log excerpts.
- [x] Capture URL proof for local dev server and optional deployment.
- [x] Reject tasks whose proof does not match the task proof schema.
- [x] Verify with `pnpm --filter @auto-crop/server test`.

## Task 12: Failure Handling and Review

**Files:**
- Create: `apps/server/src/runtime/failure.ts`
- Create: `apps/server/src/runtime/review.ts`
- Test: `apps/server/src/runtime/review.test.ts`

- [x] On Worker failure, route logs to the department Lead.
- [x] Let the Lead create a fix task, mark the task blocked, or escalate to CEO Office.
- [x] Let CEO Office review proof against key results and update priorities.
- [x] Write review markdown into the company review directory.
- [x] Verify with `pnpm --filter @auto-crop/server test`.

## Task 13: Kill Switch

**Files:**
- Create: `apps/server/src/runtime/killSwitch.ts`
- Test: `apps/server/src/runtime/killSwitch.test.ts`

- [x] Add a global pause state.
- [x] Stop claiming new tasks while paused.
- [x] Cancel active child processes.
- [x] Release task locks.
- [x] Move the company into manual review.
- [x] Verify with `pnpm --filter @auto-crop/server test`.

## Task 14: REST and SSE API

**Files:**
- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/api/routes.ts`
- Create: `apps/server/src/events/sse.ts`
- Test: `apps/server/src/api/routes.test.ts`

- [x] Add REST endpoints for agent detection, company creation, blueprint edit, activation, task approval, task cancel, proof list, review list, and kill switch.
- [x] Add SSE endpoint for run logs and task status changes.
- [x] Add API tests with mock runtime components.
- [x] Verify with `pnpm --filter @auto-crop/server test`.

## Task 15: CLI

**Files:**
- Create: `apps/cli/src/index.ts`
- Create: `apps/cli/src/commands/start.ts`
- Test: `apps/cli/src/commands/start.test.ts`

- [x] Implement `auto-crop start`.
- [x] Start the local server.
- [x] Print the dashboard URL.
- [x] Detect whether Claude Code or Codex are available.
- [x] Verify with `pnpm --filter @auto-crop/cli test`.

## Task 16: Dashboard Foundation

**Files:**
- Create: `apps/dashboard/src/main.tsx`
- Create: `apps/dashboard/src/App.tsx`
- Create: `apps/dashboard/src/api/client.ts`
- Create: `apps/dashboard/src/pages/Onboarding.tsx`
- Create: `apps/dashboard/src/pages/CompanyDashboard.tsx`

- [x] Build onboarding with CEO selection, founder vision input, permission mode selection, and company blueprint review.
- [x] Build company dashboard with CEO Office, OKR System, departments, active tasks, proof, approvals, and review.
- [x] Use company operating dashboard as the primary UI, not chat or kanban.
- [x] Add SSE-driven task status updates.
- [x] Verify with `pnpm --filter @auto-crop/dashboard test`.

## Task 17: Playwright Key Flow

**Files:**
- Create: `apps/dashboard/e2e/company-flow.spec.ts`

- [x] Start server with mock agent.
- [x] Create a company from a founder vision.
- [x] Review the CEO blueprint.
- [x] Activate the company.
- [x] Observe mock agent task execution through SSE.
- [x] View proof and review.
- [x] Trigger kill switch and verify active work pauses.
- [ ] Verify with `pnpm --filter @auto-crop/dashboard e2e`.

Local verification note: the E2E spec is implemented, but this machine currently blocks Playwright browser launch with macOS `bootstrap_check_in` permission errors. Run after installing a compatible Playwright Chromium browser in an unrestricted environment.

## Task 18: Documentation

**Files:**
- Modify: `README.md`
- Create: `docs/quickstart.md`
- Create: `docs/architecture.md`

- [x] Document clone-based setup.
- [x] Document future `npx auto-crop start` usage.
- [x] Document supported agents and custom command-template agents.
- [x] Document Safe, Balanced, and Autonomous modes.
- [x] Document local files created under `.auto-crop/`.
- [x] Document the CEO Office, OKR System, departments, proof, review, playbooks, adapter interface, and kill switch.
- [x] Update README whenever functionality changes.

## Verification Checklist

- [x] `pnpm install`
- [x] `pnpm test`
- [x] `pnpm typecheck`
- [ ] `pnpm --filter @auto-crop/dashboard e2e`
- [x] Manual smoke test with mock agent: create company, activate tasks, view proof, run review, trigger kill switch.
- [x] Manual smoke test with one real local agent when available: create isolated workspace, run one low-risk task, confirm proof is captured.

## MVP Acceptance Criteria

- A user can run the project locally from a clone.
- The dashboard lets the user choose Claude Code, Codex, or a custom command-template agent as CEO.
- The user can enter a founder vision and generate an editable company blueprint.
- The AI SaaS playbook creates Product, Research, Growth, and Engineering departments.
- The OKR system stores objectives, key results, tasks, priorities, and review updates.
- Multiple worker tasks can run in isolated workspaces.
- The scheduler persists state in SQLite and recovers queued tasks after restart.
- Agent logs stream to the dashboard and persist to log files.
- Proof is required before task completion.
- Risky actions create approval requests.
- The global kill switch pauses new work, cancels active work, releases locks, and moves the company to review.
- Documentation explains installation, architecture, permissions, supported agents, and limitations.

## Known Non-Goals For MVP

- No pure SaaS cloud runtime.
- No automatic posting to social platforms.
- No automatic email sending.
- No automatic paid actions.
- No full plugin system beyond simple custom command-template agents.
- No desktop app packaging.
- No requirement for real Stripe revenue in the first version.
