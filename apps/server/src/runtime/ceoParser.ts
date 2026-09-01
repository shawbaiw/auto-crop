import { ceoResponseSchema, localizedTextFromString, type CeoResponseInput } from "@auto-crop/core";
import type { Playbook } from "../playbooks/types";

export function parseCeoOutput(output: string, playbook: Playbook): CeoResponseInput {
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

  const response = withLocalizedFallbacks(ceoResponseSchema.parse(parsed));
  validateAgainstPlaybook(response, playbook);

  return response;
}

function withLocalizedFallbacks(response: CeoResponseInput): CeoResponseInput {
  return {
    ...response,
    blueprint: {
      ...response.blueprint,
      departments: response.blueprint.departments.map((department) => ({
        ...department,
        nameText: department.nameText ?? localizedTextFromString(department.name),
        responsibilityText: department.responsibilityText ?? localizedTextFromString(department.responsibility),
      })),
      objectives: response.blueprint.objectives.map((objective) => ({
        ...objective,
        titleText: objective.titleText ?? localizedTextFromString(objective.title),
        keyResults: objective.keyResults.map((keyResult) => ({
          ...keyResult,
          titleText: keyResult.titleText ?? localizedTextFromString(keyResult.title),
          targetValueText: keyResult.targetValueText ?? localizedTextFromString(keyResult.targetValue),
          currentValueText: keyResult.currentValueText ?? localizedTextFromString(keyResult.currentValue),
        })),
      })),
      proofSchemas: response.blueprint.proofSchemas.map((proofSchema) => ({
        ...proofSchema,
        descriptionText: proofSchema.descriptionText ?? localizedTextFromString(proofSchema.description),
      })),
      tasks: response.blueprint.tasks.map((task) => ({
        ...task,
        titleText: task.titleText ?? localizedTextFromString(task.title),
        descriptionText: task.descriptionText ?? localizedTextFromString(task.description),
        handoffContractText: task.handoffContractText ?? localizedTextFromString(task.handoffContract),
      })),
    },
  };
}

function validateAgainstPlaybook(response: CeoResponseInput, playbook: Playbook): void {
  const allowedDepartments = new Set(playbook.defaultDepartments.map((department) => department.name));
  const allowedDepartmentKeys = new Set(playbook.defaultDepartments.map((department) => department.key));
  const allowedProofSchemas = new Set(playbook.proofSchemas.map((proofSchema) => proofSchema.id));

  for (const department of response.blueprint.departments) {
    const supported = department.key ? allowedDepartmentKeys.has(department.key) : allowedDepartments.has(department.name);
    if (!supported) {
      throw new Error(`Unsupported department for playbook ${playbook.id}: ${department.key ?? department.name}`);
    }
  }

  for (const proofSchema of response.blueprint.proofSchemas) {
    if (!allowedProofSchemas.has(proofSchema.id)) {
      throw new Error(`Unsupported proof schema for playbook ${playbook.id}: ${proofSchema.id}`);
    }
  }

  for (const task of response.blueprint.tasks) {
    const supported = task.departmentKey ? allowedDepartmentKeys.has(task.departmentKey) : allowedDepartments.has(task.departmentName);
    if (!supported) {
      throw new Error(`Unsupported department for playbook ${playbook.id}: ${task.departmentKey ?? task.departmentName}`);
    }

    if (!allowedProofSchemas.has(task.proofSchemaId)) {
      throw new Error(`Unsupported proof schema for playbook ${playbook.id}: ${task.proofSchemaId}`);
    }
  }
}

function extractFencedJson(output: string): string | null {
  const match = output.match(/```json\s*([\s\S]*?)\s*```/i);
  return match?.[1] ?? null;
}
