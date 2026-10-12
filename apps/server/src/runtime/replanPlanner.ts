import type { ReplanMode, ReplanReplacementTask, ReplanTaskDefinition, Task, VerificationRequirement } from "@auto-crop/core";
import type { Company, ProofSchema, RiskLevel } from "@auto-crop/core";
import type { Playbook } from "../playbooks/types";
import type { StuckContext } from "./replanContext";

export type ReplanPlannerResponse =
  | { mode: "split"; rationale: string; replacementTasks: ReplanReplacementTask[] }
  | {
      mode: "revision";
      rationale: string;
      revisedTask: ReplanTaskDefinition;
      requirementChanges: Array<{ verifierTaskId: string; requirements: VerificationRequirement[] }>;
    };

export type BuildReplanPlannerPromptInput = {
  company: Company;
  sourceTask: Task;
  downstreamTasks: Task[];
  proofSchemas: ProofSchema[];
  /** Why the task is stuck: its Holds, its Blocker Report and Unblock Request, failed checks on it. */
  stuck: StuckContext;
  requestedMode: ReplanMode | null;
  /** The founder's note, for the planner only. */
  founderNote: string | null;
  revisable: {
    editable: Array<{ verifier: Task; requirements: VerificationRequirement[] }>;
    sourced: Array<{ verifier: Task; producer: Task }>;
  };
};

/**
 * Ask for a Split or a Revision of one stuck task (ADR 0043). The planner is told why the task is stuck —
 * not only that it timed out — because the right change depends on it: a task too large for one run is
 * split, and a task asked for what its environment cannot provide is revised, together with the
 * requirement that judges it when that is where the unattainable demand lives.
 */
