import { describe, expect, it } from "vitest";
import { formatExecutionBudget, resolveEffectiveTimeout, resolveTaskExecutionProfile } from "./executionProfile";

describe("resolveTaskExecutionProfile", () => {
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
