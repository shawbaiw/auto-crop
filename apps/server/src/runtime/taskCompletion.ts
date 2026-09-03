import { localizedTextFromString, localizedTextSchema, nextStepItemSeveritySchema, nextStepItemTypeSchema, type BusinessArtifact, type LocalizedText, type NextStepItem, type NextStepItemSeverity, type NextStepItemType, type Task, type TaskAcceptanceProvenance, type TaskCompletionEvent, type TaskCompletionOutcome } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { createDefaultId } from "./ids";

export function recordTaskCompletionEvent(input: {
  repositories: ReturnType<typeof createRepositories>;
  task: Task;
  outcome: TaskCompletionOutcome;
  acceptanceProvenance?: TaskAcceptanceProvenance | null;
  businessArtifact?: BusinessArtifact | null;
  /** Overrides the summary read from the Business Artifact payload (e.g. migration reconciliation passes null). */
  outcomeSummaryText?: LocalizedText | null;
  dependencyImpact?: unknown;
  nextStepItems?: unknown[];
  visionGaps?: unknown[];
  now?: () => Date;
  createId?: (prefix: string) => string;
}): TaskCompletionEvent {
  const proposal = input.nextStepItems ? { items: input.nextStepItems, errors: [] } : extractNextStepItems(input.businessArtifact?.payload);
  const proposedNextSteps = proposal.items;
  const validatedNextSteps = validateNextStepItems(proposedNextSteps);
  const outcomeSummaryText =
    input.outcomeSummaryText !== undefined
      ? input.outcomeSummaryText
      : extractOutcomeSummaryText(input.businessArtifact?.payload);
  const event: TaskCompletionEvent = {
    id: input.createId?.("task_completion_event") ?? createDefaultId("task_completion_event"),
    companyId: input.task.companyId,
    taskId: input.task.id,
    departmentId: input.task.departmentId,
    keyResultId: input.task.keyResultId,
    businessArtifactId: input.businessArtifact?.id ?? null,
    outcome: input.outcome,
    acceptanceProvenance: input.acceptanceProvenance ?? null,
    ...(outcomeSummaryText ? { outcomeSummaryText } : {}),
    dependencyImpact: mergeNextStepErrors(input.dependencyImpact ?? {}, [...proposal.errors, ...validatedNextSteps.errors]),
    nextStepItems: validatedNextSteps.items,
    visionGaps: input.visionGaps ?? [],
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
  };

  input.repositories.appendTaskCompletionEvent(event);
  return event;
}

/**
 * Read the Task Outcome Summary the completing agent wrote into the Business Artifact payload
 * (`outcome_summary` / `outcomeSummary`). Business Artifact parsing already rejects a `deliverable`
 * or `final_report` that omits it, so a missing value here means a non-deliverable outcome (blocker,
 * needs-replan) that carries no summary.
 */
export function extractOutcomeSummaryText(payload: unknown): LocalizedText | null {
  if (!isRecord(payload)) {
    return null;
  }
  const value = payload.outcome_summary ?? payload.outcomeSummary;
  if (typeof value === "string" && value.trim().length > 0) {
    return localizedTextFromString(value.trim());
  }
  if (isRecord(value)) {
    const parsed = localizedTextSchema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
  }
  return null;
}

function extractNextStepItems(payload: unknown): { items: unknown[]; errors: string[] } {
  if (!isRecord(payload)) {
    return { items: [], errors: [] };
  }

  const proposed = payload.nextStepItems ?? payload.next_step_items;
  if (proposed === undefined) {
    return { items: [], errors: [] };
  }
  if (!Array.isArray(proposed)) {
    return { items: [], errors: ["nextStepItems: Expected an array."] };
  }
  return { items: proposed, errors: [] };
}

