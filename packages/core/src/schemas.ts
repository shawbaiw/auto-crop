import { z } from "zod";

export const nonEmptyString = z.string().trim().min(1);

export const riskLevelSchema = z.enum(["low", "medium", "high"]);

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
  departmentName: nonEmptyString,
  title: nonEmptyString,
  description: nonEmptyString,
  dependencies: z.array(nonEmptyString).optional(),
  assigneeAgentId: nonEmptyString,
  requiredCapabilities: z.array(nonEmptyString).min(1),
  proofSchemaId: nonEmptyString,
  riskLevel: riskLevelSchema,
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
    const taskTitles = new Set<string>();

    blueprint.tasks.forEach((task, index) => {
      if (taskTitles.has(task.title)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "title"],
          message: `Task title must be unique for dependency references: ${task.title}`,
        });
      }
      taskTitles.add(task.title);

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

      for (const dependency of task.dependencies ?? []) {
        if (dependency === task.title) {
          context.addIssue({
            code: "custom",
            path: ["tasks", index, "dependencies"],
            message: `Task cannot depend on itself: ${task.title}`,
          });
        }

        if (!blueprint.tasks.some((candidate) => candidate.title === dependency)) {
          context.addIssue({
            code: "custom",
            path: ["tasks", index, "dependencies"],
            message: `Task references missing dependency: ${dependency}`,
          });
        }
      }
    });

    for (const cycle of findDependencyCycles(blueprint.tasks)) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: `Task dependency cycle detected: ${cycle.join(" -> ")}`,
      });
    }
  });

export const ceoResponseSchema = z.object({
  brief: nonEmptyString,
  blueprint: companyBlueprintSchema,
});

export type RiskLevelInput = z.infer<typeof riskLevelSchema>;
export type ProofTypeInput = z.infer<typeof proofTypeSchema>;
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

function findDependencyCycles(tasks: Array<{ title: string; dependencies?: string[] }>): string[][] {
  const dependenciesByTitle = new Map(tasks.map((task) => [task.title, task.dependencies ?? []]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];

  function visit(title: string, path: string[]): void {
    if (visiting.has(title)) {
      const cycleStart = path.indexOf(title);
      cycles.push(path.slice(cycleStart));
      return;
    }

    if (visited.has(title)) {
      return;
    }

    visiting.add(title);
    for (const dependency of dependenciesByTitle.get(title) ?? []) {
      if (dependenciesByTitle.has(dependency)) {
        visit(dependency, [...path, dependency]);
      }
    }
    visiting.delete(title);
    visited.add(title);
  }

  for (const task of tasks) {
    visit(task.title, [task.title]);
  }

  return cycles;
}
