import { describe, expect, it } from "vitest";
import { projectCeoOfficeItems, type Company, type Task, type TaskEvent, type TaskProgressEvent } from "./index";
const company: Company = { id: "c", name: "Studio", founderVision: "Build something useful", locale: "en", selectedCeoAgentId: "agent", playbookId: "custom", status: "active", createdAt: "2026-09-01T08:00:00Z", updatedAt: "2026-09-01T08:00:00Z" };
const task = (id: string): Task => ({ id, companyId: "c", departmentId: "d", keyResultId: null, position: 0, title: id, description: "Evaluate options", assigneeAgentId: "agent", requiredCapabilities: [], proofSchemaId: "custom", workspacePath: null, status: "blocked", riskLevel: "low" });
const event = (id: string): TaskEvent => ({ id: `failure_${id}`, taskId: id, companyId: "c", type: "task_blocked", message: "An independent problem", createdAt: "2026-09-01T09:00:00Z", status: "blocked", failureReason: null, failureMessage: "An independent problem", executionProfileName: null, requestedTimeoutMs: null, effectiveTimeoutMs: null, dependencyNote: null, artifactWorkspacePath: null });
describe("CEO Office execution facts", () => {
  it("does not announce a task when a progress marker only means queued or waiting", () => {
    const progress: TaskProgressEvent = { id: "p", companyId: "c", departmentId: "d", parentTaskId: "a", subjectTaskId: "a", step: "executing", status: "current", label: "Dependency ready; queued for scheduler", detail: null, createdAt: "2026-09-01T09:00:00Z" };
    const items = projectCeoOfficeItems({ company, tasks: [{ ...task("a"), status: "queued" }], taskProgressEvents: [progress], taskCompletionEvents: [] });
    expect(items.filter(item => item.type === "task_brief")).toEqual([]);
  });
  it("keeps independent problems even when the two tasks have a dependency", () => {
    const items = projectCeoOfficeItems({ company, tasks: [task("a"), task("b")], taskEvents: [event("a"), event("b")], taskDependencies: [{ taskId: "b", dependsOnTaskId: "a" }], taskCompletionEvents: [] });
    expect(items.filter(item => item.type === "blocked_issue").map(item => item.taskId).sort()).toEqual(["a", "b"]);
  });
});

describe("CEO Office durable history", () => {
  it("retains the original decomposition after task edits and new tasks", () => {
    const planSnapshot = { tasks: [{ taskId: "a", title: { en: "Original assignment" }, purpose: { en: "Original purpose" }, departmentId: "d", dependsOnTaskIds: [] }] };
    const items = projectCeoOfficeItems({ company, tasks: [{ ...task("a"), title: "Changed" }, task("b")], companyEvents: [{ id: "plan", companyId: company.id, type: "company_plan_created", message: "Plan", createdAt: company.createdAt, planSnapshot }], taskCompletionEvents: [] });
    expect(items.find(item => item.type === "plan_brief")?.data).toEqual({ taskCount: 1, tasks: planSnapshot.tasks });
  });
  it("collapses explicit cascade causes and retains independent downstream issues", () => {
    const items = projectCeoOfficeItems({ company, tasks: [task("a"), task("b"), task("c")], taskCompletionEvents: [], taskEvents: [event("a"), { ...event("b"), blockedByTaskId: "a" }, { ...event("c"), blockedByTaskId: "b" }, { ...event("b"), id: "independent_b", createdAt: "2026-09-01T10:00:00Z" }] });
    const issues = items.filter(item => item.type === "blocked_issue");
    expect(issues).toHaveLength(2);
    expect(issues.find(item => item.taskId === "a")?.data.affectedTaskIds).toEqual(["a", "b", "c"]);
    expect(issues.find(item => item.taskId === "b")?.data.affectedTaskIds).toEqual(["b"]);
  });
  it("updates a resolved blocker in place and creates a new episode only after recovery", () => {
    const first = event("a");
    const recovered = { ...event("a"), id: "recovered", type: "task_recovered" as const, status: "queued" as const, createdAt: "2026-09-01T10:00:00Z" };
    const again = { ...event("a"), id: "again", createdAt: "2026-09-01T11:00:00Z" };
    const items = projectCeoOfficeItems({ company, tasks: [task("a")], taskCompletionEvents: [], taskEvents: [first, { ...first, id: "refresh" }, recovered, again] });
    expect(items.filter(item => item.type === "blocked_issue").map(item => [item.id, item.actionBearing, item.data.status])).toEqual([
      ["blocked_issue:failure_a", false, "resolved"], ["blocked_issue:again", true, "open"],
    ]);
  });
  it("does not synthesize a start from a completed legacy task", () => {
    const items = projectCeoOfficeItems({ company, tasks: [{ ...task("a"), status: "complete" }], taskCompletionEvents: [{ id: "done", companyId: "c", taskId: "a", departmentId: "d", keyResultId: null, businessArtifactId: null, outcome: "accepted", outcomeSummaryText: { en: "Done" }, dependencyImpact: {}, nextStepItems: [], visionGaps: [], createdAt: "2026-09-01T10:00:00Z" }] });
    expect(items.map(item => item.type)).toEqual(["execution_report"]);
  });
  it("uses durable append order for recovery and repeat failure in the same millisecond", () => {
    const items = projectCeoOfficeItems({ company, tasks: [task("a")], taskCompletionEvents: [], taskEvents: [
      { ...event("a"), id: "z_first", sequence: 1 },
      { ...event("a"), id: "m_recovery", sequence: 2, type: "task_recovered", status: "queued" },
      { ...event("a"), id: "a_again", sequence: 3 },
    ] });
    expect(items.find(item => item.id === "blocked_issue:z_first")).toMatchObject({ actionBearing: false, data: { status: "resolved" } });
    expect(items.find(item => item.id === "blocked_issue:a_again")).toMatchObject({ actionBearing: true, data: { status: "open" } });
  });
  it("does not revive an old completion-only blocker after replanning", () => {
    const items = projectCeoOfficeItems({ company, tasks: [{ ...task("a"), latestFailureReason: "needs_replan" }],
      taskEvents: [{ ...event("a"), id: "replan", type: "task_replanned", createdAt: "2026-09-01T11:00:00Z" }],
      taskCompletionEvents: [{ id: "old_blocker", companyId: "c", taskId: "a", departmentId: "d", keyResultId: null, businessArtifactId: null, outcome: "needs_replan", outcomeSummaryText: { en: "Scope too large" }, dependencyImpact: {}, nextStepItems: [], visionGaps: [], createdAt: "2026-09-01T10:00:00Z" }],
    });
    expect(items.filter(item => item.type === "blocked_issue").every(item => !item.actionBearing)).toBe(true);
  });

});
