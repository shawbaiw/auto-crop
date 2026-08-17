import { ceoResponseSchema, type CeoResponseInput } from "@auto-crop/core";
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

  const response = ceoResponseSchema.parse(parsed);
  validateAgainstPlaybook(response, playbook);

  return response;
}

function validateAgainstPlaybook(response: CeoResponseInput, playbook: Playbook): void {
  const allowedDepartments = new Set(playbook.defaultDepartments.map((department) => department.name));
  const allowedProofSchemas = new Set(playbook.proofSchemas.map((proofSchema) => proofSchema.id));

  for (const department of response.blueprint.departments) {
    if (!allowedDepartments.has(department.name)) {
      throw new Error(`Unsupported department for playbook ${playbook.id}: ${department.name}`);
    }
  }

  for (const proofSchema of response.blueprint.proofSchemas) {
    if (!allowedProofSchemas.has(proofSchema.id)) {
      throw new Error(`Unsupported proof schema for playbook ${playbook.id}: ${proofSchema.id}`);
    }
  }

  for (const task of response.blueprint.tasks) {
    if (!allowedDepartments.has(task.departmentName)) {
      throw new Error(`Unsupported department for playbook ${playbook.id}: ${task.departmentName}`);
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
