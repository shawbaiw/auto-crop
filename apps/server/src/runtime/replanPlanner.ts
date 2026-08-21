import type { ReplanReplacementTask, Task } from "@auto-crop/core";
import type { Company, ProofSchema, RiskLevel } from "@auto-crop/core";
import type { Playbook } from "../playbooks/types";

export type ReplanPlannerResponse = {
  rationale: string;
  replacementTasks: ReplanReplacementTask[];
};

export type BuildReplanPlannerPromptInput = {
  company: Company;
  sourceTask: Task;
  downstreamTasks: Task[];
  proofSchemas: ProofSchema[];
};

export function buildReplanPlannerPrompt(input: BuildReplanPlannerPromptInput): string {
  return [
    "# Replan Oversized Agent Task",
    "",
    "You are the planning agent for Auto-Crop. Replace one oversized task with a smaller proof-backed task chain.",
    "Do not mutate the existing graph. Return a proposal for human review.",
    "",
    "## Company",
    `Name: ${input.company.name}`,
    `Founder vision: ${input.company.founderVision}`,
    `Playbook: ${input.company.playbookId}`,
    "",
    "## Source Task",
    formatTaskForPrompt(input.sourceTask),
    "",
    "## Downstream Consumers",
    input.downstreamTasks.length > 0
      ? input.downstreamTasks.map(formatTaskForPrompt).join("\n\n")
      : "No direct downstream consumers.",
    "",
    "## Allowed Proof Schemas",
    input.proofSchemas.map((schema) => `- ${schema.id}: ${schema.description}`).join("\n"),
    "",
    "## Planning Rules",
    "- Produce 2 to 5 replacement tasks.",
    "- Each replacement task must be small enough for one agent run.",
    "- The final replacement task must produce proof that can satisfy downstream consumers.",
    "- Use only allowed proofSchemaId values.",
    "- Use riskLevel: low, medium, or high.",
    "- Keep requiredCapabilities explicit and minimal.",
    "",
    "## Strict JSON",
    "Return only fenced JSON in this exact shape:",
    "```json",
    JSON.stringify(
      {
        rationale: "Why this split is safer than retrying the original task.",
        replacementTasks: [
          {
            title: "Short imperative task title",
            description: "Concrete deliverable and acceptance criteria.",
            requiredCapabilities: ["writing"],
            proofSchemaId: "product-brief",
            riskLevel: "low",
          },
        ],
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
}

export function parseReplanPlannerOutput(output: string, playbook: Playbook): ReplanPlannerResponse {
  const jsonSource = extractFencedJson(output);

  if (!jsonSource) {
    throw new Error("Replan planner output must include strict JSON in a fenced json block.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonSource);
  } catch (error) {
    throw new Error(`Replan planner strict JSON is invalid: ${(error as Error).message}`);
  }

  const response = parsePlannerResponseShape(parsed);
  validateAgainstPlaybook(response, playbook);
  return response;
}

function parsePlannerResponseShape(value: unknown): ReplanPlannerResponse {
  if (!isRecord(value)) {
    throw new Error("Replan planner response must be an object.");
  }

  const rationale = parseNonEmptyString(value.rationale, "rationale");
  const replacementTasks = parseReplacementTasks(value.replacementTasks);

  return { rationale, replacementTasks };
}

function parseReplacementTasks(value: unknown): ReplanReplacementTask[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Replan planner response must include replacementTasks.");
  }

  return value.map((task, index) => {
    if (!isRecord(task)) {
      throw new Error(`Replacement task ${index + 1} must be an object.`);
    }

    return {
      title: parseNonEmptyString(task.title, `replacementTasks.${index}.title`),
      description: parseNonEmptyString(task.description, `replacementTasks.${index}.description`),
      requiredCapabilities: parseStringArray(task.requiredCapabilities, `replacementTasks.${index}.requiredCapabilities`),
      proofSchemaId: parseNonEmptyString(task.proofSchemaId, `replacementTasks.${index}.proofSchemaId`),
      riskLevel: parseRiskLevel(task.riskLevel, `replacementTasks.${index}.riskLevel`),
    };
  });
}

function validateAgainstPlaybook(response: ReplanPlannerResponse, playbook: Playbook): void {
  const allowedProofSchemas = new Set(playbook.proofSchemas.map((schema) => schema.id));

  for (const task of response.replacementTasks) {
    if (!allowedProofSchemas.has(task.proofSchemaId)) {
      throw new Error(`Unsupported proof schema for playbook ${playbook.id}: ${task.proofSchemaId}`);
    }
  }
}

function formatTaskForPrompt(task: Task): string {
  return [
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Description: ${task.description}`,
    `Status: ${task.status}`,
    `Failure reason: ${task.latestFailureReason ?? "unknown"}`,
    `Failure message: ${task.latestFailureMessage ?? "none"}`,
    `Required capabilities: ${task.requiredCapabilities.join(", ")}`,
    `Proof schema: ${task.proofSchemaId}`,
    `Risk level: ${task.riskLevel}`,
  ].join("\n");
}

function parseNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Replan planner field ${field} must be a non-empty string.`);
  }

  return value.trim();
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`Replan planner field ${field} must be a non-empty string array.`);
  }

  return value.map((item) => item.trim());
}

function parseRiskLevel(value: unknown, field: string): RiskLevel {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  throw new Error(`Replan planner field ${field} must be low, medium, or high.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractFencedJson(output: string): string | null {
  const match = output.match(/```json\s*([\s\S]*?)\s*```/i);
  return match?.[1] ?? null;
}
