import { localizedTextFromString, type LocalizedText } from "./localizedText";
import type {
  BusinessArtifact, CeoAttentionRollup, CeoReviewDecision, Company, FinalFounderReport,
  FounderDecision, HumanAction, KeyResult, Objective, Task, TaskCompletionEvent,
  TaskDependency, TaskEvent, TaskProgressEvent, VisionGap, WaitState,
} from "./types";

type OfficeItem<Type extends string, Data, ActionBearing extends boolean = boolean> = {
  id: string;
  type: Type;
  companyId: string;
  sourceId: string;
  taskId: string | null;
  departmentId: string | null;
  objectiveId: string | null;
  keyResultId: string | null;
  occurredAt: string;
  title: string;
  titleText: LocalizedText | null;
  actionBearing: ActionBearing;
  data: Data;
};

/** Business-only payloads: source IDs link to details without exposing execution diagnostics. */
export type CEOOfficeItem =
  | OfficeItem<"task_brief", {
      purpose: LocalizedText;
      expectedOutput: string;
      founderVision: string;
      dependsOnTaskIds: string[];
    }, false>
  | OfficeItem<"execution_report", {
      conclusion: LocalizedText | null;
      visionImpact: LocalizedText | null;
      remainingGap: LocalizedText | null;
      recommendation: LocalizedText | null;
      businessArtifactId: string | null;
      outcome: TaskCompletionEvent["outcome"];
    }, false>
  | OfficeItem<"decision_request", Pick<FounderDecision,
      "decisionKind" | "options" | "rationale" | "status" | "resolvedOption" | "resolvedAt" | "blockedTaskIds">>
  | OfficeItem<"approval_request", {
      businessArtifactId: string;
      status: "pending" | "approved" | "returned";
    }>
  | OfficeItem<"decision_resolution", {
      requestItemId: string;
      outcome: "resolved" | "approved" | "returned";
      chosenOption: string | null;
      note: LocalizedText | null;
    }, false>
  | OfficeItem<"human_action", Pick<HumanAction,
      "label" | "status" | "confirmationRequirements" | "blockedTaskIds" | "verifiedAt">>
  | OfficeItem<"wait_state", Pick<WaitState,
      "reason" | "status" | "nextCheckAt" | "affectedTaskIds">>
  | OfficeItem<"blocked_issue", {
      reason: string;
      status: "open" | "resolved";
      affectedTaskIds: string[];
    }>
  | OfficeItem<"stage_change", Pick<CeoAttentionRollup,
      "summary" | "recommendedNextAction" | "affectedTaskIds">, false>
  | OfficeItem<"final_report", Pick<FinalFounderReport,
      "classification" | "sections" | "isCurrent" | "supersedesReportId">, false>;

/** Existing company facts; optional collections allow older snapshots and incremental projectors. */
export type CeoOfficeProjectionInput = {
  company: Company;
  tasks: readonly Task[];
  taskCompletionEvents: readonly TaskCompletionEvent[];
  taskProgressEvents?: readonly TaskProgressEvent[];
  taskEvents?: readonly TaskEvent[];
  taskDependencies?: readonly TaskDependency[];
  objectives?: readonly Objective[];
  keyResults?: readonly KeyResult[];
  businessArtifacts?: readonly BusinessArtifact[];
  founderDecisions?: readonly FounderDecision[];
  ceoReviewDecisions?: readonly CeoReviewDecision[];
  humanActions?: readonly HumanAction[];
  waitStates?: readonly WaitState[];
  visionGaps?: readonly VisionGap[];
  ceoAttentionRollups?: readonly CeoAttentionRollup[];
  finalFounderReports?: readonly FinalFounderReport[];
};

const timelineOrder: Record<CEOOfficeItem["type"], number> = {
  task_brief: 0, execution_report: 1, decision_request: 2, approval_request: 3,
  human_action: 4, wait_state: 5, blocked_issue: 6, decision_resolution: 7,
  stage_change: 8, final_report: 9,
};

/**
 * Pure, oldest-first projection. Ties use business order then source-derived ID, never read time.
 * Only timestamped facts enter the timeline; a task definition alone is not an occurred event.
 * Detailed report enrichment and the remaining item projectors are added in tickets 03-05.
 */
export function projectCeoOfficeItems(input: CeoOfficeProjectionInput): CEOOfficeItem[] {
  const tasks = input.tasks.filter((task) => task.companyId === input.company.id);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const keyResultsById = new Map((input.keyResults ?? []).map((result) => [result.id, result]));
  const completions = input.taskCompletionEvents.filter((event) => event.companyId === input.company.id);
  const items: CEOOfficeItem[] = [];

  function context(taskId: string) {
    const task = tasksById.get(taskId);
    const keyResultId = task?.keyResultId ?? null;
    return {
      companyId: input.company.id,
      taskId,
      departmentId: task?.departmentId ?? null,
      keyResultId,
      objectiveId: keyResultId ? keyResultsById.get(keyResultId)?.objectiveId ?? null : null,
      title: task?.title ?? "Task",
      titleText: task?.titleText ?? null,
    };
  }

  for (const task of tasks) {
    const timestamps = [
      ...(input.taskProgressEvents ?? [])
        .filter((event) => event.companyId === input.company.id &&
          (event.subjectTaskId ?? event.parentTaskId) === task.id && event.status !== "waiting")
        .map((event) => event.createdAt),
      ...completions.filter((event) => event.taskId === task.id).map((event) => event.createdAt),
    ].filter((timestamp) => Number.isFinite(Date.parse(timestamp)));
    timestamps.sort((a, b) => Date.parse(a) - Date.parse(b));
    const occurredAt = timestamps[0];
    if (!occurredAt) continue;

    items.push({
      ...context(task.id), id: `task_brief:${task.id}`, type: "task_brief", sourceId: task.id,
      occurredAt, actionBearing: false,
      data: {
        purpose: task.descriptionText ?? localizedTextFromString(task.description),
        expectedOutput: task.proofSchemaId,
        founderVision: input.company.founderVision,
        dependsOnTaskIds: [...new Set((input.taskDependencies ?? [])
          .filter((dependency) => dependency.taskId === task.id)
          .map((dependency) => dependency.dependsOnTaskId))].sort(),
      },
    });
  }

  for (const event of completions) {
    items.push({
      ...context(event.taskId), departmentId: event.departmentId,
      id: `execution_report:${event.id}`, type: "execution_report", sourceId: event.id,
      occurredAt: event.createdAt, actionBearing: false,
      data: {
        conclusion: event.outcomeSummaryText ?? null,
        visionImpact: null, remainingGap: null, recommendation: null,
        businessArtifactId: event.businessArtifactId, outcome: event.outcome,
      },
    });
  }

  for (const decision of input.founderDecisions ?? []) {
    if (decision.companyId !== input.company.id) continue;
    items.push({
      ...context(decision.taskId), departmentId: decision.departmentId,
      id: `decision_request:${decision.id}`, type: "decision_request", sourceId: decision.id,
      occurredAt: decision.createdAt, actionBearing: decision.status === "pending",
      data: {
        decisionKind: decision.decisionKind, options: decision.options, rationale: decision.rationale,
        status: decision.status, resolvedOption: decision.resolvedOption, resolvedAt: decision.resolvedAt,
        blockedTaskIds: decision.blockedTaskIds,
      },
    });
  }

  return items.filter((item) => Number.isFinite(Date.parse(item.occurredAt))).sort((a, b) =>
    Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
    timelineOrder[a.type] - timelineOrder[b.type] ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
