# Onboarding And Department Workspace Execution Plan

## Goal

Change the user flow so startup opens a sequential onboarding wizard, creates the company through a CRT-styled loading page, and lands on a department workspace layout with the existing menu bar and company header preserved.

## Execution Status

- 2026-08-18: Completed the first vertical slice covering backend `companyName` persistence, CEO prompt name-locking, and the frontend three-step onboarding wizard. Verified with `pnpm --filter @auto-crop/server test`, `pnpm --filter @auto-crop/dashboard test`, and `pnpm --filter @auto-crop/dashboard typecheck`.
- 2026-08-18: Completed the creation loading page and default department workspace. The post-create flow now switches to `creating`, then to `department-workspace`; the Work menu can still open the operating dashboard. Verified with `pnpm test` and `pnpm typecheck`.
- Next handoff point: tighten remaining menu tests for Back to Setup/blueprint preservation, run final full verification, and continue any visual polish on mobile if screenshots reveal layout issues.

## Hard Constraints

- Reuse existing UI primitives as much as possible: `AppShell`, `PageHeader`, `Workspace`, `RetroPanel`, `RetroButton`, `RetroField`, `RetroTextarea`, `RetroSelect`, `RetroListRow`, `RetroBadge`, `RetroStatus`, `VideotexLog`, and `VideotexKeyValue`.
- Do not create a parallel UI kit for the wizard, loading page, or department workspace.
- Keep the current CRT/menu/theme system intact.
- The onboarding steps must be sequential, not shown side by side.
- Company name and menu bar/header remain visible after creation; only the main workspace area changes.
- Department chat is out of scope for this pass. The right panel is a static role workspace summary, not a live chat input.

## Confirmed Product Flow

1. Startup opens the onboarding wizard inside the existing CRT shell.
2. Step 1 asks for company name.
3. Step 2 automatically detects local agents and requires selecting one detected agent as CEO.
4. Step 3 asks for Founder Vision and Permission Mode. Permission Mode defaults to `balanced`.
5. `Create Company` shows a CRT-styled loading page.
6. When the backend returns a company blueprint, the app lands on the Department Workspace.
7. The Department Workspace defaults to `CEO` selected.
8. The left rail lists `CEO`, then generated departments such as Product, Research, Growth, and Engineering.
9. The right workspace shows the selected role's summary, responsibilities, tasks, status, and placeholder next-step copy.
10. README and `docs/quickstart.md` must be updated.

## Data Contract Changes

Current `createCompany` input has:

```ts
{
  founderVision: string;
  selectedCeoAgentId: string;
  permissionMode: string;
  assets: string[];
}
```

Add:

```ts
companyName: string;
```

The backend should pass this name into the CEO prompt and enforce it as the preferred final company name. If the CEO returns a different name, the runtime should store the user-provided `companyName` to avoid a mismatch between setup and dashboard header.

## File Change Map

- `CONTEXT.md`: keep glossary and the reusable-component rule.
- `packages/core/src/schemas.ts`: add `companyName` to the create-company input schema if an API schema exists there.
- `packages/core/src/types.ts`: add `companyName` where shared create-company input types are defined, if present.
- `apps/dashboard/src/api/client.ts`: add `companyName` to `createCompany` input.
- `apps/server/src/api/routes.ts`: read `companyName` from `POST /api/companies`.
- `apps/server/src/runtime/createCompany.ts`: accept `companyName`, pass it to the prompt builder, and store it as the final company name.
- `apps/server/src/runtime/ceoPrompt.ts`: include the user-provided company name and instruct the CEO not to rename it.
- `apps/server/src/runtime/createCompany.test.ts`: test that the user-provided company name is stored.
- `apps/server/src/api/routes.test.ts`: test that the API accepts and persists `companyName`.
- `apps/dashboard/src/App.tsx`: replace the old onboarding state with wizard state, loading state, and post-creation view state.
- `apps/dashboard/src/pages/Onboarding.tsx`: refactor into sequential wizard rendering while reusing existing retro components.
- `apps/dashboard/src/pages/CompanyCreationLoading.tsx`: create a small composition page using existing retro components.
- `apps/dashboard/src/pages/DepartmentWorkspace.tsx`: create the post-creation department workspace using existing retro components.
- `apps/dashboard/src/pages/CompanyDashboard.tsx`: keep existing operating dashboard available for menu actions where needed.
- `apps/dashboard/src/App.test.tsx`: update and add tests for the new flow.
- `apps/dashboard/src/styles.css`: add only layout classes for wizard, loading page, and department workspace. Do not duplicate button, field, panel, menu, or theme styles.
- `README.md`: update user flow and startup notes.
- `docs/quickstart.md`: update manual startup and expected UI flow.

