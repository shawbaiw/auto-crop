import { localizedTextFromString, type LocalizedText } from "./localizedText";
import type {
  AgentFailureReason, BusinessArtifact, CeoAttentionRollup, CeoReviewDecision, Company, FinalFounderReport,
  FounderDecision, FounderDecisionResolution, HumanAction, KeyResult, Objective, Task, TaskCompletionEvent,
  NextStepItem, TaskDependency, TaskEvent, TaskProgressEvent, TaskStatus, VisionGap, WaitState,
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
      purposeSource: "department_assessment" | "task_definition";
      founderVision: string;
      objectiveTitle: LocalizedText | null;
      keyResultTitle: LocalizedText | null;
      keyResultMetricName: string | null;
      keyResultTargetValue: LocalizedText | null;
      dependsOnTaskIds: string[];
    }, false>
  | OfficeItem<"execution_report", {
      conclusion: LocalizedText | null;
      visionImpact: LocalizedText | null;
      remainingGap: LocalizedText | null;
      recommendation: LocalizedText | null;
      summaryFallback: LocalizedText | null;
      businessArtifactId: string | null;
      remainingGaps: ExecutionReportGapSummary[];
      recommendedNextSteps: ExecutionReportNextStepSummary[];
      outcome: TaskCompletionEvent["outcome"];
    }, false>
  | OfficeItem<"decision_request", Pick<FounderDecision,
      "decisionKind" | "options" | "rationale" | "briefing" | "status" | "resolvedOption" | "resolvedAt" | "blockedTaskIds">>
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
  | OfficeItem<"stage_change", {
      summary: LocalizedText;
      recommendedNextAction: LocalizedText;
      affectedTaskIds: string[];
    }, false>
  | OfficeItem<"final_report", Pick<FinalFounderReport,
      "classification" | "sections" | "isCurrent" | "supersedesReportId">, false>;

type ExecutionReportGapSummary = {
  label: string;
  severity: string | null;
  relatedTaskId: string | null;
  relatedBusinessArtifactId: string | null;
};

type ExecutionReportNextStepSummary = Pick<NextStepItem,
  "type" | "label" | "ownerDepartmentId" | "relatedTaskId" | "relatedBusinessArtifactId" | "severity" | "priority">;

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
  founderDecisionResolutions?: readonly FounderDecisionResolution[];
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
 */
