import { expect, it } from "vitest";
import { assessExecutionHealth } from "./executionHealth";
import { executionBudgetFromEnvironment } from "./budgetPolicy";
const policy = { suspectAfterMs: 45, lostAfterMs: 90, quietAfterMs: 60 };
it("does not confuse silence with owner loss, or output with verified progress", () => {
  expect(assessExecutionHealth({ policy, heartbeatAgeMs: 10, activityAgeMs: null, inResumeGrace: false })).toMatchObject({ state: "unknown", action: "continue" });
  expect(assessExecutionHealth({ policy, heartbeatAgeMs: 10, activityAgeMs: 1, inResumeGrace: false })).toMatchObject({ state: "responsive", action: "continue" });
  expect(assessExecutionHealth({ policy, heartbeatAgeMs: 50, activityAgeMs: 1, inResumeGrace: false })).toMatchObject({ state: "suspect", action: "probe" });
  expect(assessExecutionHealth({ policy, heartbeatAgeMs: 100, activityAgeMs: 1, inResumeGrace: false })).toMatchObject({ state: "lost", action: "stop_and_isolate" });
  expect(assessExecutionHealth({ policy, heartbeatAgeMs: 100000, activityAgeMs: null, inResumeGrace: true })).toMatchObject({ state: "unknown", action: "probe" });
});
it("requires explicit validated opt-in and keeps observe as the default", () => {
  expect(executionBudgetFromEnvironment({})).toBeUndefined();
  expect(executionBudgetFromEnvironment({ AUTO_CROP_EXECUTION_POLICY: "budget-v1" })).toEqual({});
  expect(() => executionBudgetFromEnvironment({ AUTO_CROP_EXECUTION_POLICY: "budget" })).toThrow();
  expect(() => executionBudgetFromEnvironment({ AUTO_CROP_EXECUTION_POLICY: "budget-v1", AUTO_CROP_EXECUTION_BUDGET_JSON: '{"runHardMs":-1}' })).toThrow();
  expect(() => executionBudgetFromEnvironment({ AUTO_CROP_EXECUTION_POLICY: "budget-v1", AUTO_CROP_EXECUTION_BUDGET_JSON: '{"suspectAfterMs":100000}' })).toThrow();
});
