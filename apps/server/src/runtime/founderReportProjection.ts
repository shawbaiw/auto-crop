import type {
  BusinessArtifact,
  Company,
  Department,
  HumanAction,
  Task,
  TaskDependency,
  VisionGap,
  WaitState,
} from "@auto-crop/core";

/**
 * The subset of a Business Artifact the founder-report projection reads. Both a raw
 * {@link BusinessArtifact} and the API's summarized artifact shape satisfy it, so the projection is
 * the one factual data layer behind both the API's `founderReport` field and the Final Founder
 * Report deterministic fallback.
 */
export type FounderReportArtifactInput = Pick<
  BusinessArtifact,
  | "taskId"
  | "artifactKind"
  | "artifactRole"
  | "artifactSubtype"
  | "artifactType"
  | "taskType"
  | "payload"
  | "validationStatus"
  | "reviewStatus"
  | "isCurrent"
>;

export function groupTaskDependenciesByTaskId(
  dependencies: TaskDependency[],
): Map<string, TaskDependency[]> {
  const grouped = new Map<string, TaskDependency[]>();
  for (const dependency of dependencies) {
    grouped.set(dependency.taskId, [...(grouped.get(dependency.taskId) ?? []), dependency]);
  }
  return grouped;
}

export function formatWaitStateNextStep(waitState: WaitState): string {
  const label = waitState.label.replace(/[.!?]+$/, "");
  return waitState.status === "ready_for_check_in"
    ? `Check ${label}.`
    : `Monitor ${label} until ${waitState.nextCheckAt}.`;
}

/**
 * The founder-report data projection: the original vision, per-department contributions, dependency
 * state, open items, and derived next steps computed from Company State Snapshot data. Rendered as a
 * KPI panel on the operating dashboard (`founderReport` in the company-state response) and reused
 * verbatim as the factual layer of the Final Founder Report deterministic fallback.
 *
 * Its output shape and route behaviour are unchanged from when it lived in `routes.ts`.
 */
export function summarizeFounderReport(
  company: Company,
  tasks: Task[],
  artifacts: FounderReportArtifactInput[],
  waitStates: WaitState[],
  humanActions: HumanAction[],
  visionGaps: VisionGap[],
  taskDependencies: TaskDependency[],
  departments: Department[],
) {
  const acceptedArtifacts = artifacts.filter(
    (artifact) => artifact.reviewStatus === "accepted" && artifact.isCurrent,
  );
  const blockedTasks = tasks.filter(
    (task) => task.status === "blocked" || task.status === "needs_replan" || task.status === "failed",
  );
  const reviewTasks = tasks.filter((task) => task.status === "review");
  const driftArtifacts = artifacts.filter((artifact) => artifact.validationStatus === "invalid_drift");
  const dependenciesByTaskId = groupTaskDependenciesByTaskId(taskDependencies);
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  const acceptedArtifactsByTaskId = new Map(
    acceptedArtifacts.map((artifact) => [artifact.taskId, artifact]),
  );

  return {
    founderVision: company.founderVision,
    actualOutputs: acceptedArtifacts.map((artifact) => ({
      taskId: artifact.taskId,
      artifactKind: artifact.artifactKind,
      artifactRole: artifact.artifactRole,
      artifactSubtype: artifact.artifactSubtype,
      artifactType: artifact.artifactType,
      taskType: artifact.taskType,
      payload: artifact.payload,
    })),
    completedTaskCount: tasks.filter((task) => task.status === "complete").length,
    reviewTaskCount: reviewTasks.length,
    blockedTaskCount: blockedTasks.length,
    departmentContributions: departments.map((department) => {
      const departmentTasks = tasks.filter((task) => task.departmentId === department.id);
      const departmentTaskIds = new Set(departmentTasks.map((task) => task.id));
      return {
        departmentId: department.id,
        departmentName: department.name,
        completedTaskCount: departmentTasks.filter((task) => task.status === "complete").length,
        acceptedOutputCount: acceptedArtifacts.filter((artifact) =>
          departmentTaskIds.has(artifact.taskId),
        ).length,
        blockedTaskCount: departmentTasks.filter(
          (task) =>
            task.status === "blocked" || task.status === "needs_replan" || task.status === "failed",
        ).length,
        humanActionCount: humanActions.filter((action) => action.departmentId === department.id).length,
        waitStateCount: waitStates.filter((waitState) => waitState.departmentId === department.id).length,
        visionGapCount: visionGaps.filter((gap) => gap.departmentId === department.id).length,
      };
    }),
    dependencyState: tasks.map((task) => ({
      taskId: task.id,
      title: task.title,
      departmentId: task.departmentId,
      departmentName: departmentById.get(task.departmentId)?.name ?? task.departmentId,
      status: task.status,
      dependsOnTaskIds: (dependenciesByTaskId.get(task.id) ?? []).map(
        (dependency) => dependency.dependsOnTaskId,
      ),
      hasAcceptedOutput: acceptedArtifactsByTaskId.has(task.id),
      dependencyNote: task.dependencyNote,
    })),
    humanActionCount: humanActions.length,
    humanActions: humanActions.map((action) => ({
      id: action.id,
      label: action.label,
      status: action.status,
      departmentId: action.departmentId,
      blockedTaskIds: action.blockedTaskIds,
      confirmationRequirements: action.confirmationRequirements,
    })),
    waitStateCount: waitStates.length,
    waitStates: waitStates.map((waitState) => ({
      id: waitState.id,
      label: waitState.label,
      status: waitState.status,
      nextCheckAt: waitState.nextCheckAt,
      affectedTaskIds: waitState.affectedTaskIds,
    })),
    visionGapCount: visionGaps.length,
    visionGaps: visionGaps.map((gap) => ({
      id: gap.id,
      label: gap.label,
      severity: gap.severity,
      departmentId: gap.departmentId,
      relatedTaskId: gap.relatedTaskId,
    })),
    directionDriftDetected: driftArtifacts.length > 0,
    nextSteps: [
      ...reviewTasks.map((task) => `Review ${task.title}.`),
      ...humanActions
        .filter((action) => action.status === "pending")
        .map((action) => `Complete Human Action: ${action.label}`),
      ...visionGaps
        .filter((gap) => gap.severity === "blocking" || gap.severity === "strategic")
        .map((gap) => `Resolve Vision Gap: ${gap.label}`),
      ...blockedTasks.map(
        (task) => task.dependencyNote ?? task.latestFailureMessage ?? `Resolve ${task.title}.`,
      ),
      ...waitStates.map(formatWaitStateNextStep),
    ],
  };
}

export type FounderReportProjection = ReturnType<typeof summarizeFounderReport>;
