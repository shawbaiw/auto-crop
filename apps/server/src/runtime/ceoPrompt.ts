import type { PolicyMode } from "../policies/policy";
import type { Playbook } from "../playbooks/types";

export type CeoPromptAgent = {
  id: string;
  name: string;
  capabilities: string[];
};

export type BuildCeoPromptInput = {
  companyName: string;
  founderVision: string;
  playbook: Playbook;
  availableAgents: CeoPromptAgent[];
  permissionMode: PolicyMode;
  assets: string[];
};

export function buildCeoPrompt(input: BuildCeoPromptInput): string {
  return [
    "# CEO Office",
    "",
    "You are the CEO Office for a local agent company runtime.",
    "Turn the founder vision into an executable company blueprint.",
    "",
    "## Company Name",
    input.companyName,
    "Use the provided company name exactly. Do not rename, rebrand, abbreviate, or translate it.",
    "",
    "## Founder Vision",
    input.founderVision,
    "",
    "## Selected Playbook",
    `ID: ${input.playbook.id}`,
    `Name: ${input.playbook.name}`,
    `Suitable for: ${input.playbook.suitableFor.join(", ")}`,
    "",
    "## Allowed Departments",
    ...input.playbook.defaultDepartments.map(
      (department) => `- ${department.name}: ${department.responsibility}`,
    ),
    "",
    "## Allowed Proof Schemas",
    ...input.playbook.proofSchemas.map(
      (proofSchema) =>
        `- ${proofSchema.id}: ${proofSchema.description} (${proofSchema.acceptedTypes.join(", ")})`,
    ),
    "",
    "## Available Agents",
    ...input.availableAgents.map(
      (agent) => `- ${agent.id} (${agent.name}): ${agent.capabilities.join(", ")}`,
    ),
    "",
    "## Permission Mode",
    input.permissionMode,
    "",
    "## Founder Assets",
    ...(input.assets.length > 0 ? input.assets.map((asset) => `- ${asset}`) : ["- None"]),
    "",
    "## Output Contract",
    "Return exactly two sections:",
    "",
    "## Human CEO Brief",
    "A concise explanation for the founder.",
    "",
    "## Strict JSON",
    "A fenced JSON block. The runtime will parse only this block.",
    "Do not include departments or proof schemas outside the selected playbook.",
    `Set blueprint.company.name to the provided company name exactly: ${input.companyName}`,
    "Each task must include a stable lowercase key, a dependsOnTaskKeys array, and a handoffContract.",
    "Use dependsOnTaskKeys only when the downstream task consumes the upstream task's proof or artifact handoff.",
    "Dependencies must reference earlier task keys so the runtime can build an acyclic task graph.",
    "Write handoffContract as the specific consumable deliverable downstream agents can rely on after Proof exists.",
    "",
    "```json",
    JSON.stringify(
      {
        brief: "Founder-facing summary.",
        blueprint: {
          company: {
            name: input.companyName,
            founderVision: input.founderVision,
            playbookId: input.playbook.id,
          },
          departments: [
            {
              name: "Product",
              responsibility: "Department responsibility.",
              leadAgentId: "agent-id",
            },
          ],
          objectives: [
            {
              title: "Objective title",
              priority: 1,
              keyResults: [
                {
                  title: "Key result title",
                  metricName: "metric_name",
                  targetValue: "target",
                  currentValue: "current",
                },
              ],
            },
          ],
          proofSchemas: input.playbook.proofSchemas,
          tasks: [
            {
              key: "task_key",
              departmentName: "Product",
              title: "Task title",
              description: "Task description",
              assigneeAgentId: "agent-id",
              requiredCapabilities: ["writing"],
              proofSchemaId: input.playbook.proofSchemas[0]?.id ?? "proof-schema-id",
              riskLevel: "low",
              dependsOnTaskKeys: [],
              handoffContract: "Specific consumable deliverable this task must produce for downstream work.",
            },
          ],
        },
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
}
