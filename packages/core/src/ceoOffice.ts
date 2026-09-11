import { localizedTextFromString, type Locale, type LocalizedText } from "./localizedText";
import type {
  CompanyEvent, CompanyPlanSnapshot, AgentFailureReason, BusinessArtifact, CeoAttentionRollup, CeoReviewDecision, Company, FinalFounderReport,
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
  | OfficeItem<"plan_brief", {
      taskCount: number;
      tasks: PlanBriefTaskSummary[];
    }, false>
  | OfficeItem<"task_brief", {
      purpose: LocalizedText;
      purposeSource: "department_assessment" | "task_definition" | "execution_plan" | "unavailable";
      approach?: LocalizedText | null;
      expectedOutcome?: LocalizedText | null;
      founderVision: string;
      objectiveTitle: LocalizedText | null;
      keyResultTitle: LocalizedText | null;
      keyResultMetricName: string | null;
      keyResultTargetValue: LocalizedText | null;
      dependsOnTaskIds: string[];
    }, false>
  | OfficeItem<"execution_report", {
      workSummary?: LocalizedText | null;
      evidence?: LocalizedText | null;
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
      "status" | "confirmationRequirements" | "blockedTaskIds" | "verifiedAt"> & {
      /** Agent-authored in the company locale (ADR 0013); rendered through the dashboard's localization path. */
      label: LocalizedText;
    }>
  | OfficeItem<"wait_state", Pick<WaitState,
      "status" | "nextCheckAt" | "affectedTaskIds"> & {
      /** Agent-authored in the company locale (ADR 0013); rendered through the dashboard's localization path. */
      reason: LocalizedText;
    }>
  | OfficeItem<"blocked_issue", {
      /** Agent/runtime string wrapped in the company locale, or a bilingual deterministic fallback. */
      reason: LocalizedText;
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

type PlanBriefTaskSummary = CompanyPlanSnapshot["tasks"][number];

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
  companyEvents?: readonly CompanyEvent[];
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
  plan_brief: -1, task_brief: 0, execution_report: 1, decision_request: 2, approval_request: 3,
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

  const plans = (input.companyEvents ?? []).filter(event => event.companyId === input.company.id && event.planSnapshot);
  for (const event of plans) {
    items.push({
      ...companyContext(input.company, event.id, "Company plan", event.createdAt),
      id: `plan_brief:${event.id}`, type: "plan_brief",
      data: { taskCount: event.planSnapshot!.tasks.length, tasks: event.planSnapshot!.tasks },
    });
  }
  // Legacy companies have no plan snapshot. This is explicitly a compatibility view, never
  // used for newly created companies whose original decomposition is a durable company event.
  const foundingTasks = tasks.filter(task => task.source === "ceo");
  if (plans.length === 0 && foundingTasks.length > 0) {
    items.push({
      ...companyContext(input.company, input.company.id, "Company plan", input.company.createdAt),
      id: `plan_brief:${input.company.id}`, type: "plan_brief",
      data: { taskCount: foundingTasks.length, tasks: [...foundingTasks].sort((a, b) => a.position - b.position).map(task => ({
        taskId: task.id, title: task.titleText ?? localizedTextFromString(task.title),
        purpose: task.descriptionText ?? localizedTextFromString(task.description), departmentId: task.departmentId,
        dependsOnTaskIds: (input.taskDependencies ?? []).filter(dep => dep.taskId === task.id).map(dep => dep.dependsOnTaskId),
      })) },
    });
  }

  // Progress markers are also emitted for queueing and dependency bookkeeping. Only a durable
  // task_started fact can announce execution. A completion is never a fabricated pre-work brief.
  const starts = taskEvents.filter(event => event.type === "task_started")
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id));
  const announced = new Set<string>();
  for (const event of starts) {
    const task = tasksById.get(event.taskId);
    if (!task) continue;
    const brief = event.executionBrief;
    const first = !announced.has(task.id);
    announced.add(task.id);
    items.push({
      ...context(task.id),
      title: brief?.title[input.company.locale] ?? task.title,
      titleText: brief?.title ?? null,
      id: first ? `task_brief:${task.id}` : `task_brief:${task.id}:${event.id}`,
      type: "task_brief", sourceId: event.id, occurredAt: event.createdAt, actionBearing: false,
      data: {
        purpose: brief?.purpose ?? { en: "The execution plan was not recorded for this earlier run.", zh: "此次历史执行未记录事前执行方案。" },
        purposeSource: brief ? "execution_plan" : "unavailable",
        approach: brief?.approach ?? null, expectedOutcome: brief?.expectedOutcome ?? null,
        founderVision: input.company.founderVision,
        objectiveTitle: null, keyResultTitle: null, keyResultMetricName: null, keyResultTargetValue: null,
        dependsOnTaskIds: [],
      },
    });
  }

  for (const event of completions) {
    // Non-accepted completions are surfaced by their exception card, not a report; the row stays a
    // durable fact. This also collapses the two completions a founder-decision task leaves behind.
    if (event.outcome !== "accepted") continue;
    const executionReport = event.executionReport ?? null;
    // A Report broadcasts a founder-facing conclusion. With neither a structured Execution Report
    // nor an outcome summary there is nothing to broadcast — the completion stays a durable fact but
    // not a timeline card. Completions authored before the Execution Report contract land here, as
    // would any future accepted outcome that carries no narrative.
    if (!executionReport && !hasLocalizedText(event.outcomeSummaryText)) continue;
    const businessArtifact = event.businessArtifactId ? businessArtifactsById.get(event.businessArtifactId) ?? null : null;
    const associatedBusinessArtifact = businessArtifact?.taskId === event.taskId ? businessArtifact : null;
    items.push({
      ...context(event.taskId), departmentId: event.departmentId,
      id: `execution_report:${event.id}`, type: "execution_report", sourceId: event.id,
      occurredAt: event.createdAt, actionBearing: false,
      data: {
        workSummary: executionReport?.workSummary ?? null,
        evidence: executionReport?.evidence ?? null,
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
        label: companyLocaleText(action.label, input.company.locale),
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
        reason: companyLocaleText(waitState.reason, input.company.locale),
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
    taskDependencies: input.taskDependencies ?? [],
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
  taskDependencies: readonly TaskDependency[];
}): CEOOfficeItem[] {
  const locale = input.company.locale;
  const tasksById = new Map(input.tasks.map(task => [task.id, task]));
  type Episode = { id: string; taskId: string; occurredAt: string; reason: string | LocalizedText | null; resolved: boolean; resolvedAt?: string; order?: number; resolvedOrder?: number; cause?: string };
  const episodes: Episode[] = [];
  const causalTargets = new Set(input.taskEvents.map(event => event.blockedByTaskId).filter(Boolean));
  for (const completion of input.completions) {
    if (isRecord(completion.dependencyImpact) && typeof completion.dependencyImpact.blockedByTaskId === "string") causalTargets.add(completion.dependencyImpact.blockedByTaskId);
  }
  const ordered = [...input.taskEvents].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id));
  for (const event of ordered) {
    if (!tasksById.has(event.taskId)) continue;
    const order = event.sequence;
    const blocked = event.type === "task_blocked" || event.type === "task_needs_replan" || event.type === "deliverable_missing" ||
      (event.type === "task_failed" && (!event.failureReason || blockedFailureReasons.has(event.failureReason) || causalTargets.has(event.taskId)));
    if (blocked) {
      // Old scheduler completion facts sometimes already recorded the explicit dependency cause.
      const completion = input.completions.find(item => item.taskId === event.taskId &&
        item.createdAt === event.createdAt && isRecord(item.dependencyImpact) && typeof item.dependencyImpact.blockedByTaskId === "string");
      const cause = event.blockedByTaskId ?? (completion && isRecord(completion.dependencyImpact) ? completion.dependencyImpact.blockedByTaskId as string : undefined);
      const previous = episodes.find(item => item.taskId === event.taskId && item.cause === cause && !item.resolved);
      if (previous && previous.cause === cause) {
        previous.reason = event.failureMessage ?? event.dependencyNote ?? previous.reason;
      } else {
        const episode = { id: event.id, taskId: event.taskId, occurredAt: event.createdAt,
          reason: event.failureMessage ?? event.dependencyNote, resolved: false, order, cause };
        episodes.push(episode);
      }
    } else if ((event.type === "task_replanned" || (event.type !== "task_warning" && event.status && ["queued", "running", "review", "complete", "retrying", "waiting_dependency"].includes(event.status)))) {
      for (const episode of episodes.filter(item => item.taskId === event.taskId && !item.resolved)) { episode.resolved = true; episode.resolvedAt = event.createdAt; episode.resolvedOrder = order; }
    }
  }
  for (const task of input.tasks) {
    const ownEpisodes = episodes.filter(item => item.taskId === task.id);
    if (!isBlockedIssueTask(task) && !(task.status === "failed" && causalTargets.has(task.id))) {
      for (const episode of ownEpisodes) episode.resolved = true;
    }
    const replannedAt = ordered.filter(event => event.taskId === task.id && event.type === "task_replanned").at(-1)?.createdAt;
    // Support pre-event snapshots without guessing causality from graph topology or prose.
    if (ownEpisodes.length === 0 && isBlockedIssueTask(task)) {
      const source = latestBlockedTaskSource(task, [], input.progressEvents, input.completions);
      if (source) episodes.push({ id: source.sourceId, taskId: task.id, occurredAt: source.occurredAt, reason: source.reason, resolved: Boolean(replannedAt && Date.parse(replannedAt) >= Date.parse(source.occurredAt)) });
    }
  }
  for (const artifact of input.businessArtifacts) {
    if (artifact.artifactKind !== "blocker") continue;
    const matching = episodes.find(item => item.taskId === artifact.taskId &&
      (!item.resolved || Date.parse(item.occurredAt) >= Date.parse(artifact.createdAt)));
    if (matching) continue; // task state and artifact describe the same blocking episode
    const task = tasksById.get(artifact.taskId);
    episodes.push({ id: artifact.id, taskId: artifact.taskId, occurredAt: artifact.createdAt,
      reason: readBlockerReason(artifact.payload), resolved: !artifact.isCurrent || !task || !isBlockedIssueTask(task) });
  }
  const affected = new Map<Episode, Set<string>>();
  function roots(episode: Episode, visited = new Set<string>()): Episode[] {
    if (!episode.cause || visited.has(episode.taskId)) return [episode];
    const nextVisited = new Set([...visited, episode.taskId]);
    const upstream = episodes.filter(item => item.taskId === episode.cause &&
      (Date.parse(item.occurredAt) < Date.parse(episode.occurredAt) ||
        (Date.parse(item.occurredAt) === Date.parse(episode.occurredAt) && (item.order ?? 0) <= (episode.order ?? Infinity))) &&
      (!item.resolvedAt || Date.parse(item.resolvedAt) > Date.parse(episode.occurredAt) ||
        (Date.parse(item.resolvedAt) === Date.parse(episode.occurredAt) && (item.resolvedOrder ?? Infinity) > (episode.order ?? 0))));
    return upstream.length ? [...new Set(upstream.flatMap(item => roots(item, nextVisited)))] : [episode];
  }
  for (const episode of episodes) {
    for (const owner of roots(episode)) {
      if (!affected.has(owner)) affected.set(owner, new Set([owner.taskId]));
      affected.get(owner)!.add(episode.taskId);
    }
  }
  return [...affected].map(([episode, ids]) => {
    const task = tasksById.get(episode.taskId);
    return {
      companyId: input.company.id, taskId: episode.taskId, departmentId: task?.departmentId ?? null,
      keyResultId: task?.keyResultId ?? null, objectiveId: null, title: task?.title ?? "Task", titleText: task?.titleText ?? null,
      id: `blocked_issue:${episode.id}`, type: "blocked_issue", sourceId: episode.id,
      occurredAt: episode.occurredAt, actionBearing: !episode.resolved,
      data: { reason: blockedIssueReason(episode.reason, task?.latestFailureReason ?? "blocked", locale),
        status: episode.resolved ? "resolved" : "open", affectedTaskIds: [...ids].sort() },
    };
  });
}

function isBlockedIssueTask(task: Task): boolean {
  if (["queued", "running", "review", "complete", "retrying", "waiting_dependency"].includes(task.status)) return false;
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
): { sourceId: string; occurredAt: string; reason: string | LocalizedText | null } | null {
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
      // The outcome summary is an agent-authored LocalizedText — pass it through untouched so the
      // dashboard shows its "untranslated" marker if the company locale is the one the agent skipped.
      .map((event) => ({ sourceId: event.id, occurredAt: event.createdAt, reason: event.outcomeSummaryText ?? null })),
  ].filter((candidate) => Number.isFinite(Date.parse(candidate.occurredAt)));

  return candidates.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0))[0] ?? null;
}

