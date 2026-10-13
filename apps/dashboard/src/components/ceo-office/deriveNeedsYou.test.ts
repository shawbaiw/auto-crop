import { describe, expect, it } from "vitest";
import type { CeoOfficeItemSummary, ReplanProposalSummary, TaskAffordanceSummary, TaskSummary } from "../../api/client";
import { deriveNeedsYou, needsYouByDepartment, needsYouCount } from "./deriveNeedsYou";

const offer = (kind: TaskAffordanceSummary["kind"], actor: TaskAffordanceSummary["actor"] = "founder"): TaskAffordanceSummary => ({
  kind, actor, holdId: "hold", holdKind: null, subjectKind: null, subjectId: null,
});
const task = (id: string, departmentId: string, affordances: TaskAffordanceSummary[], extra: Partial<TaskSummary> = {}): TaskSummary => ({
  id, title: id, status: "blocked", departmentId, affordances, ...extra,
});
const item = (type: CeoOfficeItemSummary["type"], taskId: string, departmentId: string, actionBearing = true) =>
  ({ id: `${type}:${taskId}`, type, taskId, departmentId, actionBearing }) as CeoOfficeItemSummary;

describe("deriveNeedsYou", () => {
  const tasks = [
    task("replan_only", "research", [offer("request_replan"), offer("cancel_task")]),
    task("approval", "product", [offer("decide_founder_approval")]),
    // The runtime can still recover this one by itself, so it does not wait on the founder.
    task("recoverable", "research", [offer("recover_task", "runtime"), offer("request_replan")]),
    // These founder actions have their own cards.
    task("in_review", "product", [offer("ceo_review_decision", "ceo_office")], { status: "review" }),
    // A new plan beside a Human Action is that action's way out, and the action already has a card.
    task("human_action", "product", [offer("confirm_human_action"), offer("request_replan")]),
    // A new plan already waits for this one.
    task("planned", "growth", [offer("request_replan")]),
    task("subtask", "growth", [offer("request_replan")], { taskKind: "department_subtask" }),
    task("running", "growth", [], { status: "running" }),
  ];
  const items = [
    item("approval_request", "in_review", "product"),
    item("human_action", "human_action", "product"),
    item("blocked_issue", "replan_only", "research"),
    item("wait_state", "running", "growth", false),
    item("decision_request", "old", "product", false),
  ];
  const plans = [
    { id: "p1", sourceTaskId: "planned", status: "proposed", stale: false },
    { id: "p2", sourceTaskId: "replan_only", status: "proposed", stale: true },
    { id: "p3", sourceTaskId: "running", status: "rejected" },
  ] as ReplanProposalSummary[];

  it("lists open reviews, decisions and Human Actions, new plans, and tasks only the founder can move", () => {
    const needs = deriveNeedsYou(items, tasks, plans);

    expect(needs.items.map((entry) => entry.id)).toEqual(["approval_request:in_review", "human_action:human_action"]);
    expect(needs.plans.map((proposal) => proposal.id)).toEqual(["p1"]);
    expect(needs.tasks.map(({ task: entry, kind }) => [entry.id, kind])).toEqual([
      ["replan_only", "request_replan"],
      ["approval", "decide_founder_approval"],
    ]);
    expect(needsYouCount(needs)).toBe(5);
  });

  it("counts each department's share for the rail from the same list", () => {
    const needs = deriveNeedsYou(items, tasks, plans);
    expect(Object.fromEntries(needsYouByDepartment(needs, tasks))).toEqual({ product: 3, research: 1, growth: 1 });
  });
});
