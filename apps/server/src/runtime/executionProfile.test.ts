import { describe, expect, it } from "vitest";
import { balancedPolicy } from "../policies/defaults";
import { resolveAgentCapabilityGrant, resolveTaskCapabilityNeeds } from "../policies/capabilityGrant";
import { formatExecutionBudget, resolveEffectiveTimeout, resolveTaskExecutionProfile } from "./executionProfile";

describe("resolveTaskExecutionProfile", () => {
  /**
   * `research-report` was sized for a task writing down what the agent already knew — one run failed
   * at 120s and the one that completed needed the 300s escalation. A run that actually searches the
   * web fits neither, and the floor comes from the grant so a later network-bound capability
   * inherits it (ADR 0021).
   */
  it("raises a web-granted run to at least a medium budget", () => {
    const task = { proofSchemaId: "research-report", requiredCapabilities: ["research", "writing"] };
    const grant = resolveAgentCapabilityGrant({
      needs: resolveTaskCapabilityNeeds(task),
      policy: balancedPolicy,
    });

    expect(resolveTaskExecutionProfile(task)).toEqual({ name: "short", timeoutMs: 120_000 });
    expect(resolveTaskExecutionProfile(task, grant)).toEqual({ name: "medium", timeoutMs: 300_000 });
  });

  it("does not lower a budget the deliverable shape already earned", () => {
    const task = { proofSchemaId: "test-output", requiredCapabilities: ["test", "research"] };
    const grant = resolveAgentCapabilityGrant({
      needs: resolveTaskCapabilityNeeds(task),
      policy: balancedPolicy,
    });

    expect(resolveTaskExecutionProfile(task, grant)).toEqual({ name: "long", timeoutMs: 600_000 });
  });

  it("assigns short budgets to writing proof schemas", () => {
    expect(resolveTaskExecutionProfile({ proofSchemaId: "product-brief", requiredCapabilities: ["writing"] })).toEqual({
      name: "short",
      timeoutMs: 120_000,
    });
    expect(resolveTaskExecutionProfile({ proofSchemaId: "research-report", requiredCapabilities: ["research"] })).toEqual({
      name: "short",
      timeoutMs: 120_000,
    });
  });

  it("assigns long budgets to prototype and validation proof schemas", () => {
    expect(resolveTaskExecutionProfile({ proofSchemaId: "landing-page-file", requiredCapabilities: ["frontend"] })).toEqual({
      name: "long",
      timeoutMs: 600_000,
    });
    expect(resolveTaskExecutionProfile({ proofSchemaId: "test-output", requiredCapabilities: ["test"] })).toEqual({
      name: "long",
      timeoutMs: 600_000,
    });
  });

  it("uses capabilities only for unknown proof schemas", () => {
    expect(resolveTaskExecutionProfile({ proofSchemaId: "unknown", requiredCapabilities: ["frontend"] })).toEqual({
      name: "long",
      timeoutMs: 600_000,
    });
    expect(resolveTaskExecutionProfile({ proofSchemaId: "unknown", requiredCapabilities: ["writing"] })).toEqual({
      name: "medium",
      timeoutMs: 300_000,
    });
  });
});

describe("formatExecutionBudget", () => {
  it("formats minute-aligned budgets", () => {
    expect(formatExecutionBudget(120_000)).toBe("2m");
    expect(formatExecutionBudget(300_000)).toBe("5m");
    expect(formatExecutionBudget(600_000)).toBe("10m");
  });
});

describe("resolveEffectiveTimeout", () => {
  it("lets AUTO_CROP_AGENT_TIMEOUT_MS raise but not lower a task profile budget", () => {
    expect(
      resolveEffectiveTimeout(
        { proofSchemaId: "landing-page-file", requiredCapabilities: ["frontend"] },
        { AUTO_CROP_AGENT_TIMEOUT_MS: "120000" },
      ),
    ).toMatchObject({
      requestedTimeoutMs: 600_000,
      effectiveTimeoutMs: 600_000,
      warnings: [
        "Ignored AUTO_CROP_AGENT_TIMEOUT_MS=120000 because it is lower than the long profile budget 600000.",
      ],
    });

    expect(
      resolveEffectiveTimeout(
        { proofSchemaId: "product-brief", requiredCapabilities: ["writing"] },
        { AUTO_CROP_AGENT_TIMEOUT_MS: "180000" },
      ),
    ).toMatchObject({
      requestedTimeoutMs: 120_000,
      effectiveTimeoutMs: 180_000,
      warnings: [],
    });
  });

  it("lets AUTO_CROP_FORCE_AGENT_TIMEOUT_MS override the profile exactly", () => {
    expect(
      resolveEffectiveTimeout(
        { proofSchemaId: "landing-page-file", requiredCapabilities: ["frontend"] },
        { AUTO_CROP_FORCE_AGENT_TIMEOUT_MS: "1000" },
      ),
    ).toMatchObject({
      requestedTimeoutMs: 600_000,
      effectiveTimeoutMs: 1_000,
      warnings: [],
    });
  });

  it("ignores invalid timeout environment variables with warnings", () => {
    expect(
      resolveEffectiveTimeout(
        { proofSchemaId: "test-output", requiredCapabilities: ["test"] },
        {
          AUTO_CROP_AGENT_TIMEOUT_MS: "soon",
          AUTO_CROP_FORCE_AGENT_TIMEOUT_MS: "0",
        },
      ),
    ).toMatchObject({
      effectiveTimeoutMs: 600_000,
      warnings: ["Ignored invalid AUTO_CROP_AGENT_TIMEOUT_MS: soon.", "Ignored invalid AUTO_CROP_FORCE_AGENT_TIMEOUT_MS: 0."],
    });
  });
});
