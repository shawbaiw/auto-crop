import { localizedTextFromString, localizedTextSchema, nextStepItemSeveritySchema, nextStepItemTypeSchema, type BusinessArtifact, type LocalizedText, type NextStepItem, type NextStepItemSeverity, type NextStepItemType, type Task, type TaskAcceptanceProvenance, type TaskCompletionEvent, type TaskCompletionOutcome } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { parseOpenDecisions, type FounderDecisionDeclaration } from "./founderDecision";
import { createDefaultId } from "./ids";

export function recordTaskCompletionEvent(input: {
  repositories: ReturnType<typeof createRepositories>;
  task: Task;
  outcome: TaskCompletionOutcome;
  acceptanceProvenance?: TaskAcceptanceProvenance | null;
  businessArtifact?: BusinessArtifact | null;
  /** Overrides the summary read from the Business Artifact payload (e.g. migration reconciliation passes null). */
  outcomeSummaryText?: LocalizedText | null;
  /**
   * The kept `open_decisions` declarations for this task. Pass to reuse an already-parsed result;
   * omitted, they are re-read from `businessArtifact.payload`. Each becomes a `founder_decision`
   * Next Step Item.
   */
  founderDecisions?: FounderDecisionDeclaration[];
  /**
   * Direct downstream consumer task ids blocked while a Founder Decision on this task is unresolved.
   * Recorded on each synthesized `founder_decision` Next Step Item so the projection can show which
   * work is waiting on the founder.
   */
  founderDecisionBlockedTaskIds?: string[];
  dependencyImpact?: unknown;
  nextStepItems?: unknown[];
  visionGaps?: unknown[];
  now?: () => Date;
  createId?: (prefix: string) => string;
}): TaskCompletionEvent {
  const proposal = input.nextStepItems ? { items: input.nextStepItems, errors: [] } : extractNextStepItems(input.businessArtifact?.payload);
  const founderDecisionItems = buildFounderDecisionItems(
    input.founderDecisions ?? parseOpenDecisions(input.businessArtifact?.payload).kept,
    input.businessArtifact,
    input.task,
    input.founderDecisionBlockedTaskIds ?? [],
  );
  const proposedNextSteps = [...proposal.items, ...founderDecisionItems];
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

/**
 * Turn each kept `open_decisions` declaration into a `founder_decision` Next Step Item on the Task
 * Completion Event. The decision detail (`decisionKind`, ordered options with trade-offs and a
 * recommended flag, `rationale`) and the blocked downstream task ids ride on the item's
 * `dependencyImpact.founderDecision`, which is where the `FounderDecision` projection reads them —
 * mirroring how `human_action` items carry their confirmation detail. Nesting them keeps the blocked
 * ids out of the generic dependency-impact scan, so a gated decision does not by itself raise a
 * cross-department CEO Attention rollup (that surface is wired to Founder Decisions separately).
 */
function buildFounderDecisionItems(
  declarations: FounderDecisionDeclaration[],
  businessArtifact: BusinessArtifact | null | undefined,
  task: Task,
  blockedTaskIds: string[],
): NextStepItem[] {
  if (!businessArtifact) {
    return [];
  }
  return declarations.map((declaration) => ({
    type: "founder_decision",
    label: `Founder decision: ${declaration.decisionKind.replace(/_/g, " ")}`,
    ownerDepartmentId: task.departmentId,
    relatedTaskId: task.id,
    relatedBusinessArtifactId: businessArtifact.id,
    dependencyImpact: {
      founderDecision: {
        decisionKind: declaration.decisionKind,
        options: declaration.options,
        rationale: declaration.rationale,
        blockedTaskIds,
      },
    },
    severity: "strategic",
    priority: null,
    evidenceRequirements: [],
  }));
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
