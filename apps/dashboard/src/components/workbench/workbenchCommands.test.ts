import { describe, expect, it, vi } from "vitest";
import { operatingCommand, workbenchCommands, type WorkbenchCommandState } from "./workbenchCommands";

function state(overrides: Partial<WorkbenchCommandState> = {}): WorkbenchCommandState {
  return {
    canCreateCompany: false,
    isCreating: false,
    companyStatus: "active",
    onCreateCompany: vi.fn(),
    onPauseOperating: vi.fn(),
    onResumeOperating: vi.fn(),
    onStopOperating: vi.fn(),
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
  it("offers Create Company only on the last onboarding step and not while creating", () => {
    expect(enabled({ canCreateCompany: true })).toContain("create-company");
    expect(enabled({ canCreateCompany: false })).not.toContain("create-company");
    const creating = workbenchCommands(state({ canCreateCompany: true, isCreating: true }))["create-company"];
    expect(creating).toMatchObject({ enabled: false, labelKey: "menu.creatingCompany" });
  });

  it("follows the company lifecycle for Pause, Resume and Stop (ADR 0044)", () => {
    expect(enabled({ companyStatus: "active" })).toEqual(["pause-operating", "stop-operating"]);
    expect(enabled({ companyStatus: "paused" })).toEqual(["resume-operating", "stop-operating"]);
    expect(enabled({ companyStatus: "creation_failed" })).toEqual(["stop-operating"]);
    expect(enabled({ companyStatus: "stopped" })).toEqual([]);
    expect(enabled({ companyStatus: "creating" })).toEqual([]);
    expect(enabled({ companyStatus: null })).toEqual([]);
  });

  it("shows Resume while paused and Pause otherwise", () => {
    expect(operatingCommand(workbenchCommands(state({ companyStatus: "paused" })))).toMatchObject({
      id: "resume-operating",
      enabled: true,
    });
    expect(operatingCommand(workbenchCommands(state()))).toMatchObject({ id: "pause-operating", enabled: true });
    expect(operatingCommand(workbenchCommands(state({ companyStatus: "stopped" })))).toMatchObject({
      id: "pause-operating",
      enabled: false,
    });
  });

  it("runs the handler it was given", () => {
    const input = state();
    workbenchCommands(input)["stop-operating"].run();
    expect(input.onStopOperating).toHaveBeenCalledTimes(1);
  });
});
