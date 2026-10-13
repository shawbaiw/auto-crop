import type { CeoOfficeItemSummary, ReplanProposalSummary, TaskAffordanceKind, TaskSummary } from "../../api/client";

/** The CEO Office Items that ask the founder to act, each with its own card. */
const ITEM_TYPES = new Set<CeoOfficeItemSummary["type"]>(["approval_request", "decision_request", "human_action"]);

/**
 * Founder actions another card already offers — a review, a decision, a Human Action, a new plan to
 * confirm — and cancelling, which is never the way forward. A task whose founder action is one of
 * these is counted by that card, not again as a task.
 */
const COVERED_KINDS = new Set<TaskAffordanceKind>([
  "ceo_review_decision", "resolve_founder_decision", "confirm_human_action", "confirm_replan", "cancel_task",
]);

export type NeedsYou = {
  items: CeoOfficeItemSummary[];
  plans: ReplanProposalSummary[];
  /** Tasks only the founder can move, with the action that moves them. */
  tasks: Array<{ task: TaskSummary; kind: TaskAffordanceKind }>;
};

/**
 * What needs the founder: open reviews, decisions and Human Actions, new plans to confirm, and tasks
 * only the founder can move. The one definition every count and list of "Needs you" reads — the
 * CEO Office column, its phone summary and the rail.
 *
 * Whether a task waits on the founder is read from the server's Resume Affordances (ADR 0020): it
 * offers a founder action no other card covers, and nothing the runtime can do by itself. The
 * dashboard adds no rule about statuses of its own.
 */
export function deriveNeedsYou(items: CeoOfficeItemSummary[], tasks: TaskSummary[], replanProposals: ReplanProposalSummary[]): NeedsYou {
  const plans = replanProposals.filter((proposal) => proposal.status === "proposed" && !proposal.stale);
  const cardItems = items.filter((item) => item.actionBearing && ITEM_TYPES.has(item.type));
  // A task that already has a card is not listed again: a new plan offered beside a Human Action is
  // that action's way out (ADR 0043), not a second thing to do.
  const carded = new Set([...plans.map((proposal) => proposal.sourceTaskId), ...cardItems.map((item) => item.taskId)]);
  return {
    items: cardItems,
    plans,
    tasks: tasks.flatMap((task) => {
      if (task.taskKind === "department_subtask" || carded.has(task.id)) return [];
      const affordances = task.affordances ?? [];
      if (affordances.some((affordance) => affordance.actor === "runtime")) return [];
      const founderAction = affordances.find((affordance) => affordance.actor === "founder" && !COVERED_KINDS.has(affordance.kind));
      return founderAction ? [{ task, kind: founderAction.kind }] : [];
    }),
  };
}

export function needsYouCount(needsYou: NeedsYou): number {
  return needsYou.items.length + needsYou.plans.length + needsYou.tasks.length;
}

/** How many of them belong to each department, for the rail. */
export function needsYouByDepartment(needsYou: NeedsYou, tasks: TaskSummary[]): Map<string, number> {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const counts = new Map<string, number>();
  const add = (departmentId: string | null | undefined) => {
    if (departmentId) counts.set(departmentId, (counts.get(departmentId) ?? 0) + 1);
  };
  needsYou.items.forEach((item) => add(item.departmentId ?? (item.taskId ? tasksById.get(item.taskId)?.departmentId : null)));
  needsYou.plans.forEach((proposal) => add(tasksById.get(proposal.sourceTaskId)?.departmentId));
  needsYou.tasks.forEach(({ task }) => add(task.departmentId));
  return counts;
}
