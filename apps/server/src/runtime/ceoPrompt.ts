import type { PolicyMode } from "../policies/policy";
import type { Playbook } from "../playbooks/types";
import { isCollectableSchema } from "./proof";

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
  // Only advertise Collectable Proof Schemas: a schema with no runtime collector is a landmine
  // because tasks that use it can never record Proof.
  const collectableProofSchemas = input.playbook.proofSchemas.filter(isCollectableSchema);

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
    ...collectableProofSchemas.map(
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
    "Provide Localized Business Content in English and Chinese for every user-facing blueprint string.",
    "For each department/objective/key result/task/proof schema/handoff contract, include the legacy string field plus its corresponding *Text object with en and zh values.",
    "Each task must include a stable lowercase key, a dependsOnTaskKeys array, and a handoffContract.",
    "Use dependsOnTaskKeys only when the downstream task consumes the upstream task's proof or artifact handoff.",
    "Dependencies must reference earlier task keys so the runtime can build an acyclic task graph.",
    "Write handoffContract as the specific consumable deliverable downstream agents can rely on after Proof exists.",
    "Every task must include verification: null, or an object when the task's job is to verify other tasks' output.",
    "A verifying task sets verification.targetTaskKeys to the earlier task keys whose output it checks, and verification.requirements to",
    "a non-empty list of { id, description }: each id a short unique lowercase slug, each description one observable condition that output",
    "must meet for the plan to count it as done. The runtime hands the verifier a snapshot of the targets and judges it against exactly these",
    "requirements, so do not leave out a condition the plan depends on. Tasks that research, plan, build, or write are not verifying tasks:",
    "give them verification: null.",
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
              key: "product",
              name: "Product",
              nameText: { en: "Product", zh: "产品" },
              responsibility: "Department responsibility.",
              responsibilityText: { en: "Department responsibility.", zh: "部门职责。" },
              leadAgentId: "agent-id",
            },
          ],
          objectives: [
            {
              title: "Objective title",
              titleText: { en: "Objective title", zh: "目标标题" },
              priority: 1,
              keyResults: [
                {
                  title: "Key result title",
                  titleText: { en: "Key result title", zh: "关键结果标题" },
                  metricName: "metric_name",
                  targetValue: "target",
                  targetValueText: { en: "target", zh: "目标值" },
                  currentValue: "current",
                  currentValueText: { en: "current", zh: "当前值" },
                },
              ],
            },
          ],
          proofSchemas: collectableProofSchemas,
          tasks: [
            {
              key: "task_key",
              departmentKey: "product",
              departmentName: "Product",
              title: "Task title",
              titleText: { en: "Task title", zh: "任务标题" },
              description: "Task description",
              descriptionText: { en: "Task description", zh: "任务描述" },
              assigneeAgentId: "agent-id",
              requiredCapabilities: ["writing"],
              proofSchemaId: collectableProofSchemas[0]?.id ?? "proof-schema-id",
              riskLevel: "low",
              dependsOnTaskKeys: [],
              handoffContract: "Specific consumable deliverable this task must produce for downstream work.",
              handoffContractText: {
                en: "Specific consumable deliverable this task must produce for downstream work.",
                zh: "该任务必须为下游工作产出的具体可消费交付物。",
              },
              verification: null,
            },
            {
              key: "verify_task_key",
              departmentKey: "product",
              departmentName: "Product",
              title: "Verify the deliverable",
              titleText: { en: "Verify the deliverable", zh: "验证交付物" },
              description: "Check the upstream deliverable against its requirements.",
              descriptionText: { en: "Check the upstream deliverable against its requirements.", zh: "按要求检查上游交付物。" },
              assigneeAgentId: "agent-id",
              requiredCapabilities: ["writing"],
              proofSchemaId: collectableProofSchemas[0]?.id ?? "proof-schema-id",
              riskLevel: "low",
              dependsOnTaskKeys: ["task_key"],
              handoffContract: "Verification result for each requirement, with evidence.",
              handoffContractText: {
                en: "Verification result for each requirement, with evidence.",
                zh: "逐项验证结论及其证据。",
              },
              verification: {
                targetTaskKeys: ["task_key"],
                requirements: [{ id: "requirement-slug", description: "One observable condition the target output must meet." }],
              },
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
