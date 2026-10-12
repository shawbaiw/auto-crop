import type { Task } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { collectFounderDecisions, collectHumanActions } from "./ceoAttention";

type Repositories = ReturnType<typeof createRepositories>;

/**
 * Where a Settled Fact came from. Every fact names its record, so an agent (and a person reading the
 * prompt) can tell a founder's choice from a person's confirmation from a verifier's finding.
 */
export type SettledFact =
  | {
      kind: "founder_decision";
      sourceId: string;
      settledAt: string;
      decisionKind: string;
      chosenOption: string;
    }
  | {
      kind: "human_action_confirmation";
      sourceId: string;
      settledAt: string;
      label: string;
      /** The task whose delivery or blocker asked for the action; this task, or an upstream it waited on. */
      requestedByTaskId: string;
      requestedByTaskTitle: string;
      evidence: Record<string, string>;
    }
  | {
      kind: "verification_rework";
      sourceId: string;
      settledAt: string;
      verifierTitle: string;
      round: number;
      failedChecks: Array<{ requirementId: string; description: string; outcome: string; evidence: string }>;
    };

/**
 * The task's Settled Facts: what has already been decided or supplied for it, read from runtime state
 * at dispatch (ADR 0042, ADR 0043).
 *
 * This is the one place a run learns them, and every dispatch of a task calls it — first run, retry,
 * recovery, rework, or a revised task's re-run alike. A fact kept only by the path that happened to
 * cause a re-run is a fact the next kind of re-run forgets: a revised keyword task re-asked the
 * founder for the keyword it had already been given. The facts come from records the runtime holds,
 * never from a file in the agent's workspace, which the agent can rewrite.
 *
 * - Founder Decisions on this task that the founder resolved by picking an option. A returned decision
 *   chose nothing and is not a fact.
 * - Confirmed Human Actions on this task (an Unblock Request) or gating it (a delivery's next step
 *   naming it as blocked).
 * - Verification Rework feedback not yet answered by a redelivery.
 */
export function resolveSettledFacts(repositories: Repositories, task: Task): SettledFact[] {
  const completionEvents = repositories.listTaskCompletionEventsForCompany(task.companyId);
  const resolutionsById = new Map(
    repositories.listFounderDecisionResolutionsForCompany(task.companyId)
      .map((resolution) => [resolution.founderDecisionId, resolution]),
  );
  const confirmationsById = new Map(
    repositories.listHumanActionConfirmationsForCompany(task.companyId)
      .map((confirmation) => [confirmation.humanActionId, confirmation]),
  );

  const decisions: SettledFact[] = completionEvents
    .filter((event) => event.taskId === task.id)
    .flatMap((event) => collectFounderDecisions(event, resolutionsById))
    .flatMap((decision) => decision.status === "resolved" && decision.resolvedOption && decision.resolvedAt
      ? [{
          kind: "founder_decision" as const,
          sourceId: decision.id,
          settledAt: decision.resolvedAt,
          decisionKind: decision.decisionKind,
          chosenOption: decision.resolvedOption,
        }]
      : []);

  const confirmations: SettledFact[] = completionEvents
    .flatMap((event) => collectHumanActions(event, confirmationsById))
    .filter((action) => action.taskId === task.id || action.blockedTaskIds.includes(task.id))
    .flatMap((action) => action.status === "confirmed" && action.verifiedAt
      ? [{
          kind: "human_action_confirmation" as const,
          sourceId: action.id,
          settledAt: action.verifiedAt,
          label: action.label,
          requestedByTaskId: action.taskId,
          requestedByTaskTitle: action.taskId === task.id ? task.title : (repositories.getTask(action.taskId)?.title ?? action.taskId),
          evidence: action.evidence,
        }]
      : []);

  const reworks: SettledFact[] = repositories.listPendingReworksForProducer(task.id).map((rework) => ({
    kind: "verification_rework" as const,
    sourceId: rework.id,
    settledAt: rework.createdAt,
    verifierTitle: repositories.getTask(rework.verifierTaskId)?.title ?? rework.verifierTaskId,
    round: rework.round,
    // A verdict covering several targets sends each producer only the checks that failed on it.
    failedChecks: rework.failedChecks.filter((check) => !check.targetTaskId || check.targetTaskId === task.id),
  }));

  return [...decisions, ...confirmations, ...reworks]
    .sort((left, right) => left.settledAt.localeCompare(right.settledAt) || left.sourceId.localeCompare(right.sourceId));
}

/**
 * The prompt lines for a task's Settled Facts. One rule for all of them, about their shape — each is
 * settled by its named source and binds the run — rather than a paragraph per kind, so a fact kind
 * added later is stated the same way instead of growing its own instruction.
 */
export function renderSettledFacts(facts: SettledFact[]): string[] {
  if (facts.length === 0) {
    return [];
  }
  return [
    "## Settled Facts",
    "",
    "Each fact below was settled outside your runs by the source it names. Treat every one as given for this run:",
    "build on it, and do not ask for, re-decide, or contradict it. A verifier's finding is settled too: the delivery",
    "this run replaces failed that check, and this delivery must meet it.",
    "",
    ...facts.flatMap(renderSettledFact),
    "",
  ];
}

function renderSettledFact(fact: SettledFact): string[] {
  switch (fact.kind) {
    case "founder_decision":
      return [`- Founder Decision \`${fact.sourceId}\` (${fact.decisionKind}), resolved ${fact.settledAt}: the founder chose "${fact.chosenOption}".`];
    case "human_action_confirmation":
      return [
        `- Human Action Confirmation \`${fact.sourceId}\` "${fact.label}", asked for by task "${fact.requestedByTaskTitle}", confirmed ${fact.settledAt}. Evidence:`,
        ...Object.entries(fact.evidence).map(([key, value]) => `  - ${key}: ${value}`),
      ];
    case "verification_rework":
      return [
        `- Verification Rework \`${fact.sourceId}\` from ${fact.verifierTitle}, verification round ${fact.round}:`,
        ...fact.failedChecks.map((check) => `  - \`${check.requirementId}\` (${check.outcome}): ${check.description} — evidence: ${check.evidence}`),
      ];
  }
}
