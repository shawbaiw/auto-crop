import { z } from "zod";

export const nonEmptyString = z.string().trim().min(1);

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
  "task_failed",
  "task_blocked",
  "task_warning",
  "partial_output",
  "dependency_waiting",
  "dependency_ready",
  "task_retrying",
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

export const proofTypeSchema = z.enum([
  "file",
  "diff",
  "url",
  "screenshot",
  "command_output",
  "test_result",
  "deployment",
]);

export const proofSchemaSchema = z.object({
  id: nonEmptyString,
  description: nonEmptyString,
  acceptedTypes: z.array(proofTypeSchema).min(1),
});

export const taskKeySchema = nonEmptyString.regex(/^[a-z0-9][a-z0-9_-]*$/, {
  message: "Task keys must use lowercase letters, numbers, underscores, or hyphens.",
});

export const departmentBlueprintSchema = z.object({
  name: nonEmptyString,
  responsibility: nonEmptyString,
  leadAgentId: nonEmptyString,
});

export const keyResultBlueprintSchema = z.object({
  title: nonEmptyString,
  metricName: nonEmptyString,
  targetValue: nonEmptyString,
  currentValue: nonEmptyString,
});

export const objectiveBlueprintSchema = z.object({
  title: nonEmptyString,
  priority: z.number().int().positive(),
  keyResults: z.array(keyResultBlueprintSchema).min(1),
});

export const taskSchema = z.object({
  key: taskKeySchema,
  departmentName: nonEmptyString,
  title: nonEmptyString,
  description: nonEmptyString,
  assigneeAgentId: nonEmptyString,
  requiredCapabilities: z.array(nonEmptyString).min(1),
  proofSchemaId: nonEmptyString,
  riskLevel: riskLevelSchema,
  dependsOnTaskKeys: z.array(taskKeySchema).default([]),
  handoffContract: nonEmptyString,
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
      if (!departmentNames.has(task.departmentName)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "departmentName"],
          message: `Task references missing department: ${task.departmentName}`,
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
