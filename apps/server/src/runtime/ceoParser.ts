import { ceoResponseSchema, localizedTextFromString, type CeoResponseInput } from "@auto-crop/core";
import type { Playbook } from "../playbooks/types";
import { isCollectableSchema } from "./proof";

/** The proof schema every screenshot-flavored or otherwise non-collectable task is normalized to. */
const FALLBACK_PROOF_SCHEMA_ID = "test-output";

export type ProofSchemaNormalization = {
  taskKey: string;
  from: string;
  to: string;
  reason: "not_collectable";
};

export type CeoParseResult = CeoResponseInput & {
  proofSchemaNormalizations: ProofSchemaNormalization[];
};

export function parseCeoOutput(output: string, playbook: Playbook): CeoParseResult {
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
  const proofSchemaNormalizations = validateAgainstPlaybook(response, playbook);

  return { ...response, proofSchemaNormalizations };
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

function validateAgainstPlaybook(response: CeoResponseInput, playbook: Playbook): ProofSchemaNormalization[] {
  const allowedDepartments = new Set(playbook.defaultDepartments.map((department) => department.name));
  const allowedDepartmentKeys = new Set(playbook.defaultDepartments.map((department) => department.key));
  const collectablePlaybookSchemas = playbook.proofSchemas.filter(isCollectableSchema);
  const allowedProofSchemas = new Set(collectablePlaybookSchemas.map((proofSchema) => proofSchema.id));

  for (const department of response.blueprint.departments) {
    const supported = department.key ? allowedDepartmentKeys.has(department.key) : allowedDepartments.has(department.name);
    if (!supported) {
      throw new Error(`Unsupported department for playbook ${playbook.id}: ${department.key ?? department.name}`);
    }
  }

  // A collectable schema outside the playbook is a hard error; a non-collectable schema (e.g.
  // `screenshot`) is a landmine that is dropped from the menu and any task using it is normalized.
  for (const proofSchema of response.blueprint.proofSchemas) {
    if (!allowedProofSchemas.has(proofSchema.id) && isCollectableSchema(proofSchema)) {
      throw new Error(`Unsupported proof schema for playbook ${playbook.id}: ${proofSchema.id}`);
    }
  }

  const normalizations: ProofSchemaNormalization[] = [];
  const fallbackSchema = playbook.proofSchemas.find((proofSchema) => proofSchema.id === FALLBACK_PROOF_SCHEMA_ID);

  for (const task of response.blueprint.tasks) {
    const supported = task.departmentKey ? allowedDepartmentKeys.has(task.departmentKey) : allowedDepartments.has(task.departmentName);
    if (!supported) {
      throw new Error(`Unsupported department for playbook ${playbook.id}: ${task.departmentKey ?? task.departmentName}`);
    }

    if (allowedProofSchemas.has(task.proofSchemaId)) {
      continue;
    }

    normalizations.push({
      taskKey: task.key,
      from: task.proofSchemaId,
      to: FALLBACK_PROOF_SCHEMA_ID,
      reason: "not_collectable",
    });
    task.proofSchemaId = FALLBACK_PROOF_SCHEMA_ID;
  }

  response.blueprint.proofSchemas = response.blueprint.proofSchemas.filter((proofSchema) =>
    isCollectableSchema(proofSchema),
  );
  if (
    normalizations.length > 0 &&
    fallbackSchema &&
    !response.blueprint.proofSchemas.some((proofSchema) => proofSchema.id === FALLBACK_PROOF_SCHEMA_ID)
  ) {
    response.blueprint.proofSchemas.push(fallbackSchema);
  }

  return normalizations;
}

function extractFencedJson(output: string): string | null {
  const match = output.match(/```json\s*([\s\S]*?)\s*```/i);
  return match?.[1] ?? null;
}
