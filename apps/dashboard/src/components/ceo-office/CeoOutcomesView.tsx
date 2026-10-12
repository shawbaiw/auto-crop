import { useState } from "react";
import type {
  DepartmentSummary,
  FounderDecisionSummary,
  KeyResultSummary,
  ObjectiveSummary,
  TaskCompletionEventSummary,
  TaskSummary,
} from "../../api/client";
import type { WorkspaceHandlers } from "../workbench/workspaceHandlers";
import { isUnseenSince } from "../../ui/ceoOutcomes/lastSeen";
import { useLanguage } from "../../ui/language";
import { departmentName, taskDescription, taskTitle } from "../../ui/language/localizedNames";
import { resolveLocalizedValue } from "../../ui/language/localizedText";
import { RetroBadge } from "../../ui/retro";
import { CeoFounderDecisionCard } from "./CeoFounderDecisionCard";

/** How many of the most recent outcome-carrying Task Completion Events the Outcomes view shows. */
const RECENT_OUTCOME_LIMIT = 12;

type OutcomeGroup = {
  key: string;
  label: string;
  priority: number;
  events: TaskCompletionEventSummary[];
};

function hasOutcomeSummary(event: TaskCompletionEventSummary): boolean {
  const text = event.outcomeSummaryText;
  if (!text) {
    return false;
  }
  return Boolean((text.en && text.en.trim()) || (text.zh && text.zh.trim()));
}

function groupOutcomesByObjective(
  events: TaskCompletionEventSummary[],
  keyResults: KeyResultSummary[],
  objectives: ObjectiveSummary[],
  ungroupedLabel: string,
  language: "en" | "zh",
): OutcomeGroup[] {
  const keyResultsById = new Map(keyResults.map((keyResult) => [keyResult.id, keyResult]));
  const objectivesById = new Map(objectives.map((objective) => [objective.id, objective]));
  const groups = new Map<string, OutcomeGroup>();

  for (const event of events) {
    const keyResult = event.keyResultId ? keyResultsById.get(event.keyResultId) : undefined;
    const objective = keyResult ? objectivesById.get(keyResult.objectiveId) : undefined;
    const key = objective?.id ?? "__ungrouped__";
    const existing = groups.get(key);
    if (existing) {
      existing.events.push(event);
      continue;
    }
    groups.set(key, {
      key,
      label: objective ? resolveLocalizedValue(objective.titleText, language, objective.title) : ungroupedLabel,
      priority: objective?.priority ?? Number.MAX_SAFE_INTEGER,
      events: [event],
    });
  }

  return [...groups.values()].sort((a, b) => a.priority - b.priority);
}

/**
 * Business-language read of a Task Completion Event's `dependencyImpact`. The server serializes it as
 * `{ updatedTasks: [{ taskId, status }], errors }` on an acceptance cascade and `{ blockedTaskIds }`
 * on a non-acceptance outcome (see `businessAcceptance.ts` / `scheduler.ts`).
 */
function outcomeDependencyImpact(
  event: TaskCompletionEventSummary,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  if (event.outcome === "awaiting_founder_decision") {
    return t("department.outcomeAwaitingDecision");
  }
  const bag = event.dependencyImpact;
  const record = bag && typeof bag === "object" && !Array.isArray(bag) ? (bag as Record<string, unknown>) : {};

  const unblocked = Array.isArray(record.updatedTasks)
    ? record.updatedTasks.filter(
        (entry) =>
          entry != null &&
          typeof entry === "object" &&
          (entry as { status?: unknown }).status === "queued",
      ).length
    : 0;
  if (unblocked > 0) {
    return `${t("department.outcomeUnblocks")} (${unblocked})`;
  }

  const blocked = Array.isArray(record.blockedTaskIds)
    ? record.blockedTaskIds.filter((entry) => typeof entry === "string").length
    : 0;
  if (blocked > 0) {
    return `${t("department.outcomeHolds")} (${blocked})`;
  }

  return t("department.outcomeNoImpact");
}

