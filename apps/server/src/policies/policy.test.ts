import { describe, expect, it } from "vitest";
import { balancedPolicy, getDefaultPolicy, autonomousPolicy, safePolicy } from "./defaults";
import { decideAction, isActionType } from "./policy";

describe("policy action types", () => {
  it("recognizes supported action types", () => {
    expect(isActionType("read_workspace")).toBe(true);
    expect(isActionType("paid_action")).toBe(true);
    expect(isActionType("unknown_action")).toBe(false);
  });
});

describe("safe policy", () => {
  it("allows workspace reads and asks for workspace writes and commands", () => {
    expect(decideAction(safePolicy, "read_workspace")).toBe("auto");
    expect(decideAction(safePolicy, "write_workspace")).toBe("ask");
    expect(decideAction(safePolicy, "run_safe_command")).toBe("ask");
  });

  it("denies outside-workspace writes and paid actions", () => {
    expect(decideAction(safePolicy, "write_outside_workspace")).toBe("deny");
    expect(decideAction(safePolicy, "paid_action")).toBe("deny");
  });
});

describe("balanced policy", () => {
  it("is the default policy", () => {
    expect(getDefaultPolicy()).toBe(balancedPolicy);
  });

  it("automates workspace reads, workspace writes, and safe commands", () => {
    expect(decideAction(balancedPolicy, "read_workspace")).toBe("auto");
    expect(decideAction(balancedPolicy, "write_workspace")).toBe("auto");
    expect(decideAction(balancedPolicy, "run_safe_command")).toBe("auto");
  });

  it("asks for install, deploy, external accounts, destructive changes, and messages", () => {
    expect(decideAction(balancedPolicy, "install_dependency")).toBe("ask");
    expect(decideAction(balancedPolicy, "deploy")).toBe("ask");
    expect(decideAction(balancedPolicy, "access_external_account")).toBe("ask");
    expect(decideAction(balancedPolicy, "destructive_file_change")).toBe("ask");
    expect(decideAction(balancedPolicy, "send_message")).toBe("ask");
  });

  it("denies outside-workspace writes and paid actions", () => {
    expect(decideAction(balancedPolicy, "write_outside_workspace")).toBe("deny");
    expect(decideAction(balancedPolicy, "paid_action")).toBe("deny");
  });
});

describe("autonomous policy", () => {
  it("automates install and deploy but still denies hard boundaries", () => {
    expect(decideAction(autonomousPolicy, "install_dependency")).toBe("auto");
    expect(decideAction(autonomousPolicy, "deploy")).toBe("auto");
    expect(decideAction(autonomousPolicy, "write_outside_workspace")).toBe("deny");
    expect(decideAction(autonomousPolicy, "paid_action")).toBe("deny");
  });
});
