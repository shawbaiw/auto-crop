import { describe, expect, it } from "vitest";
import type { TaskProgressEventSummary } from "../../api/client";
import { expandedByDefault, failingStepId, traceRuns, traceState } from "./traceModel";

const step = (id: string, kind: TaskProgressEventSummary["step"], status: TaskProgressEventSummary["status"], minute: number, parentTaskId = "task"): TaskProgressEventSummary => ({
  id, companyId: "c", departmentId: "d", parentTaskId, subjectTaskId: parentTaskId, step: kind, status, label: id, detail: null,
  createdAt: `2026-10-13T00:${String(minute).padStart(2, "0")}:00.000Z`,
});

describe("traceRuns", () => {
  it("starts a new run each time execution starts again, keeping intake steps in the first run", () => {
    const runs = traceRuns({ id: "task" }, [
      step("received", "received", "complete", 0),
      step("first", "executing", "current", 1),
      step("blocked", "blocked", "blocked", 2),
      step("second", "executing", "current", 3),
      step("done", "complete", "complete", 4),
      step("other", "executing", "current", 5, "other_task"),
    ]);
    expect(runs.map((run) => run.steps.map((entry) => entry.id))).toEqual([["received", "first", "blocked"], ["second", "done"]]);
    expect(failingStepId(runs[0])).toBe("blocked");
    expect(failingStepId(runs[1])).toBe("done");
  });
});

describe("traceState", () => {
  it("folds a trace only once its result is settled", () => {
    expect(["running", "retrying", "complete", "review", "failed", "blocked", "needs_replan", "cancelled", "queued", "waiting_dependency"]
      .map((status) => [status, traceState({ status }), expandedByDefault(traceState({ status }))])).toEqual([
      ["running", "live", true], ["retrying", "live", true],
      ["complete", "settled", false], ["review", "settled", false],
      ["failed", "stopped", true], ["blocked", "stopped", true], ["needs_replan", "stopped", true], ["cancelled", "stopped", true],
      ["queued", "waiting", true], ["waiting_dependency", "waiting", true],
    ]);
  });
});
