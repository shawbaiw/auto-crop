# CRT Menu Bar Execution Plan

## Confirmed Scope

- Place the menu bar inside the CRT screen face at the very top.
- Use English product semantics instead of French labels.
- Build a dedicated reusable menu component set:
  - `RetroMenuBar`
  - `RetroMenu`
  - `RetroMenuItem`
  - `RetroMenuSeparator`
- Keep `RetroSelect` as a form/select component. Do not overload it for command menus.
- Use a Classic Macintosh visual style: white menu surface, black border, compact rows, and current skin accent for hover and active states.
- Collapse desktop menu groups into one `Menu` entry on mobile.
- Keep disabled items visible with muted text and no click behavior.
- Support mouse, keyboard arrows, Enter, Escape, and outside-click close.
- Move skin switching from the standalone top-right control into the `View` menu.

## First Version Menu Model

```text
Auto-Crop
  About Auto-Crop
  Preferences... disabled

Company
  Create Company
  Activate Company
  Back to Setup
  Kill Switch

Agents
  Detected agent list
  Current agent checked
  Undetected agents disabled

Work
  View Tasks
  View Departments
  Pause Status

Proof
  Load Proof
  Load Review
  Open Evidence disabled

View
  Mono
  Skin 01...
  CRT Effect: Horizontal + Vignette checked
  Fullscreen disabled

Help
  Documentation disabled
  GitHub Repository disabled
  Keyboard Shortcuts disabled
```

## State And Action Rules

- `Create Company` reuses the same handler as the onboarding button.
- `Activate Company` reuses the same handler as the blueprint review button.
- `Back to Setup` only returns to Founder Setup and keeps the generated blueprint.
- `Kill Switch` reuses the dashboard handler and is enabled only when a company exists.
- `Agents` menu items call the same selected-agent state setter as the CEO cards.
- `View` skin items call the existing theme context.
- `Work > View Tasks` and `Work > View Departments` focus the matching dashboard sections when a company is active.
- `Proof > Load Proof` and `Proof > Load Review` focus their matching dashboard sections before loading data.

## Implementation Steps

- [x] Create reusable menu component files under `apps/dashboard/src/ui/menu/`.
- [x] Add menu-specific CSS while preserving the current reusable retro styles.
- [x] Remove `SkinSwitcher` from `AppShell`.
- [x] Add a reusable `DashboardMenuBar` composition component that maps app state to menu groups.
- [x] Wrap both onboarding and dashboard pages with the same menu bar.
- [x] Wire company, agent, proof, review, kill-switch, and skin actions to the menu.
- [x] Add focused tests for menu opening, disabled behavior, checked items, skin switching, and menu actions.
- [x] Run typecheck, tests, and UI sanity checks.

## Follow-Up Todo

- [ ] Add second-level submenus when the menu system needs nested groups such as `View > Skin`.
- [ ] Add visible keyboard shortcut glyphs once real shortcuts exist.
- [ ] Implement real fullscreen behavior for `View > Fullscreen`.
- [x] Add focus targets for `Work > View Tasks`, `Work > View Departments`, `Proof > Load Proof`, and `Proof > Load Review`.
- [ ] Add proof evidence navigation after evidence has a real opening target.
- [ ] Revisit menu labels after the dashboard has more mature information architecture.
- [ ] Consider command-palette reuse if the menu action model grows beyond classic menu interactions.