export function projectCeoOfficeItems(input: CeoOfficeProjectionInput): CEOOfficeItem[] {
  const tasks = input.tasks.filter((task) => task.companyId === input.company.id);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const objectivesById = new Map((input.objectives ?? [])
    .filter((objective) => objective.companyId === input.company.id)
    .map((objective) => [objective.id, objective]));
  const keyResultsById = new Map((input.keyResults ?? []).map((result) => [result.id, result]));
  const completions = input.taskCompletionEvents.filter((event) => event.companyId === input.company.id);
  const progressEvents = (input.taskProgressEvents ?? []).filter((event) => event.companyId === input.company.id);
  const taskEvents = (input.taskEvents ?? []).filter((event) => event.companyId === input.company.id);
  const businessArtifactsById = new Map((input.businessArtifacts ?? [])
    .filter((artifact) => artifact.companyId === input.company.id)
    .map((artifact) => [artifact.id, artifact]));
  const founderDecisionResolutionsById = new Map((input.founderDecisionResolutions ?? [])
    .filter((resolution) => resolution.companyId === input.company.id)
    .map((resolution) => [resolution.founderDecisionId, resolution]));
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
    const taskProgressEvents = progressEvents.filter((event) => (event.subjectTaskId ?? event.parentTaskId) === task.id);
    const timestamps = [
      ...taskProgressEvents
        .filter((event) => event.status !== "waiting")
        .map((event) => event.createdAt),
      ...completions.filter((event) => event.taskId === task.id).map((event) => event.createdAt),
    ].filter((timestamp) => Number.isFinite(Date.parse(timestamp)));
    timestamps.sort((a, b) => Date.parse(a) - Date.parse(b));
    const occurredAt = timestamps[0];
    if (!occurredAt) continue;

    const keyResult = task.keyResultId ? keyResultsById.get(task.keyResultId) ?? null : null;
    const objective = keyResult ? objectivesById.get(keyResult.objectiveId) ?? null : null;
    const executionStartedAt = taskProgressEvents
      .filter((event) => event.step === "executing")
      .map((event) => event.createdAt)
      .filter((timestamp) => Number.isFinite(Date.parse(timestamp)))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
    const firstCompletionAt = completions
      .filter((event) => event.taskId === task.id)
      .map((event) => event.createdAt)
      .filter((timestamp) => Number.isFinite(Date.parse(timestamp)))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
    const assessmentCutoff = earliestTimestamp([executionStartedAt, firstCompletionAt]);
    const assessment = latestAssessment(taskProgressEvents, assessmentCutoff);
    const assessmentPurpose = assessment?.detailText ?? (assessment?.detail ? localizedTextFromString(assessment.detail) : null);

    items.push({
      ...context(task.id), id: `task_brief:${task.id}`, type: "task_brief", sourceId: task.id,
      occurredAt, actionBearing: false,
      data: {
        purpose: assessmentPurpose ?? task.descriptionText ?? localizedTextFromString(task.description),
        purposeSource: assessmentPurpose ? "department_assessment" : "task_definition",
        founderVision: input.company.founderVision,
        objectiveTitle: objective ? objective.titleText ?? localizedTextFromString(objective.title) : null,
        keyResultTitle: keyResult ? keyResult.titleText ?? localizedTextFromString(keyResult.title) : null,
        keyResultMetricName: keyResult?.metricName ?? null,
        keyResultTargetValue: keyResult ? keyResult.targetValueText ?? localizedTextFromString(keyResult.targetValue) : null,
        dependsOnTaskIds: [...new Set((input.taskDependencies ?? [])
          .filter((dependency) => dependency.taskId === task.id)
          .map((dependency) => dependency.dependsOnTaskId))].sort(),
      },
    });
  }

  for (const event of completions) {
    const executionReport = event.executionReport ?? null;
    const businessArtifact = event.businessArtifactId ? businessArtifactsById.get(event.businessArtifactId) ?? null : null;
    const associatedBusinessArtifact = businessArtifact?.taskId === event.taskId ? businessArtifact : null;
    items.push({
      ...context(event.taskId), departmentId: event.departmentId,
      id: `execution_report:${event.id}`, type: "execution_report", sourceId: event.id,
      occurredAt: event.createdAt, actionBearing: false,
      data: {
        conclusion: executionReport?.conclusion ?? null,
        visionImpact: executionReport?.visionImpact ?? null,
        remainingGap: executionReport?.remainingGap ?? null,
        recommendation: executionReport?.recommendation ?? null,
        summaryFallback: executionReport ? null : event.outcomeSummaryText ?? null,
        businessArtifactId: associatedBusinessArtifact?.id ?? null,
        remainingGaps: summarizeVisionGaps(event.visionGaps),
        recommendedNextSteps: event.nextStepItems.map(summarizeNextStep),
        outcome: event.outcome,
      },
    });
  }

  for (const decision of input.founderDecisions ?? []) {
    if (decision.companyId !== input.company.id) continue;
    const resolution = founderDecisionResolutionsById.get(decision.id) ?? null;
    const status = resolution?.status ?? decision.status;
    const resolvedOption = resolution ? resolution.chosenOption : decision.resolvedOption;
    const resolvedAt = resolution?.resolvedAt ?? decision.resolvedAt;
    items.push({
      ...context(decision.taskId), departmentId: decision.departmentId,
      id: `decision_request:${decision.id}`, type: "decision_request", sourceId: decision.id,
      occurredAt: decision.createdAt, actionBearing: status === "pending",
      data: {
        decisionKind: decision.decisionKind, options: decision.options, rationale: decision.rationale,
        briefing: decision.briefing,
        status, resolvedOption, resolvedAt,
        blockedTaskIds: decision.blockedTaskIds,
      },
    });
  }

  const founderDecisionsById = new Map((input.founderDecisions ?? [])
    .filter((decision) => decision.companyId === input.company.id)
    .map((decision) => [decision.id, decision]));
  for (const resolution of founderDecisionResolutionsById.values()) {
    const decision = founderDecisionsById.get(resolution.founderDecisionId) ?? null;
    const resolutionContext = context(resolution.taskId);
    items.push({
      ...resolutionContext,
      departmentId: decision?.departmentId ?? resolutionContext.departmentId,
      id: `decision_resolution:${resolution.founderDecisionId}`,
      type: "decision_resolution",
      sourceId: resolution.founderDecisionId,
      occurredAt: resolution.resolvedAt,
      actionBearing: false,
      data: {
        requestItemId: `decision_request:${resolution.founderDecisionId}`,
        outcome: resolution.status,
        chosenOption: resolution.chosenOption,
        note: resolution.note ? localizedTextFromString(resolution.note) : null,
      },
    });
  }

  for (const artifact of businessArtifactsById.values()) {
    if (!isPendingReviewArtifact(artifact)) continue;
    items.push({
      ...context(artifact.taskId),
      id: `approval_request:${artifact.id}`,
      type: "approval_request",
      sourceId: artifact.id,
      occurredAt: artifact.createdAt,
      actionBearing: true,
      data: { businessArtifactId: artifact.id, status: "pending" },
    });
  }

  for (const action of input.humanActions ?? []) {
    if (action.companyId !== input.company.id) continue;
    items.push({
      ...context(action.taskId), departmentId: action.departmentId,
      id: `human_action:${action.id}`, type: "human_action", sourceId: action.id,
      occurredAt: action.createdAt, actionBearing: action.status === "pending",
      data: {
        label: action.label,
        status: action.status,
        confirmationRequirements: action.confirmationRequirements,
        blockedTaskIds: action.blockedTaskIds,
        verifiedAt: action.verifiedAt,
      },
    });
  }

  for (const waitState of input.waitStates ?? []) {
    if (waitState.companyId !== input.company.id) continue;
    items.push({
      ...context(waitState.taskId), departmentId: waitState.departmentId, keyResultId: waitState.keyResultId,
      id: `wait_state:${waitState.id}`, type: "wait_state", sourceId: waitState.id,
      occurredAt: waitState.createdAt, actionBearing: false,
      data: {
        reason: waitState.reason,
        status: waitState.status,
        nextCheckAt: waitState.nextCheckAt,
        affectedTaskIds: waitState.affectedTaskIds,
      },
    });
  }

  for (const issue of projectBlockedIssues({
    company: input.company,
    tasks,
    taskEvents,
    progressEvents,
    completions,
    businessArtifacts: [...businessArtifactsById.values()],
  })) {
    items.push(issue);
  }

  for (const rollup of input.ceoAttentionRollups ?? []) {
    if (rollup.companyId !== input.company.id || rollup.group.type !== "objective" || !rollup.reasons.includes("goal_stage_change")) {
      continue;
    }
    items.push({
      ...companyContext(input.company, rollup.id, rollup.title, rollup.createdAt),
      id: `stage_change:${rollup.id}`,
      type: "stage_change",
      objectiveId: rollup.group.objectiveId,
      data: {
        summary: localizedTextFromString(rollup.summary),
        recommendedNextAction: localizedTextFromString(rollup.recommendedNextAction),
        affectedTaskIds: rollup.affectedTaskIds,
      },
    });
  }

  for (const report of input.finalFounderReports ?? []) {
    if (report.companyId !== input.company.id) continue;
    items.push({
      ...companyContext(input.company, report.id, "Final Founder Report", report.createdAt),
      id: `final_report:${report.id}`,
      type: "final_report",
      data: {
        classification: report.classification,
        sections: report.sections,
        isCurrent: report.isCurrent,
        supersedesReportId: report.supersedesReportId,
      },
    });
  }

  return items.filter((item) => Number.isFinite(Date.parse(item.occurredAt))).sort((a, b) =>
    Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
    timelineOrder[a.type] - timelineOrder[b.type] ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function companyContext(company: Company, sourceId: string, title: string, occurredAt: string) {
  return {
    companyId: company.id,
    sourceId,
    taskId: null,
    departmentId: null,
    objectiveId: null,
    keyResultId: null,
    occurredAt,
    title,
    titleText: localizedTextFromString(title),
    actionBearing: false as const,
  };
}

/** CEO Pending is the live action subset of CEO Office Items, not a separate queue model. */
export function deriveCeoPendingItems(items: readonly CEOOfficeItem[]): CEOOfficeItem[] {
  return items.filter((item) => item.actionBearing);
}

function isPendingReviewArtifact(artifact: BusinessArtifact): boolean {
  return (
    artifact.isCurrent &&
    artifact.validationStatus === "valid" &&
    artifact.reviewStatus === "unreviewed" &&
    (artifact.artifactKind === "deliverable" || artifact.artifactKind === "final_report")
  );
}

const blockedTaskStatuses = new Set<TaskStatus>(["blocked", "needs_replan"]);
const blockedFailureReasons = new Set<AgentFailureReason>([
  "retry_exhausted",
  "missing_deliverable",
  "needs_replan",
]);

function projectBlockedIssues(input: {
  company: Company;
  tasks: readonly Task[];
  taskEvents: readonly TaskEvent[];
  progressEvents: readonly TaskProgressEvent[];
  completions: readonly TaskCompletionEvent[];
  businessArtifacts: readonly BusinessArtifact[];
}): CEOOfficeItem[] {
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const taskIssues = input.tasks.flatMap((task) => {
    if (!isBlockedIssueTask(task)) {
      return [];
    }
    const source = latestBlockedTaskSource(task, input.taskEvents, input.progressEvents, input.completions);
    if (!source) {
      return [];
    }
    return [{
      companyId: input.company.id,
      taskId: task.id,
      departmentId: task.departmentId,
      keyResultId: task.keyResultId,
      objectiveId: null,
      title: task.title,
      titleText: task.titleText ?? null,
      id: `blocked_issue:${source.sourceId}`,
      type: "blocked_issue" as const,
      sourceId: source.sourceId,
      occurredAt: source.occurredAt,
      actionBearing: true,
      data: {
        reason: source.reason ?? task.latestFailureMessage ?? task.dependencyNote ?? formatBlockedReason(task.latestFailureReason ?? task.status),
        status: "open" as const,
        affectedTaskIds: [task.id],
      },
    }];
  });

  const artifactIssues = input.businessArtifacts.flatMap((artifact) => {
    if (!artifact.isCurrent || artifact.artifactKind !== "blocker") {
      return [];
    }
    const task = tasksById.get(artifact.taskId);
    return [{
      companyId: input.company.id,
      taskId: artifact.taskId,
      departmentId: task?.departmentId ?? null,
      keyResultId: task?.keyResultId ?? null,
      objectiveId: null,
      title: task?.title ?? "Task",
      titleText: task?.titleText ?? null,
      id: `blocked_issue:${artifact.id}`,
      type: "blocked_issue" as const,
      sourceId: artifact.id,
      occurredAt: artifact.createdAt,
      actionBearing: true,
      data: {
        reason: readBlockerReason(artifact.payload) ?? "Blocker Report recorded.",
        status: "open" as const,
        affectedTaskIds: [artifact.taskId],
      },
    }];
  });

  return [...taskIssues, ...artifactIssues];
}

function isBlockedIssueTask(task: Task): boolean {
  return (
    blockedTaskStatuses.has(task.status) ||
    // No narrower persisted enum exists yet; a terminal failed task without a retryable reason is unrecoverable.
    (task.status === "failed" && !task.latestFailureReason) ||
    (task.latestFailureReason ? blockedFailureReasons.has(task.latestFailureReason) : false)
  );
}

function latestBlockedTaskSource(
  task: Task,
  taskEvents: readonly TaskEvent[],
  progressEvents: readonly TaskProgressEvent[],
  completions: readonly TaskCompletionEvent[],
): { sourceId: string; occurredAt: string; reason: string | null } | null {
  const candidates = [
    ...taskEvents
      .filter((event) => event.taskId === task.id)
      .filter((event) =>
        event.type === "task_failed" ||
        event.type === "task_blocked" ||
        event.type === "task_needs_replan" ||
        event.type === "deliverable_missing" ||
        blockedTaskStatuses.has(event.status ?? "queued") ||
        (event.status === "failed" && event.failureReason === null) ||
        (event.failureReason ? blockedFailureReasons.has(event.failureReason) : false))
      .map((event) => ({ sourceId: event.id, occurredAt: event.createdAt, reason: event.failureMessage ?? event.dependencyNote })),
    ...progressEvents
      .filter((event) => (event.subjectTaskId ?? event.parentTaskId) === task.id)
      .filter((event) => event.status === "blocked" || event.step === "blocked" || event.step === "needs_ceo_reassignment")
      .map((event) => ({ sourceId: event.id, occurredAt: event.createdAt, reason: event.detail })),
    ...completions
      .filter((event) => event.taskId === task.id)
      .filter((event) => event.outcome === "blocked" || event.outcome === "failed_to_review" || event.outcome === "needs_replan")
      .map((event) => ({ sourceId: event.id, occurredAt: event.createdAt, reason: event.outcomeSummaryText?.en ?? null })),
  ].filter((candidate) => Number.isFinite(Date.parse(candidate.occurredAt)));

  return candidates.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0))[0] ?? null;
}

