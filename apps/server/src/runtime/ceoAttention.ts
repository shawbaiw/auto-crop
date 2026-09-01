import type {
  CeoAttentionRollup,
  CeoAttentionRollupGroup,
  CeoAttentionRollupReason,
  Company,
  KeyResult,
  NextStepItem,
  NextStepItemSeverity,
  Task,
  TaskCompletionEvent,
  TaskDependency,
  VisionGap,
} from "@auto-crop/core";

type AttentionCandidate = {
  event: TaskCompletionEvent;
  group: CeoAttentionRollupGroup;
  title: string;
  ownerDepartmentId: string;
  downstreamDepartmentIds: string[];
  affectedTaskIds: string[];
  currentBlocker: string | null;
  recommendedNextAction: string;
  severity: NextStepItemSeverity;
  reasons: CeoAttentionRollupReason[];
  relevantHumanActions: NextStepItem[];
  relevantWaitStates: NextStepItem[];
  relevantVisionGaps: VisionGap[];
};

export function projectCeoAttention(input: {
  company: Company;
  keyResults: KeyResult[];
  tasks: Task[];
  taskCompletionEvents: TaskCompletionEvent[];
  taskDependencies: TaskDependency[];
}): { visionGaps: VisionGap[]; ceoAttentionRollups: CeoAttentionRollup[] } {
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const keyResultsById = new Map(input.keyResults.map((keyResult) => [keyResult.id, keyResult]));
  const downstreamTaskIdsByTaskId = mapDownstreamTaskIds(input.taskDependencies);
  const visionGaps = input.taskCompletionEvents.flatMap(collectVisionGaps);
  const candidates = input.taskCompletionEvents.flatMap((event) =>
    createAttentionCandidates({
      company: input.company,
      event,
      eventVisionGaps: visionGaps.filter((gap) => gap.sourceTaskCompletionEventId === event.id),
      task: tasksById.get(event.taskId),
      keyResult: event.keyResultId ? keyResultsById.get(event.keyResultId) : undefined,
      tasksById,
      downstreamTaskIds: downstreamTaskIdsByTaskId.get(event.taskId) ?? [],
    }),
  );

  return {
    visionGaps,
    ceoAttentionRollups: rollUpAttentionCandidates(input.company, candidates),
  };
}

function createAttentionCandidates(input: {
  company: Company;
  event: TaskCompletionEvent;
  eventVisionGaps: VisionGap[];
  task?: Task;
  keyResult?: KeyResult;
  tasksById: Map<string, Task>;
  downstreamTaskIds: string[];
}): AttentionCandidate[] {
  const attentionVisionGaps = input.eventVisionGaps.filter((gap) => gap.severity === "blocking" || gap.severity === "strategic");
  const decisionItems = input.event.nextStepItems.filter((item) => item.type === "ceo_decision");
  const humanActions = input.event.nextStepItems.filter((item) => item.type === "human_action");
  const waitStates = input.event.nextStepItems.filter((item) => item.type === "wait_state");
  const itemImpactedTaskIds = input.event.nextStepItems.flatMap((item) => extractImpactedTaskIds(item.dependencyImpact));
  const dependencyTaskIds = unique([
    ...input.downstreamTaskIds,
    ...extractImpactedTaskIds(input.event.dependencyImpact),
    ...itemImpactedTaskIds,
    ...input.event.nextStepItems.map((item) => item.relatedTaskId).filter((taskId): taskId is string => Boolean(taskId)),
  ]);
  const downstreamDepartmentIds = unique(
    dependencyTaskIds
      .map((taskId) => input.tasksById.get(taskId)?.departmentId)
      .filter((departmentId): departmentId is string => Boolean(departmentId) && departmentId !== input.event.departmentId),
  );
  const reasons: CeoAttentionRollupReason[] = [];

  if (attentionVisionGaps.length > 0) {
    reasons.push("vision_gap");
  }
  if (decisionItems.length > 0) {
    reasons.push("ceo_decision");
  }
  if (humanActions.length > 0) {
    reasons.push("human_action");
  }
  if (waitStates.length > 0) {
    reasons.push("wait_state");
  }
  if (downstreamDepartmentIds.length > 0) {
    reasons.push("cross_department_impact");
  }
  if (input.event.outcome !== "accepted") {
    reasons.push("exception_outcome");
  }

  if (reasons.length === 0) {
    return [];
  }

  const primaryItem = attentionVisionGaps[0] ?? humanActions[0] ?? waitStates[0] ?? decisionItems[0] ?? null;
  return [
    {
      event: input.event,
      group: chooseRollupGroup({
        company: input.company,
        event: input.event,
        keyResult: input.keyResult,
        hasCrossDepartmentImpact: downstreamDepartmentIds.length > 0,
      }),
      title: primaryItem?.label ?? `${input.task?.title ?? "Task"} needs executive attention.`,
      ownerDepartmentId: input.event.departmentId,
      downstreamDepartmentIds,
      affectedTaskIds: unique([input.event.taskId, ...dependencyTaskIds]),
      currentBlocker: attentionVisionGaps.find((gap) => gap.severity === "blocking")?.label ?? null,
      recommendedNextAction: primaryItem?.label ?? recommendedActionForOutcome(input.event, input.task),
      severity: highestSeverity([
        ...attentionVisionGaps.map((gap) => gap.severity),
        ...humanActions.map((item) => item.severity),
        ...waitStates.map((item) => item.severity),
        ...decisionItems.map((item) => item.severity),
      ]),
      reasons: unique(reasons),
      relevantHumanActions: humanActions,
      relevantWaitStates: waitStates,
      relevantVisionGaps: attentionVisionGaps,
    },
  ];
}

