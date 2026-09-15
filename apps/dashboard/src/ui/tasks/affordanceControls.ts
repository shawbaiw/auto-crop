import type { TaskAffordanceKind } from "../../api/client";
import type { TranslationKey } from "../language";

/**
 * Where each Resume Affordance is rendered.
 *
 * The dashboard's half of the contract the server already keeps: the server guarantees every Task
 * Hold offers a real way forward and that something performs it, and this guarantees the founder can
 * actually reach it. Both halves failed once — the board kept its own eligibility rules and drew
 * nothing for a task at the Bounded Recovery ceiling, whose only way forward was to replan.
 *
 * Exhaustive over `TaskAffordanceKind`, so a new affordance cannot be added without someone deciding
 * where it appears. `unsurfaced` is allowed, but it has to be argued for in writing rather than
 * happening by omission — which is how the replan gap survived.
 */
export type InlineAffordanceButton = {
  labelKey: TranslationKey;
  tone?: "danger";
  /** For a two-way answer, which side this button submits. */
  decision?: "approved" | "denied";
};

/** Which handler performs an inline affordance. Keyed so a new inline kind must be wired up. */
export type InlineAffordanceHandler = "refresh" | "recover" | "founderApproval" | "requestReplan";

export type TaskAffordanceControl =
  | { render: "inline"; handler: InlineAffordanceHandler; buttons: readonly InlineAffordanceButton[] }
  | { render: "surface"; surface: string }
  | { render: "unsurfaced"; reason: string };

export const taskAffordanceControls: Record<TaskAffordanceKind, TaskAffordanceControl> = {
  refresh_task: {
    render: "inline",
    handler: "refresh",
    buttons: [{ labelKey: "department.refreshTask" }],
  },
  recover_task: {
    render: "inline",
    handler: "recover",
    buttons: [{ labelKey: "department.recoverTask" }],
  },
  decide_founder_approval: {
    render: "inline",
    handler: "founderApproval",
    buttons: [
      { labelKey: "department.grantFounderApproval", decision: "approved" },
      { labelKey: "department.denyFounderApproval", decision: "denied", tone: "danger" },
    ],
  },
  // Inline on the task itself, not only on the Operations page: a task at the Bounded Recovery
  // ceiling has replanning as its *only* way forward, and it never reaches `needs_replan` status.
  request_replan: {
    render: "inline",
    handler: "requestReplan",
    buttons: [{ labelKey: "department.requestReplan" }],
  },
  ceo_review_decision: { render: "surface", surface: "CEO Office review detail, gated by the affordance" },
  resolve_founder_decision: { render: "surface", surface: "CEO Office decision card" },
  confirm_human_action: { render: "surface", surface: "Human Action panel" },
  confirm_replan: { render: "surface", surface: "Company Operations replan proposals" },
  cancel_task: {
    render: "unsurfaced",
    reason:
      "Cancelling is the founder's escape hatch, never a task's only way forward — every Hold kind "
      + "offers something else — so no surface draws it yet. Exposing it needs a confirmation flow.",
  },
};

/** The inline buttons to draw for a task, in the order its affordances were offered. */
export function inlineAffordanceControls(
  affordances: ReadonlyArray<{ kind: TaskAffordanceKind; subjectId: string | null }>,
): Array<{
  kind: TaskAffordanceKind;
  subjectId: string | null;
  handler: InlineAffordanceHandler;
  buttons: readonly InlineAffordanceButton[];
}> {
  return affordances.flatMap((affordance) => {
    const control = taskAffordanceControls[affordance.kind];
    return control?.render === "inline"
      ? [{ kind: affordance.kind, subjectId: affordance.subjectId, handler: control.handler, buttons: control.buttons }]
      : [];
  });
}