function formatBlockedReason(reason: AgentFailureReason | TaskStatus): string {
  return reason.replace(/_/g, " ");
}

function readBlockerReason(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  for (const key of ["reason", "blocker", "summary", "message"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function latestAssessment(events: TaskProgressEvent[], before: string | null): TaskProgressEvent | null {
  const [event] = [...events]
    .filter((candidate) => candidate.step === "assessment_complete")
    .filter((candidate) => Number.isFinite(Date.parse(candidate.createdAt)))
    .filter((candidate) => before === null || Date.parse(candidate.createdAt) <= Date.parse(before))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return event ?? null;
}

function earliestTimestamp(timestamps: Array<string | null>): string | null {
  const [timestamp] = timestamps
    .filter((candidate): candidate is string => candidate !== null && Number.isFinite(Date.parse(candidate)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return timestamp ?? null;
}

function summarizeNextStep(item: NextStepItem): ExecutionReportNextStepSummary {
  return {
    type: item.type,
    label: item.label,
    ownerDepartmentId: item.ownerDepartmentId,
    relatedTaskId: item.relatedTaskId,
    relatedBusinessArtifactId: item.relatedBusinessArtifactId,
    severity: item.severity,
    priority: item.priority,
  };
}

function summarizeVisionGaps(gaps: unknown[]): ExecutionReportGapSummary[] {
  return gaps.flatMap((gap) => {
    if (!isRecord(gap) || typeof gap.label !== "string") {
      return [];
    }
    return [{
      label: gap.label,
      severity: typeof gap.severity === "string" ? gap.severity : null,
      relatedTaskId: typeof gap.relatedTaskId === "string" ? gap.relatedTaskId : null,
      relatedBusinessArtifactId: typeof gap.relatedBusinessArtifactId === "string" ? gap.relatedBusinessArtifactId : null,
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