export function CeoOutcomesView({
  departmentsById,
  founderDecisions,
  keyResults,
  objectives,
  onResolveFounderDecision,
  outcomesLastSeen,
  taskCompletionEvents,
  tasksById,
}: {
  departmentsById: Map<string, DepartmentSummary>;
  founderDecisions: FounderDecisionSummary[];
  keyResults: KeyResultSummary[];
  objectives: ObjectiveSummary[];
  onResolveFounderDecision?: WorkspaceHandlers["onResolveFounderDecision"];
  outcomesLastSeen: string | null;
  taskCompletionEvents: TaskCompletionEventSummary[];
  tasksById: Map<string, TaskSummary>;
}) {
  const { language, t } = useLanguage();
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const pendingDecisions = founderDecisions.filter((decision) => decision.status === "pending");
  const outcomeEventsWithSummary = [...taskCompletionEvents]
    .filter(hasOutcomeSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const outcomeEvents = outcomeEventsWithSummary.slice(0, RECENT_OUTCOME_LIMIT);
  const groups = groupOutcomesByObjective(outcomeEvents, keyResults, objectives, t("department.outcomesUngrouped"), language);
  // Count every unseen outcome, not just the recent slice that renders below — the marker is a
  // "there is new activity" cue. A null last-seen never marks anything new (first visits stay quiet).
  const newOutcomeCount = outcomeEventsWithSummary.filter((event) =>
    isUnseenSince(event.createdAt, outcomesLastSeen),
  ).length;

  const taskLabel = (taskId: string): string => {
    const task = tasksById.get(taskId);
    return task ? taskTitle(task, language) : taskId;
  };
  const taskBrief = (taskId: string): string => {
    const task = tasksById.get(taskId);
    return task ? taskDescription(task, language) : "";
  };
  const departmentLabel = (departmentId: string): string => {
    const department = departmentsById.get(departmentId);
    return department ? departmentName(department, language) : departmentId;
  };

  return (
    <section className="ceo-outcomes-view" aria-label={t("department.ceoOutcomes")}>
      <h3>{t("department.ceoOutcomes")}</h3>
      <p className="muted">{t("department.ceoOutcomesNote")}</p>
      {newOutcomeCount > 0 ? (
        <p className="ceo-outcomes-view__new-marker">
          <RetroBadge tone="signal">
            {t("department.ceoOutcomesNewMarker").replace("{count}", String(newOutcomeCount))}
          </RetroBadge>
        </p>
      ) : null}
      {decisionMessage ? <p className="system-message">{decisionMessage}</p> : null}

      {pendingDecisions.length > 0 ? (
        <section className="ceo-outcomes-view__decisions" aria-label={t("department.founderDecisionsPinned")}>
          <h4>{t("department.founderDecisionsPinned")}</h4>
          {pendingDecisions.map((decision) => (
            <CeoFounderDecisionCard
              key={decision.id}
              decision={decision}
              departmentLabel={departmentLabel(decision.departmentId)}
              onResolveFounderDecision={onResolveFounderDecision}
              onResolved={setDecisionMessage}
              taskLabel={taskLabel(decision.taskId)}
            />
          ))}
        </section>
      ) : null}

      {outcomeEvents.length === 0 ? <p className="muted">{t("department.noOutcomes")}</p> : null}
      {groups.map((group) => (
        <section className="ceo-outcomes-view__group" aria-label={group.label} key={group.key}>
          <h4>{group.label}</h4>
          {group.events.map((event) => {
            const brief = taskBrief(event.taskId);
            return (
              <article className="ceo-outcome" key={event.id}>
                <h5>{taskLabel(event.taskId)}</h5>
                {brief ? (
                  <p className="ceo-outcome__brief muted">
                    <span className="ceo-outcome__brief-label">{t("department.outcomeBriefLabel")}</span>{" "}
                    {brief}
                  </p>
                ) : null}
                <p className="ceo-outcome__summary">
                  {resolveLocalizedValue(event.outcomeSummaryText, language, event.outcomeSummaryText?.en ?? "")}
                </p>
                <p className="muted">{outcomeDependencyImpact(event, t)}</p>
              </article>
            );
          })}
        </section>
      ))}
    </section>
  );
}
