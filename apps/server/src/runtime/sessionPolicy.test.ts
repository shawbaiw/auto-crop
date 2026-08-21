import { describe, expect, it } from "vitest";
import { resolveAgentSessionPolicy } from "./sessionPolicy";

describe("resolveAgentSessionPolicy", () => {
  it("keeps persistent sessions disabled unless the experiment is enabled", () => {
    expect(
      resolveAgentSessionPolicy({
        companyId: "company_1",
        agentId: "codex",
        permissionMode: "balanced",
        purpose: "ceo_blueprint",
        env: {},
      }),
    ).toEqual({ status: "disabled", reason: "env_disabled" });
  });

  it("enables explicit planning purposes with the session key contract", () => {
    expect(
      resolveAgentSessionPolicy({
        companyId: "company_1",
        agentId: "codex",
        permissionMode: "autonomous",
        purpose: "replan_planner",
        env: { AUTO_CROP_EXPERIMENTAL_AGENT_SESSIONS: "1" },
      }),
    ).toEqual({
      status: "enabled",
      key: {
        companyId: "company_1",
        agentId: "codex",
        permissionMode: "autonomous",
      },
    });
  });

  it("does not allow ordinary worker tasks to use persistent sessions", () => {
    expect(
      resolveAgentSessionPolicy({
        companyId: "company_1",
        agentId: "codex",
        permissionMode: "balanced",
        purpose: "worker_task",
        env: { AUTO_CROP_EXPERIMENTAL_AGENT_SESSIONS: "true" },
      }),
    ).toEqual({ status: "disabled", reason: "purpose_not_eligible" });
  });

  it("requires permission mode before constructing a session key", () => {
    expect(
      resolveAgentSessionPolicy({
        companyId: "company_1",
        agentId: "codex",
        permissionMode: null,
        purpose: "replan_planner",
        env: { AUTO_CROP_EXPERIMENTAL_AGENT_SESSIONS: "1" },
      }),
    ).toEqual({ status: "disabled", reason: "missing_permission_mode" });
  });
});
