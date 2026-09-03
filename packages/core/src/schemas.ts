import { z } from "zod";

export const nonEmptyString = z.string().trim().min(1);

export const localeSchema = z.enum(["en", "zh"]);

export const localizedTextSchema = z.object({
  en: nonEmptyString.optional(),
  zh: nonEmptyString.optional(),
}).refine((value) => Boolean(value.en || value.zh), {
  message: "Localized text must include at least one locale value.",
});

export const riskLevelSchema = z.enum(["low", "medium", "high"]);

export const taskStatusSchema = z.enum([
  "queued",
  "waiting_dependency",
  "running",
  "retrying",
  "blocked",
  "review",
  "complete",
  "needs_replan",
  "failed",
  "cancelled",
]);

export const taskKindSchema = z.enum(["parent", "department_subtask"]);
export const taskSourceSchema = z.enum(["ceo", "department", "user"]);

export const agentFailureReasonSchema = z.enum([
  "timeout",
  "agent_failed",
  "no_proof",
  "proof_capture_failed",
  "dependency_failed",
  "missing_deliverable",
  "retry_exhausted",
  "needs_replan",
  "rate_limited",
]);

export const taskEventTypeSchema = z.enum([
  "task_started",
  "task_review",
  "automatic_acceptance",
  "ceo_review_decision",
  "proof_recovered",
  "task_failed",
  "task_blocked",
  "task_warning",
  "partial_output",
  "dependency_waiting",
  "dependency_ready",
  "task_retrying",
  "task_recovered",
  "task_needs_replan",
  "deliverable_missing",
]);

export const taskProgressStepSchema = z.enum([
  "received",
  "assessing",
  "assessment_complete",
  "splitting",
  "split_complete",
  "no_split_needed",
  "executing",
  "summarizing_proof",
  "awaiting_review",
  "complete",
  "blocked",
  "needs_ceo_reassignment",
]);

export const taskProgressStatusSchema = z.enum(["complete", "current", "waiting", "blocked"]);
export const taskCompletionOutcomeSchema = z.enum([
  "accepted",
  "blocked",
  "failed_to_review",
  "needs_replan",
  "awaiting_founder_decision",
]);
export const nextStepItemTypeSchema = z.enum([
  "automatic_downstream_task",
  "human_action",
  "ceo_decision",
  "wait_state",
  "downstream_handoff",
  "vision_gap",
  "founder_decision",
]);
export const nextStepItemSeveritySchema = z.enum(["informational", "blocking", "strategic"]);

export const strategicDecisionKindSchema = z.enum([
  "target_market",
  "product_direction",
  "mvp_type",
  "pricing_model",
  "launch_target",
]);

export const ceoIntakeStatusSchema = z.enum([
  "received",
  "assessing",
  "assessment_complete",
  "planning",
  "planned",
  "dispatching",
  "dispatched",
  "failed",
]);

export const ceoReviewDecisionKindSchema = z.enum(["approve", "return"]);
export const ceoReviewReturnReasonSchema = z.enum([
  "needs_changes",
  "unclear_task_definition",
  "scope_too_large",
  "wrong_direction",
]);

export const proofTypeSchema = z.enum([
  "file",
  "diff",
  "url",
  "screenshot",
  "command_output",
  "test_result",
  "deployment",
]);

export const businessArtifactTypeSchema = z.enum([
  "research_findings",
  "product_mvp_brief",
  "implementation_summary",
  "validation_result",
  "preview_result",
  "launch_plan",
  "deployment_result",
  "final_founder_report",
  "blocker_report",
  "direction_change_request",
]);

export const businessArtifactKindSchema = z.enum([
  "deliverable",
  "blocker",
  "decision_request",
  "direction_change_request",
  "final_report",
]);

export const businessArtifactRoleSchema = z.enum([
  "findings",
  "plan",
  "spec",
  "implementation",
  "validation",
  "launch",
  "report",
  "none",
]);

export const businessArtifactValidationStatusSchema = z.enum([
  "pending",
  "valid",
  "invalid_schema",
  "invalid_blocker",
  "invalid_drift",
  "stale",
]);

export const businessArtifactReviewStatusSchema = z.enum([
  "unreviewed",
  "accepted",
  "returned",
  "not_reviewable",
]);

export const proofSchemaSchema = z.object({
  id: nonEmptyString,
  description: nonEmptyString,
  descriptionText: localizedTextSchema.optional(),
  acceptedTypes: z.array(proofTypeSchema).min(1),
});

export const taskKeySchema = nonEmptyString.regex(/^[a-z0-9][a-z0-9_-]*$/, {
  message: "Task keys must use lowercase letters, numbers, underscores, or hyphens.",
});

export const departmentBlueprintSchema = z.object({
  key: taskKeySchema.optional(),
  name: nonEmptyString,
  nameText: localizedTextSchema.optional(),
  responsibility: nonEmptyString,
  responsibilityText: localizedTextSchema.optional(),
  leadAgentId: nonEmptyString,
});

