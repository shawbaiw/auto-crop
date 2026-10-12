import { describe, expect, it, vi } from "vitest";
import { operatingCommand, workbenchCommands, type WorkbenchCommandState } from "./workbenchCommands";

function state(overrides: Partial<WorkbenchCommandState> = {}): WorkbenchCommandState {
  return {
    view: "department-workspace",
    canCreateCompany: false,
    hasBlueprint: true,
    hasProof: false,
    isCreating: false,
    isPaused: false,
    canPauseOperating: true,
    isFullscreen: false,
    fullscreenAvailable: true,
    onCreateCompany: vi.fn(),
    onPauseOperating: vi.fn(),
    onResumeOperating: vi.fn(),
    onViewTasks: vi.fn(),
    onViewDepartments: vi.fn(),
    onViewOperations: vi.fn(),
    onLoadProof: vi.fn(),
    onLoadReviews: vi.fn(),
    onOpenEvidence: vi.fn(),
    onToggleFullscreen: vi.fn(),
    ...overrides,
  };
}

function enabled(overrides: Partial<WorkbenchCommandState> = {}) {
  return Object.values(workbenchCommands(state(overrides)))
    .filter((command) => command.enabled)
    .map((command) => command.id)
    .sort();
}

describe("workbenchCommands", () => {
  it("offers company navigation on every company page once a blueprint exists", () => {
    for (const view of ["dashboard", "department-workspace", "operations"] as const) {
      expect(enabled({ view })).toEqual(expect.arrayContaining(["view-departments", "view-operations", "view-tasks"]));
    }
    expect(enabled({ view: "onboarding" })).not.toContain("view-tasks");
    expect(enabled({ view: "creating" })).not.toContain("view-tasks");
    expect(enabled({ hasBlueprint: false })).not.toContain("view-tasks");
  });

  it("offers proof commands only on the operating dashboard, and evidence only once proof exists", () => {
    expect(enabled()).not.toContain("load-proof");
    expect(enabled({ view: "dashboard" })).toEqual(expect.arrayContaining(["load-proof", "load-review"]));
    expect(enabled({ view: "dashboard" })).not.toContain("open-evidence");
    expect(enabled({ view: "dashboard", hasProof: true })).toContain("open-evidence");
    expect(enabled({ view: "dashboard", hasBlueprint: false })).not.toContain("load-proof");
  });

  it("offers Create Company only on the last onboarding step and not while creating", () => {
    expect(enabled({ canCreateCompany: true })).toContain("create-company");
    expect(enabled({ canCreateCompany: false })).not.toContain("create-company");
    const creating = workbenchCommands(state({ canCreateCompany: true, isCreating: true }))["create-company"];
    expect(creating).toMatchObject({ enabled: false, labelKey: "menu.creatingCompany" });
  });

  it("shows Resume while paused and Pause otherwise, enabled only for an operating company", () => {
    expect(operatingCommand(workbenchCommands(state({ isPaused: true, canPauseOperating: false })))).toMatchObject({
      id: "resume-operating",
      enabled: true,
    });
    expect(operatingCommand(workbenchCommands(state()))).toMatchObject({ id: "pause-operating", enabled: true });
    expect(operatingCommand(workbenchCommands(state({ canPauseOperating: false })))).toMatchObject({
      id: "pause-operating",
      enabled: false,
    });
  });

  it("toggles fullscreen only where the browser allows it", () => {
    expect(enabled({ fullscreenAvailable: false })).not.toContain("fullscreen");
    expect(workbenchCommands(state({ isFullscreen: true })).fullscreen).toMatchObject({
      checked: true,
      labelKey: "menu.exitFullscreen",
    });
  });

  it("runs the handler it was given", () => {
    const input = state();
    workbenchCommands(input)["view-operations"].run();
    expect(input.onViewOperations).toHaveBeenCalledTimes(1);
  });
});