## Task 1: Backend Accepts Company Name

### Objective

Make `companyName` a real create-company input and persist it.

### Steps

- [x] Update API/client shared type surfaces to include `companyName`.
- [x] Update `apps/server/src/api/routes.ts` to read `body.companyName`.
- [x] Update `apps/server/src/runtime/createCompany.ts` input type with `companyName`.
- [x] Pass `companyName` into `buildCeoPrompt`.
- [x] Store `company.name` as `input.companyName.trim()`.
- [x] Reject empty `companyName` with a clear API error.

### Tests

- [x] In `apps/server/src/runtime/createCompany.test.ts`, assert the stored company name equals the user-provided name even if mock CEO output contains a different name.
- [x] In `apps/server/src/api/routes.test.ts`, assert `POST /api/companies` requires `companyName`.
- [x] Run `pnpm --filter @auto-crop/server test`.

## Task 2: CEO Prompt Honors Company Name

### Objective

Make the CEO Agent understand that company name is user-specified.

### Steps

- [x] Update `BuildCeoPromptInput` in `apps/server/src/runtime/ceoPrompt.ts`.
- [x] Add a `## Company Name` section to the prompt.
- [x] In `## Output Contract`, instruct: use the provided company name exactly.
- [x] Keep `Founder Vision`, playbook, agents, permission mode, and assets unchanged.

### Tests

- [x] Update `apps/server/src/runtime/ceoParser.test.ts` or the nearest prompt test to assert the prompt includes the company name rule.
- [x] Run `pnpm --filter @auto-crop/server test`.

## Task 3: Onboarding Wizard State Machine

### Objective

Replace simultaneous onboarding panels with a three-step wizard.

### State Model

Use explicit state in `App.tsx`:

```ts
type OnboardingStep = "company" | "agents" | "vision";
type AppView = "onboarding" | "creating" | "department-workspace" | "dashboard";
```

Keep:

```ts
companyName: string;
companyNameError: string | null;
founderVision: string;
founderVisionError: string | null;
agentLoadState: "idle" | "loading" | "ready" | "failed";
selectedAgentId: string;
permissionMode: string;
```

### Steps

- [x] Add `companyName` state to `App.tsx`.
- [x] Add `onboardingStep` state with default `"company"`.
- [x] Change initial `agentLoadState` to `"idle"` so detection does not run before Step 2.
- [x] Move agent detection into a callable `detectAgents()` function.
- [x] When entering Step 2, call `detectAgents()` automatically.
- [x] Add `goToNextStep()` validation:
  - Step 1 requires non-empty company name.
  - Step 2 requires at least one detected selected CEO Agent.
  - Step 3 requires non-empty Founder Vision before create.
- [x] Add Back behavior for Step 2 and Step 3.
- [x] Lock wizard navigation while `isCreating`.
- [x] Extend the lock to `view === "creating"` when Task 5 adds the dedicated creating page.

### Tests

- [x] Update `apps/dashboard/src/App.test.tsx` to assert Step 1 appears first and Step 2/3 content is absent.
- [x] Assert empty company name blocks Next with a styled error.
- [x] Assert entering Step 2 triggers agent detection.
- [x] Assert Step 3 appears only after choosing a detected CEO.