/**
 * Wrap an agent- or runtime-authored founder-facing string as a single-locale {@link LocalizedText}.
 * The string is authored in the company's canonical locale (ADR 0013 → single canonical locale), so
 * it belongs under that key; the dashboard renders it through its localization path and shows an
 * "untranslated" marker only if the key is absent. Old rows authored before the single-locale
 * contract render as-is under this key (the accepted migration fallback).
 */
function companyLocaleText(value: string, locale: Locale): LocalizedText {
  return { [locale]: value };
}

/** True when a localized field carries a non-empty value in at least one locale. */
function hasLocalizedText(text: LocalizedText | null | undefined): boolean {
  return text != null && Object.values(text).some((value) => typeof value === "string" && value.trim().length > 0);
}

/**
 * Deterministic, code-derived blocked-issue reasons — bilingual so they read in either locale.
 * The dashboard keeps a matching table for enum-class values (`TIMELINE_STATUS_KEY` /
 * `TIMELINE_OUTCOME_KEY` in `apps/dashboard/src/pages/DepartmentWorkspace.tsx`); core cannot import
 * the dashboard's translation table, so a reword touches both places.
 */
const BLOCKED_REASON_TEXT: Record<string, LocalizedText> = {
  retry_exhausted: { en: "Retries exhausted", zh: "重试次数已用尽" },
  missing_deliverable: { en: "Expected deliverable was not recorded", zh: "未记录预期交付物" },
  needs_replan: { en: "Needs replanning", zh: "需要重新规划" },
  blocked: { en: "Blocked", zh: "受阻" },
  failed: { en: "The task failed", zh: "任务失败" },
  blocker_report_recorded: { en: "Blocker Report recorded.", zh: "已记录阻塞报告。" },
};

/**
 * The blocked-issue reason. An already-authored `LocalizedText` (the outcome summary) passes through
 * untouched; a bare agent/runtime string is wrapped in the company locale (raw-string migration
 * fallback, per the issue); otherwise a bilingual deterministic fallback keyed off the failure
 * reason or task status.
 */
function blockedIssueReason(
  reason: string | LocalizedText | null,
  code: AgentFailureReason | TaskStatus | "blocker_report_recorded",
  locale: Locale,
): LocalizedText {
  if (reason && typeof reason === "object") {
    return reason;
  }
  if (typeof reason === "string" && reason.trim().length > 0) {
    return companyLocaleText(reason, locale);
  }
  return BLOCKED_REASON_TEXT[code] ?? { en: code.replace(/_/g, " "), zh: code.replace(/_/g, " ") };
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
