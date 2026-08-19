import { describe, expect, it } from "vitest";
import { formatExecutionBudget, resolveTaskExecutionProfile } from "./executionProfile";

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