## Task 4: Sequential Onboarding UI

### Objective

Refactor `Onboarding` to render one step at a time while reusing existing components.

### Component Rules

- Use `AppShell` and `PageHeader`.
- Use `RetroPanel` for the current step container.
- Use `RetroField` and `RetroTextarea` for text input.
- Use `RetroSelect` for permission mode.
- Use `RetroListRow` for agent choices.
- Use `RetroButton` for Back, Next, Retry, and Create Company.
- Use existing `system-message` styles for validation and API errors.

### Proposed Props

```ts
type OnboardingStep = "company" | "agents" | "vision";

type OnboardingProps = {
  step: OnboardingStep;
  companyName: string;
  companyNameError: string | null;
  agents: AgentSummary[];
  agentLoadState: "idle" | "loading" | "ready" | "failed";
  selectedAgentId: string;
  founderVision: string;
  founderVisionError: string | null;
  permissionMode: string;
  createError: string | null;
  menuBar?: ReactNode;
  onCompanyNameChange(value: string): void;
  onRetryAgents(): void;
  onSelectAgent(agentId: string): void;
  onVisionChange(value: string): void;
  onPermissionModeChange(value: string): void;
  onBack(): void;
  onNext(): void;
  onCreateCompany(): void;
};
```

### Tests

- [x] Assert Step 1 renders company name input and Next.
- [x] Assert Step 2 renders loading, failed, empty, and detected-agent states.
- [x] Assert Step 3 renders Founder Vision, Permission Mode, Back, and Create Company.
- [x] Assert only one step body is present at a time.

## Task 5: Creation Loading Page

### Objective

Create a CRT-styled loading page shown while the CEO Agent is generating the blueprint.

### Component

Create `apps/dashboard/src/pages/CompanyCreationLoading.tsx`.

### UI Content

Use existing `AppShell`, `PageHeader`, `Workspace`, `RetroPanel`, `RetroStatus`, `VideotexLog`, and `VideotexKeyValue`.

Show:

- Company name.
- Selected CEO Agent name.
- Permission mode.
- Elapsed seconds.
- Stages:
  - `Sending founder vision`
  - `CEO agent generating blueprint`
  - `Validating strict JSON`
  - `Creating departments and tasks`

### Behavior

- On `handleCreateCompany`, set `view` to `"creating"` before awaiting the API call.
- Start an elapsed-second timer in the loading component.
- On success, set blueprint and switch to `"department-workspace"`.
- On failure, return to Step 3 and display `createError`.

### Tests

- [x] Assert clicking Create Company shows loading page immediately.
- [x] Assert loading page includes company name, CEO Agent, and stages.
- [x] Assert success lands in Department Workspace.
- [x] Assert failure returns to Step 3 and shows backend error.

## Task 6: Department Workspace View

### Objective

Create the post-creation default layout matching the sketch: left rail role list, right selected role workspace.

### Component

Create `apps/dashboard/src/pages/DepartmentWorkspace.tsx`.

### Layout

- Use `AppShell` and `PageHeader`.
- Header title should remain company-centric, using the created company name.
- Main content uses `Workspace className="department-workspace"`.
- Left rail uses `RetroPanel title="Departments"` and `RetroListRow`.
- Left rail entries:
  - `CEO`
  - each `department.name`
- Default selection is `CEO`.
- Right pane uses `RetroPanel` and existing data components.

### CEO Workspace Content

Show:

- Selected CEO Agent.
- Company status.
- Playbook ID.
- Objective list.
- First task list.
- Static next-step copy explaining that department execution is queued and scheduler/proof views are available from the menu.

### Department Workspace Content

For selected department, show:

- Department name.
- Responsibility.
- Lead agent ID.
- Related tasks with status badges.
- Memory path if present.
- Static next-step copy: department chat will be added later.

### Tests

- [x] Assert successful creation defaults to CEO selected.
- [x] Assert left rail contains CEO and generated departments.
- [x] Assert clicking Engineering shows Engineering responsibility and tasks.
- [x] Assert no chat input is rendered.