function rollUpAttentionCandidates(company: Company, candidates: AttentionCandidate[]): CeoAttentionRollup[] {
  const grouped = new Map<string, AttentionCandidate[]>();
  for (const candidate of candidates) {
    const key = groupKey(candidate.group);
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }

  return [...grouped.entries()].map(([key, groupCandidates]) => {
    const first = groupCandidates[0]!;
    const latest = groupCandidates[groupCandidates.length - 1]!;
    const reasons = unique(groupCandidates.flatMap((candidate) => candidate.reasons));
    const relevantVisionGaps = uniqueById(groupCandidates.flatMap((candidate) => candidate.relevantVisionGaps));

    return {
      id: `ceo_attention_rollup_${key}`,
      companyId: company.id,
      group: first.group,
      title: latest.title,
      summary: summarizeRollup(groupCandidates, reasons),
      ownerDepartmentId: first.ownerDepartmentId,
      downstreamDepartmentIds: unique(groupCandidates.flatMap((candidate) => candidate.downstreamDepartmentIds)),
      affectedTaskIds: unique(groupCandidates.flatMap((candidate) => candidate.affectedTaskIds)),
      currentBlocker: groupCandidates.find((candidate) => candidate.currentBlocker)?.currentBlocker ?? null,
      recommendedNextAction: latest.recommendedNextAction,
      severity: highestSeverity(groupCandidates.map((candidate) => candidate.severity)),
      reasons,
      relevantHumanActions: groupCandidates.flatMap((candidate) => candidate.relevantHumanActions),
      relevantWaitStates: groupCandidates.flatMap((candidate) => candidate.relevantWaitStates),
      relevantVisionGaps,
      sourceTaskCompletionEventIds: unique(groupCandidates.map((candidate) => candidate.event.id)),
      createdAt: first.event.createdAt,
    };
  });
}

function collectVisionGaps(event: TaskCompletionEvent): VisionGap[] {
  const fromNextSteps = event.nextStepItems
    .filter((item) => item.type === "vision_gap")
    .map((item, index) => visionGapFromNextStepItem(event, item, index));
  const fromEventPayload = event.visionGaps.flatMap((gap, index) => visionGapFromPayload(event, gap, index));
  return [...fromNextSteps, ...fromEventPayload];
}

function visionGapFromNextStepItem(event: TaskCompletionEvent, item: NextStepItem, index: number): VisionGap {
  return {
    id: `${event.id}_vision_gap_${index + 1}`,
    companyId: event.companyId,
    sourceTaskCompletionEventId: event.id,
    taskId: event.taskId,
    departmentId: item.ownerDepartmentId ?? event.departmentId,
    keyResultId: event.keyResultId,
    businessArtifactId: item.relatedBusinessArtifactId ?? event.businessArtifactId,
    label: item.label,
    severity: item.severity ?? "informational",
    relatedTaskId: item.relatedTaskId,
    relatedBusinessArtifactId: item.relatedBusinessArtifactId,
    createdAt: event.createdAt,
  };
}