function validateNextStepItems(items: unknown[]): { items: NextStepItem[]; errors: string[] } {
  const accepted: NextStepItem[] = [];
  const errors: string[] = [];

  items.forEach((item, index) => {
    const parsed = validateNextStepItem(item, index);
    if (parsed.kind === "valid") {
      accepted.push(parsed.item);
    } else {
      errors.push(...parsed.errors);
    }
  });

  return { items: accepted, errors };
}

function validateNextStepItem(item: unknown, index: number):
  | { kind: "valid"; item: NextStepItem }
  | { kind: "invalid"; errors: string[] } {
  if (!isRecord(item)) {
    return { kind: "invalid", errors: [`nextStepItems[${index}]: Expected an object.`] };
  }

  const errors: string[] = [];
  const type = item.type;
  const label = item.label;
  const severity = item.severity ?? null;
  const priority = item.priority ?? null;
  const evidenceRequirementsValue = item.evidenceRequirements ?? item.evidence_requirements ?? [];
  const hasDependencyImpact = "dependencyImpact" in item || "dependency_impact" in item;
  const ownerDepartmentId = optionalString(item.ownerDepartmentId ?? item.owner_department_id);
  const relatedTaskId = optionalString(item.relatedTaskId ?? item.related_task_id);
  const relatedBusinessArtifactId = optionalString(item.relatedBusinessArtifactId ?? item.related_business_artifact_id);

  if (!nextStepItemTypeSchema.safeParse(type).success) {
    errors.push(`nextStepItems[${index}].type: Expected a supported next step item type.`);
  }
  if (typeof label !== "string" || label.trim().length === 0) {
    errors.push(`nextStepItems[${index}].label: Expected a non-empty string.`);
  }
  if (severity !== null && !nextStepItemSeveritySchema.safeParse(severity).success) {
    errors.push(`nextStepItems[${index}].severity: Expected informational, blocking, or strategic.`);
  }
  if (priority !== null && typeof priority !== "number") {
    errors.push(`nextStepItems[${index}].priority: Expected a number.`);
  }
  if (!Array.isArray(evidenceRequirementsValue) || evidenceRequirementsValue.some((requirement) => typeof requirement !== "string" || requirement.trim().length === 0)) {
    errors.push(`nextStepItems[${index}].evidenceRequirements: Expected an array of non-empty strings.`);
  }
  if (ownerDepartmentId === null) {
    errors.push(`nextStepItems[${index}].ownerDepartmentId: Expected a non-empty string.`);
  }
  if (!hasDependencyImpact) {
    errors.push(`nextStepItems[${index}].dependencyImpact: Expected dependency impact.`);
  }
  if (relatedTaskId === null && relatedBusinessArtifactId === null) {
    errors.push(`nextStepItems[${index}].relatedTaskId: Expected a related task or artifact.`);
  }
  if (severity === null && priority === null) {
    errors.push(`nextStepItems[${index}].priority: Expected severity or priority.`);
  }
  if (type === "human_action" && Array.isArray(evidenceRequirementsValue) && evidenceRequirementsValue.length === 0) {
    errors.push(`nextStepItems[${index}].evidenceRequirements: Expected Human Action confirmation requirements.`);
  }

  if (errors.length > 0) {
    return { kind: "invalid", errors };
  }

  const evidenceRequirements = evidenceRequirementsValue as string[];

  return {
    kind: "valid",
    item: {
      type: type as NextStepItemType,
      label: (label as string).trim(),
      ownerDepartmentId,
      relatedTaskId,
      relatedBusinessArtifactId,
      dependencyImpact: item.dependencyImpact ?? item.dependency_impact ?? {},
      severity: severity as NextStepItemSeverity | null,
      priority: priority as number | null,
      evidenceRequirements: evidenceRequirements.map((requirement) => requirement.trim()),
    },
  };
}

function mergeNextStepErrors(dependencyImpact: unknown, errors: string[]): unknown {
  if (errors.length === 0) {
    return dependencyImpact;
  }

  return {
    ...(isRecord(dependencyImpact) ? dependencyImpact : { value: dependencyImpact }),
    nextStepValidationErrors: errors,
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
