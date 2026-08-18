import type { Company, Department, KeyResult, Proof, ProofSchema, Task } from "@auto-crop/core";

export type TaskPacketDependency = {
  task: Task;
  proof: Proof[];
};

export type BuildTaskPacketInput = {
  company: Company;
  task: Task;
  department: Department | null;
  keyResult: KeyResult | null;
  proofSchema: ProofSchema | null;
  dependencies: TaskPacketDependency[];
};

export function buildTaskPacket(input: BuildTaskPacketInput): string {
  return [
    "# Auto-Crop Task Packet",
    "",
    "This file is the execution contract for the worker agent. Complete the task in this workspace.",
    "",
    "## Company",
    `Name: ${input.company.name}`,
    `Founder Vision: ${input.company.founderVision}`,
    `Playbook: ${input.company.playbookId}`,
    "",
    "## Department",
    input.department
      ? [`Name: ${input.department.name}`, `Responsibility: ${input.department.responsibility}`].join("\n")
      : "Unknown department.",
    "",
    "## Task",
    `ID: ${input.task.id}`,
    `Title: ${input.task.title}`,
    `Description: ${input.task.description}`,
    `Risk: ${input.task.riskLevel}`,
    "",
    "## Key Result",
    input.keyResult
      ? [
          `Title: ${input.keyResult.title}`,
          `Metric: ${input.keyResult.metricName}`,
          `Target: ${input.keyResult.targetValue}`,
          `Current: ${input.keyResult.currentValue}`,
        ].join("\n")
      : "No key result is linked.",
    "",
    "## Dependency Proof",
    ...formatDependencies(input.dependencies),
    "",
    "## Artifact Paths",
    "- Put durable task outputs under `artifacts/` in this task workspace.",
    "- Reference every durable output path from `proof.json`.",
    "",
    "## Proof Contract",
    `Proof schema: ${input.task.proofSchemaId}`,
    input.proofSchema
      ? `Accepted proof types: ${input.proofSchema.acceptedTypes.join(", ")}`
      : "Accepted proof types: unknown",
    "When complete, write `proof.json` at the task workspace root:",
    "```json",
    JSON.stringify(
      {
        status: "complete",
        summary: "Short proof summary.",
        files: ["artifacts/output.md"],
        screenshots: [],
        urls: [],
        deploymentUrls: [],
      },
      null,
      2,
    ),
    "```",
    "",
    "Do not report success unless the referenced proof exists and matches the task proof schema.",
    "",
  ].join("\n");
}

function formatDependencies(dependencies: TaskPacketDependency[]): string[] {
  if (dependencies.length === 0) {
    return ["- None"];
  }

  return dependencies.flatMap((dependency) => [
    `- ${dependency.task.title} (${dependency.task.status})`,
    ...dependency.proof.map((proof) => `  - ${proof.type}: ${proof.summary} (${proof.uri})`),
  ]);
}