export function buildReplanPlannerPrompt(input: BuildReplanPlannerPromptInput): string {
  const { stuck } = input;
  return [
    "# Replan A Stuck Task",
    "",
    "You are the planning agent for Auto-Crop. One task cannot succeed as specified. Propose one change for the founder to confirm.",
    "Do not mutate the existing graph. Nothing you propose applies until the founder confirms it.",
    "",
    "## Company",
    `Name: ${input.company.name}`,
    `Founder vision: ${input.company.founderVision}`,
    `Playbook: ${input.company.playbookId}`,
    "",
    "## Source Task",
    formatTaskForPrompt(input.sourceTask),
    "",
    "## Why It Is Stuck",
    ...(stuck.holds.length > 0 ? stuck.holds.map((hold) => `- Hold \`${hold.kind}\`: ${hold.reason}`) : ["- No open Hold."]),
    ...(stuck.blocker
      ? [
        "",
        `Its current delivery is a Blocker Report (${stuck.blocker.subtype}):`,
        truncate(JSON.stringify(stuck.blocker.payload), 4000),
        ...(stuck.blocker.unblockRequest
          ? [
            "",
            "It asked a person for input, and the founder is replanning instead of answering:",
            `- Needed: ${stuck.blocker.unblockRequest.needed}`,
            `- Why: ${stuck.blocker.unblockRequest.why}`,
            `- Evidence asked for: ${stuck.blocker.unblockRequest.evidenceRequirements.join("; ")}`,
          ]
          : []),
      ]
      : []),
    ...stuck.failedVerdicts.flatMap((verdict) => [
      "",
      `Verification by ${verdict.verifierTitle} was ${verdict.outcome}:`,
      ...verdict.checks.map((check) => `- \`${check.requirementId}\` (${check.outcome}): ${check.description} — evidence: ${check.evidence}`),
      ...verdict.issues.map((issue) => `- issue: ${issue}`),
    ]),
    ...(stuck.lastRejection
      ? ["", "The founder rejected the previous proposal:", `- It proposed: ${stuck.lastRejection.rationale}`, `- Founder's reason: ${stuck.lastRejection.note ?? "none given"}`]
      : []),
    "",
    "## The Founder's Request",
    `Mode: ${input.requestedMode ?? "not specified; choose the one that fits why the task is stuck"}`,
    `Note: ${input.founderNote ?? "none"}`,
    "",
    "## Downstream Consumers",
    input.downstreamTasks.length > 0
      ? input.downstreamTasks.map(formatTaskForPrompt).join("\n\n")
      : "No direct downstream consumers.",
    "",
    "## Verification Requirements That Judge This Task",
    ...(input.revisable.editable.length > 0
      ? input.revisable.editable.flatMap(({ verifier, requirements }) => [
        `Verifier ${verifier.id} (${verifier.title}) — planned, a Revision may amend:`,
        ...requirements.map((requirement) => `- \`${requirement.id}\`: ${requirement.description}`),
      ])
      : ["No planned requirements a Revision may amend."]),
    ...input.revisable.sourced.map(({ verifier, producer }) =>
      `Verifier ${verifier.id} (${verifier.title}) takes its requirements from task ${producer.id} (${producer.title}); they cannot be amended here — revise that task instead.`),
    "",
    "## Allowed Proof Schemas",
    input.proofSchemas.map((schema) => `- ${schema.id}: ${schema.description}`).join("\n"),
    "",
    "## Modes",
    "- `split`: the task is too large for one run. Replace it with 2 to 5 smaller tasks toward the same output; the final one must produce",
    "  proof that satisfies the downstream consumers. A split never changes a requirement: it divides the work toward the same standard.",
    "- `revision`: the task as asked cannot succeed (for example it demands data its environment cannot obtain). Keep the task and",
    "  rewrite what it is asked to do: its title, its description (which carries its acceptance criteria), its proofSchemaId and its",
    "  requiredCapabilities. You cannot change its dependencies, department or assignee; if its inputs must change, that is a split or",
    "  an upstream problem. When the unattainable demand lives in a verifier's planned requirements, amend them in `requirementChanges`",
    "  — giving that verifier's complete new requirement list — so the revised task is not failed against the old standard.",
    "Write the founder's note into the task you propose where it applies: the task's agent never sees the note, only what is confirmed.",
    "",
    "## Strict JSON",
    "Return only fenced JSON in one of these shapes:",
    "```json",
    JSON.stringify({
      mode: "split",
      rationale: "Why splitting is the change that unblocks this task.",
      replacementTasks: [
        { title: "Short imperative task title", description: "Concrete deliverable and acceptance criteria.", requiredCapabilities: ["writing"], proofSchemaId: "product-brief", riskLevel: "low" },
      ],
    }, null, 2),
    "```",
    "```json",
    JSON.stringify({
      mode: "revision",
      rationale: "Why the task as asked cannot succeed and what the revision accepts instead.",
      revisedTask: { title: "Short imperative task title", description: "What to deliver and its acceptance criteria.", proofSchemaId: input.sourceTask.proofSchemaId, requiredCapabilities: input.sourceTask.requiredCapabilities },
      requirementChanges: [{ verifierTaskId: input.revisable.editable[0]?.verifier.id ?? "verifier-task-id", requirements: [{ id: "requirement-id", description: "One observable condition." }] }],
    }, null, 2),
    "```",
  ].join("\n");
}

export function parseReplanPlannerOutput(
  output: string,
  playbook: Playbook,
  context: { requestedMode: ReplanMode | null; editableVerifierIds: readonly string[] } = { requestedMode: null, editableVerifierIds: [] },
): ReplanPlannerResponse {
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

  const response = parsePlannerResponseShape(parsed, context);
  validateAgainstPlaybook(response, playbook);
  return response;
}