export const keyResultBlueprintSchema = z.object({
  title: nonEmptyString,
  titleText: localizedTextSchema.optional(),
  metricName: nonEmptyString,
  targetValue: nonEmptyString,
  targetValueText: localizedTextSchema.optional(),
  currentValue: nonEmptyString,
  currentValueText: localizedTextSchema.optional(),
});

export const objectiveBlueprintSchema = z.object({
  title: nonEmptyString,
  titleText: localizedTextSchema.optional(),
  priority: z.number().int().positive(),
  keyResults: z.array(keyResultBlueprintSchema).min(1),
});

export const taskSchema = z.object({
  key: taskKeySchema,
  departmentKey: taskKeySchema.optional(),
  departmentName: nonEmptyString,
  title: nonEmptyString,
  titleText: localizedTextSchema.optional(),
  description: nonEmptyString,
  descriptionText: localizedTextSchema.optional(),
  assigneeAgentId: nonEmptyString,
  requiredCapabilities: z.array(nonEmptyString).min(1),
  proofSchemaId: nonEmptyString,
  riskLevel: riskLevelSchema,
  dependsOnTaskKeys: z.array(taskKeySchema).default([]),
  handoffContract: nonEmptyString,
  handoffContractText: localizedTextSchema.optional(),
});

export const companyBlueprintSchema = z
  .object({
    company: z.object({
      name: nonEmptyString,
      founderVision: nonEmptyString,
      playbookId: nonEmptyString,
    }),
    departments: z.array(departmentBlueprintSchema).min(1),
    objectives: z.array(objectiveBlueprintSchema).min(1),
    proofSchemas: z.array(proofSchemaSchema).min(1),
    tasks: z.array(taskSchema).min(1),
  })
  .superRefine((blueprint, context) => {
    const departmentNames = new Set(blueprint.departments.map((department) => department.name));
    const departmentKeys = new Set(blueprint.departments.map((department) => department.key).filter((key): key is string => Boolean(key)));
    const proofSchemaIds = new Set(blueprint.proofSchemas.map((proofSchema) => proofSchema.id));
    const taskIndexesByKey = new Map<string, number>();

    blueprint.tasks.forEach((task, index) => {
      if (taskIndexesByKey.has(task.key)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "key"],
          message: `Duplicate task key: ${task.key}`,
        });
        return;
      }

      taskIndexesByKey.set(task.key, index);
    });

    blueprint.tasks.forEach((task, index) => {
      const referencesDepartment = task.departmentKey
        ? departmentKeys.has(task.departmentKey)
        : departmentNames.has(task.departmentName);

      if (!referencesDepartment) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, task.departmentKey ? "departmentKey" : "departmentName"],
          message: `Task references missing department: ${task.departmentKey ?? task.departmentName}`,
        });
      }

      if (!proofSchemaIds.has(task.proofSchemaId)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "proofSchemaId"],
          message: `Task references missing proof schema: ${task.proofSchemaId}`,
        });
      }

      task.dependsOnTaskKeys.forEach((dependencyKey, dependencyIndex) => {
        const upstreamIndex = taskIndexesByKey.get(dependencyKey);

        if (upstreamIndex === undefined) {
          context.addIssue({
            code: "custom",
            path: ["tasks", index, "dependsOnTaskKeys", dependencyIndex],
            message: `Task references missing dependency key: ${dependencyKey}`,
          });
          return;
        }

        if (upstreamIndex >= index) {
          context.addIssue({
            code: "custom",
            path: ["tasks", index, "dependsOnTaskKeys", dependencyIndex],
            message: `Task dependencies must reference earlier task keys: ${dependencyKey}`,
          });
        }
      });
    });
  });

export const ceoResponseSchema = z.object({
  brief: nonEmptyString,
  blueprint: companyBlueprintSchema,
});

export type RiskLevelInput = z.infer<typeof riskLevelSchema>;
export type ProofTypeInput = z.infer<typeof proofTypeSchema>;
export type TaskKeyInput = z.infer<typeof taskKeySchema>;
export type CompanyBlueprintInput = z.infer<typeof companyBlueprintSchema>;
export type CeoResponseInput = z.infer<typeof ceoResponseSchema>;

export function parseCeoResponse(output: string): CeoResponseInput {
  const jsonSource = extractFencedJson(output);

  if (!jsonSource) {
    throw new Error("CEO output must include strict JSON in a fenced json block.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonSource);
  } catch (error) {
    throw new Error(`CEO strict JSON is invalid: ${(error as Error).message}`);
  }

  return ceoResponseSchema.parse(parsed);
}

function extractFencedJson(output: string): string | null {
  const match = output.match(/```json\s*([\s\S]*?)\s*```/i);
  return match?.[1] ?? null;
}