function visionGapFromPayload(event: TaskCompletionEvent, gap: unknown, index: number): VisionGap[] {
  if (typeof gap === "string" && gap.trim().length > 0) {
    return [
      {
        id: `${event.id}_vision_gap_payload_${index + 1}`,
        companyId: event.companyId,
        sourceTaskCompletionEventId: event.id,
        taskId: event.taskId,
        departmentId: event.departmentId,
        keyResultId: event.keyResultId,
        businessArtifactId: event.businessArtifactId,
        label: gap.trim(),
        severity: "informational",
        relatedTaskId: event.taskId,
        relatedBusinessArtifactId: event.businessArtifactId,
        createdAt: event.createdAt,
      },
    ];
  }

  if (!isRecord(gap)) {
    return [];
  }

  const label = optionalString(gap.label ?? gap.summary ?? gap.title);
  if (!label) {
    return [];
  }

  return [
    {
      id: optionalString(gap.id) ?? `${event.id}_vision_gap_payload_${index + 1}`,
      companyId: event.companyId,
      sourceTaskCompletionEventId: event.id,
      taskId: event.taskId,
      departmentId: optionalString(gap.departmentId ?? gap.department_id) ?? event.departmentId,
      keyResultId: event.keyResultId,
      businessArtifactId: optionalString(gap.businessArtifactId ?? gap.business_artifact_id) ?? event.businessArtifactId,
      label,
      severity: parseSeverity(gap.severity),
      relatedTaskId: optionalString(gap.relatedTaskId ?? gap.related_task_id) ?? event.taskId,
      relatedBusinessArtifactId: optionalString(gap.relatedBusinessArtifactId ?? gap.related_business_artifact_id) ?? event.businessArtifactId,
      createdAt: event.createdAt,
    },
  ];
}

function chooseRollupGroup(input: {
  company: Company;
  event: TaskCompletionEvent;
  keyResult?: KeyResult;
  hasCrossDepartmentImpact: boolean;
}): CeoAttentionRollupGroup {
  if (input.hasCrossDepartmentImpact) {
    return { type: "dependency_chain", taskId: input.event.taskId };
  }
  if (input.keyResult) {
    return { type: "objective", objectiveId: input.keyResult.objectiveId };
  }
  return { type: "founder_vision", companyId: input.company.id };
}

function summarizeRollup(candidates: AttentionCandidate[], reasons: CeoAttentionRollupReason[]): string {
  const affectedTaskCount = unique(candidates.flatMap((candidate) => candidate.affectedTaskIds)).length;
  const downstreamDepartmentCount = unique(candidates.flatMap((candidate) => candidate.downstreamDepartmentIds)).length;
  const downstream = downstreamDepartmentCount > 0 ? ` ${downstreamDepartmentCount} downstream department(s) affected.` : "";
  return `${candidates.length} attention event(s) produced ${reasons.join(", ")} across ${affectedTaskCount} task(s).${downstream}`;
}

function recommendedActionForOutcome(event: TaskCompletionEvent, task?: Task): string {
  if (event.outcome === "needs_replan") {
    return `Review the replan path for ${task?.title ?? event.taskId}.`;
  }
  if (event.outcome === "blocked" || event.outcome === "failed_to_review") {
    return `Resolve the blocker for ${task?.title ?? event.taskId}.`;
  }
  return `Inspect ${task?.title ?? event.taskId}.`;
}

function highestSeverity(values: Array<NextStepItemSeverity | null>): NextStepItemSeverity {
  if (values.includes("strategic")) {
    return "strategic";
  }
  if (values.includes("blocking")) {
    return "blocking";
  }
  return "informational";
}

function mapDownstreamTaskIds(dependencies: TaskDependency[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const existing = map.get(dependency.dependsOnTaskId) ?? [];
    existing.push(dependency.taskId);
    map.set(dependency.dependsOnTaskId, existing);
  }
  return map;
}

function extractImpactedTaskIds(dependencyImpact: unknown): string[] {
  if (!isRecord(dependencyImpact)) {
    return [];
  }

  return unique([
    ...extractStringArray(dependencyImpact.blockedTaskIds),
    ...extractStringArray(dependencyImpact.downstreamTaskIds),
    ...extractStringArray(dependencyImpact.taskIds),
    ...extractStringArray(dependencyImpact.blocks),
    ...extractStringArray(dependencyImpact.affects),
    ...extractTaskIdsFromUpdateArray(dependencyImpact.updatedTasks),
  ]);
}

function extractStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function extractTaskIdsFromUpdateArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (isRecord(item) ? optionalString(item.taskId ?? item.id) : null))
    .filter((taskId): taskId is string => Boolean(taskId));
}

function parseSeverity(value: unknown): NextStepItemSeverity {
  return value === "blocking" || value === "strategic" || value === "informational" ? value : "informational";
}

function groupKey(group: CeoAttentionRollupGroup): string {
  if (group.type === "dependency_chain") {
    return `dependency_chain:${group.taskId}`;
  }
  if (group.type === "objective") {
    return `objective:${group.objectiveId}`;
  }
  return `founder_vision:${group.companyId}`;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