function parsePlannerResponseShape(
  value: unknown,
  context: { requestedMode: ReplanMode | null; editableVerifierIds: readonly string[] },
): ReplanPlannerResponse {
  if (!isRecord(value)) {
    throw new Error("Replan planner response must be an object.");
  }

  const rationale = parseNonEmptyString(value.rationale, "rationale");
  // A reply without a mode predates Revisions and is a Split.
  const mode = value.mode === undefined ? "split" : value.mode;
  if (mode !== "split" && mode !== "revision") {
    throw new Error("Replan planner field mode must be split or revision.");
  }
  if (context.requestedMode && mode !== context.requestedMode) {
    throw new Error(`The founder asked for a ${context.requestedMode}; the planner returned a ${mode}.`);
  }

  if (mode === "split") {
    // A split divides the work toward the same standard: changing the standard is always a Revision.
    if (value.requirementChanges !== undefined && !(Array.isArray(value.requirementChanges) && value.requirementChanges.length === 0)) {
      throw new Error("A split cannot change verification requirements; that is a revision.");
    }
    const replacementTasks = parseReplacementTasks(value.replacementTasks);
    if (replacementTasks.length < 2 || replacementTasks.length > 5) {
      throw new Error("A split replaces the task with 2 to 5 tasks.");
    }
    return { mode, rationale, replacementTasks };
  }

  if (!isRecord(value.revisedTask)) {
    throw new Error("A revision must include revisedTask.");
  }
  const revisedTask: ReplanTaskDefinition = {
    title: parseNonEmptyString(value.revisedTask.title, "revisedTask.title"),
    description: parseNonEmptyString(value.revisedTask.description, "revisedTask.description"),
    proofSchemaId: parseNonEmptyString(value.revisedTask.proofSchemaId, "revisedTask.proofSchemaId"),
    requiredCapabilities: parseStringArray(value.revisedTask.requiredCapabilities, "revisedTask.requiredCapabilities"),
  };
  for (const forbidden of ["dependsOnTaskIds", "dependencies", "departmentId", "assigneeAgentId"]) {
    if (forbidden in value.revisedTask) {
      throw new Error(`A revision cannot change ${forbidden}; inputs that must change are a split or an upstream problem.`);
    }
  }
  const changes = value.requirementChanges ?? [];
  if (!Array.isArray(changes)) {
    throw new Error("Replan planner field requirementChanges must be an array.");
  }
  const requirementChanges = changes.map((change, index) => {
    if (!isRecord(change)) {
      throw new Error(`requirementChanges.${index} must be an object.`);
    }
    const verifierTaskId = parseNonEmptyString(change.verifierTaskId, `requirementChanges.${index}.verifierTaskId`);
    if (!context.editableVerifierIds.includes(verifierTaskId)) {
      throw new Error(`requirementChanges.${index}: ${verifierTaskId} is not a verifier with planned requirements judging this task.`);
    }
    if (!Array.isArray(change.requirements) || change.requirements.length === 0) {
      throw new Error(`requirementChanges.${index}.requirements must be a non-empty array.`);
    }
    const requirements = change.requirements.map((requirement, requirementIndex) => {
      if (!isRecord(requirement)) {
        throw new Error(`requirementChanges.${index}.requirements.${requirementIndex} must be an object.`);
      }
      return {
        id: parseNonEmptyString(requirement.id, `requirementChanges.${index}.requirements.${requirementIndex}.id`),
        description: parseNonEmptyString(requirement.description, `requirementChanges.${index}.requirements.${requirementIndex}.description`),
      };
    });
    if (new Set(requirements.map((requirement) => requirement.id)).size !== requirements.length) {
      throw new Error(`requirementChanges.${index}.requirements ids must be distinct.`);
    }
    return { verifierTaskId, requirements };
  });
  if (new Set(requirementChanges.map((change) => change.verifierTaskId)).size !== requirementChanges.length) {
    throw new Error("requirementChanges must name each verifier at most once.");
  }
  return { mode, rationale, revisedTask, requirementChanges };
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
  const proofSchemaIds = response.mode === "split"
    ? response.replacementTasks.map((task) => task.proofSchemaId)
    : [response.revisedTask.proofSchemaId];

  for (const proofSchemaId of proofSchemaIds) {
    if (!allowedProofSchemas.has(proofSchemaId)) {
      throw new Error(`Unsupported proof schema for playbook ${playbook.id}: ${proofSchemaId}`);
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
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
