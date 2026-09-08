import { describe, expect, it } from "vitest";
import { projectCeoOfficeItems, type Company, type FounderDecision, type Task, type TaskCompletionEvent, type TaskProgressEvent } from "./index";

const company: Company = {
  id: "company", name: "Studio", founderVision: "Build a sustainable business",
  selectedCeoAgentId: "ceo", playbookId: "custom", status: "active",
  createdAt: "2026-09-01T08:00:00Z", updatedAt: "2026-09-01T08:00:00Z",
};

function scenario(title: string, conclusion: string) {
  const task: Task = {
    id: "task", companyId: company.id, departmentId: "product", keyResultId: null,
    position: 0, title, description: "Evaluate the business options", assigneeAgentId: "agent",
    requiredCapabilities: [], proofSchemaId: "custom-proof", workspacePath: "/private/workspace",
    status: "complete", riskLevel: "low",
  };
  const progress: TaskProgressEvent = {
    id: "progress", companyId: company.id, departmentId: "product", parentTaskId: task.id,
    subjectTaskId: task.id, step: "received", status: "complete", label: "Received",
    detail: null, createdAt: "2026-09-01T09:00:00Z",
  };
  const completion: TaskCompletionEvent = {
    id: "completion", companyId: company.id, taskId: task.id, departmentId: "product",
    keyResultId: null, businessArtifactId: null, outcome: "accepted",
    outcomeSummaryText: { en: conclusion, zh: "业务结论" }, dependencyImpact: {},
    nextStepItems: [], visionGaps: [], createdAt: "2026-09-01T10:00:00Z",
  };
  return { company, tasks: [task], taskProgressEvents: [progress], taskCompletionEvents: [completion] };
}

describe("projectCeoOfficeItems", () => {
  it.each([
    ["Choose pricing", "A monthly subscription covers delivery costs"],
    ["Define an MVP", "A concierge service can validate demand"],
    ["Plan a launch", "Invite the pilot customers first"],
  ])("projects a brief and report for %s without a prescribed artifact subtype", (title, conclusion) => {
    const state = scenario(title, conclusion);
    const items = projectCeoOfficeItems(state);
    expect(items).toMatchObject([
      { id: "task_brief:task", type: "task_brief", title, occurredAt: "2026-09-01T09:00:00Z", actionBearing: false },
      { id: "execution_report:completion", type: "execution_report", title,
        occurredAt: "2026-09-01T10:00:00Z", actionBearing: false,
        data: { conclusion: { en: conclusion, zh: "业务结论" } } },
    ]);
    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.actionBearing)).toEqual([]);
    expect(JSON.stringify(items)).not.toContain("/private/workspace");
  });

  it("puts the conclusion before its pending choice and preserves the choice identity after resolution", () => {
    const state = scenario("Choose pricing", "Compare the monthly and annual plans");
    const decision: FounderDecision = {
      id: "choice", companyId: company.id, sourceTaskCompletionEventId: "completion", taskId: "task",
      departmentId: "product", decisionKind: "pricing_model", rationale: "Choose a billing period",
      options: [{ label: "Monthly", tradeoffs: "Lower upfront commitment", recommended: true }],
      status: "pending", resolvedOption: null, resolvedAt: null, blockedTaskIds: ["launch"],
      createdAt: "2026-09-01T10:00:00Z",
    };
    const pending = projectCeoOfficeItems({ ...state, founderDecisions: [decision] });
    expect(pending.map((item) => item.type)).toEqual(["task_brief", "execution_report", "decision_request"]);
    expect(pending.filter((item) => item.actionBearing)).toMatchObject([
      { id: "decision_request:choice", data: { status: "pending", decisionKind: "pricing_model" } },
    ]);
    const resolved = projectCeoOfficeItems({ ...state, founderDecisions: [{
      ...decision, status: "resolved", resolvedOption: "Monthly", resolvedAt: "2026-09-01T11:00:00Z",
    }] });
    expect(resolved.filter((item) => item.actionBearing)).toEqual([]);
    expect(resolved.find((item) => item.id === "decision_request:choice")).toMatchObject({
      occurredAt: decision.createdAt, data: { status: "resolved", resolvedOption: "Monthly" },
    });
  });

  it("keeps chronological order and source identities across shuffled reads without mutating state", () => {
    const state = scenario("Define an MVP", "Start with a concierge service");
    const input = {
      ...state,
      tasks: [...state.tasks, { ...state.tasks[0]!, id: "earlier" }],
      taskCompletionEvents: [
        { ...state.taskCompletionEvents[0]!, id: "z" },
        { ...state.taskCompletionEvents[0]!, id: "a", createdAt: "2026-09-01T12:00:00+02:00" },
        { ...state.taskCompletionEvents[0]!, id: "early", taskId: "earlier", createdAt: "2026-09-01T08:30:00Z" },
      ],
    };
    const before = structuredClone(input);
    const projected = projectCeoOfficeItems(input);
    expect(projected.map((item) => item.id)).toEqual([
      "task_brief:earlier", "execution_report:early", "task_brief:task", "execution_report:a", "execution_report:z",
    ]);
    expect(projectCeoOfficeItems({
      ...input, tasks: [...input.tasks].reverse(), taskCompletionEvents: [...input.taskCompletionEvents].reverse(),
    })).toEqual(projected);
    expect(input).toEqual(before);
  });

  it("omits unstarted work and uses completion facts when older tasks have no progress history", () => {
    const state = scenario("Plan a launch", "Invite pilot customers");
    expect(projectCeoOfficeItems({ ...state, taskProgressEvents: [], taskCompletionEvents: [] })).toEqual([]);
    expect(projectCeoOfficeItems({ ...state, taskProgressEvents: [] })).toMatchObject([
      { type: "task_brief", occurredAt: "2026-09-01T10:00:00Z" },
      { type: "execution_report", occurredAt: "2026-09-01T10:00:00Z" },
    ]);
  });

  it("does not import another company's facts into the timeline", () => {
    const state = scenario("Choose pricing", "Offer a subscription");
    expect(projectCeoOfficeItems({
      ...state,
      tasks: state.tasks.map((task) => ({ ...task, companyId: "other" })),
      taskProgressEvents: state.taskProgressEvents.map((event) => ({ ...event, companyId: "other" })),
      taskCompletionEvents: state.taskCompletionEvents.map((event) => ({ ...event, companyId: "other" })),
    })).toEqual([]);
  });
});