## Task 7: Menu And View Integration

### Objective

Keep the existing menu bar and make menu actions compatible with the new app views.

### Steps

- [x] Extend `DashboardMenuView` to include `"creating"` and `"department-workspace"` or map department workspace as a dashboard-capable view.
- [x] `Company > Create Company` should only be enabled on onboarding Step 3 when not creating.
- [x] `Company > Back to Setup` should work from department workspace and dashboard.
- [x] `Work > View Tasks` and `Work > View Departments` should switch to the existing operating dashboard view or focus matching content depending on final design.
- [x] Keep `Agents` menu synchronized with selected CEO during onboarding.
- [x] Keep `View > Skin` and fullscreen unchanged.

### Tests

- [x] Update menu tests to account for the new views.
- [x] Assert disabled commands remain visible.
- [x] Assert skin switching still works from the View menu.
- [ ] Assert Back to Setup returns to the wizard without losing the generated blueprint.

## Task 8: CSS Layout Additions

### Objective

Add only the layout CSS required for the new wizard, loading page, and department workspace.

### Allowed New Classes

- `.onboarding-wizard`
- `.onboarding-wizard__actions`
- `.creation-loading`
- `.creation-loading__stage`
- `.department-workspace`
- `.department-workspace__rail`
- `.department-workspace__main`
- `.role-summary`

### Rules

- Do not restyle base buttons, fields, panels, select, badges, menu, or CRT effects.
- Do not duplicate existing `RetroPanel` title rail styles.
- Maintain mobile single-column layout.
- Ensure text does not overflow buttons, cards, or rail items.

### Tests

- [x] Run `pnpm --filter @auto-crop/dashboard test`.
- [x] Run `pnpm --filter @auto-crop/dashboard typecheck`.
- [ ] Manually inspect desktop and mobile widths.

## Task 9: Documentation Updates

### Objective

Update open-source user documentation to match the new flow.

### README Updates

- Startup still requires backend and frontend commands in development.
- On first load, users go through:
  - Company Name
  - Agent Detection / CEO Selection
  - Founder Vision / Permission Mode
  - Creation Loading
  - Department Workspace
- Mention Claude Code is the recommended first CEO Agent on this machine; Codex may require local permissions.

### Quickstart Updates

- Update the "Expected UI flow" section.
- Add troubleshooting for `Local API is not connected`.
- Add troubleshooting for CEO Agent timeout/error message.

### Tests

- [x] Run `rg -n "Choose CEO|Founder Setup|Company Operating Dashboard|dashboard foundation" README.md docs/quickstart.md docs/architecture.md` and update stale wording.

## Task 10: Final Verification

### Required Commands

Run:

```bash
pnpm test
pnpm typecheck
```

Manual smoke:

```bash
AUTO_CROP_PORT=8787 AUTO_CROP_AGENT_TIMEOUT_MS=120000 pnpm --filter @auto-crop/cli start
```

In another terminal:

```bash
VITE_AUTO_CROP_API_URL=http://127.0.0.1:8787 pnpm --filter @auto-crop/dashboard dev --port 5174
```

Verify:

- Step 1 shows only company name.
- Step 2 auto-detects agents.
- Step 3 shows Founder Vision and Permission Mode.
- Create Company shows loading page.
- Successful creation lands on Department Workspace with CEO selected.
- Menu bar remains visible.
- Company header shows the user-provided company name.
- Existing operating dashboard can still be reached through menu behavior.

## Completion Criteria

- All confirmed product flow requirements are implemented.
- New UI reuses existing retro components except small composition components for page-level structure.
- Backend persists user-provided company name.
- Create flow no longer shows all onboarding controls at once.
- Loading state is a dedicated full page, not just a button label.
- Department Workspace is the default post-creation view.
- README and quickstart match the implemented flow.
- `pnpm test` and `pnpm typecheck` pass.
