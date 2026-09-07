import type { Company, Task } from "@auto-crop/core";
import type { TaskHandoff } from "./dependencyReadiness";
import { buildProofContractInstructions } from "./proofContract";

export type BuildTaskExecutionPromptInput = {
  company: Company;
  task: Task;
  handoffs: TaskHandoff[];
};

export function buildTaskExecutionPrompt(input: BuildTaskExecutionPromptInput): string {
  const { company, task, handoffs } = input;
  const companyContext = [
    "## Company Context",
    "",
    `Company Name: ${company.name}`,
    `Founder Vision: ${company.founderVision}`,
    `Selected Playbook: ${company.playbookId}`,
    "",
    "Use this company context as the source of truth for business direction. Do not infer product direction from examples, placeholders, repository names, or previous work unless they are included in this context or accepted upstream handoffs.",
    "",
    "## Current Task",
    "",
    `Task Title: ${task.title}`,
    "",
  ];
  const artifactInstructions = [
    "## Business Artifact",
    "",
    "Write a structured business artifact to `.auto-crop/business-artifact.json` before finishing.",
    "Use this JSON shape:",
    JSON.stringify(
      {
        artifact_kind: "deliverable",
        artifact_role: "implementation",
        artifact_subtype: "prototype_implementation",
        task_type: "task-specific-type",
        payload: { outcome_summary: "..." },
        lineage: {},
      },
      null,
      2,
    ),
    "Choose artifact_kind from: deliverable, blocker, decision_request, direction_change_request, final_report.",
    "Choose artifact_role from: findings, plan, spec, implementation, validation, launch, report, none.",
    "Put use-case-specific names such as keyword_research, mvp_brief, or seo_launch_plan in artifact_subtype, not in artifact_kind or artifact_role.",
    "Use payload for the task-specific structured result and lineage for the upstream objective chain you used.",
    "",
    "## Task Outcome Summary",
    "",
    "Every `deliverable` and `final_report` payload must include an `outcome_summary` field: a plain-language",
    "string (or a `{ \"en\": \"...\", \"zh\": \"...\" }` object) the founder reads instead of your raw output. State, in order:",
    "1. The conclusion you reached.",
    "2. What that conclusion means for the objective or vision this task serves.",
    "3. What gap still remains toward the vision (in prose) — completing the task is not the same as reaching the goal.",
    "Add a fourth part only when you are leaving a strategic choice that is the founder's to make: list the",
    "viable options with their trade-offs and say which one you recommend.",
    "Write business judgement, not process notes; a missing `outcome_summary` fails validation.",
    "",
    "## Open Decisions",
    "",
    "If you make a choice on a strategic business decision whose first value is the founder's to set —",
    "one of: target_market, product_direction, mvp_type, pricing_model, launch_target — do NOT let your",
    "pick stand as direction. Declare it in a `payload.open_decisions` array so the runtime routes it to",
    "the founder. Each entry:",
    JSON.stringify(
      {
        decisionKind: "pricing_model",
        options: [
          { label: "Flat monthly fee", tradeoffs: "Predictable revenue; leaves heavy users underpriced." },
          { label: "Usage-based", tradeoffs: "Scales with value delivered; harder for buyers to forecast." },
        ],
        recommendation: "Flat monthly fee",
        rationale: "Early buyers want a predictable bill and the usage spread is still narrow.",
      },
      null,
      2,
    ),
    "`decisionKind` must be one of the five kinds above (any other choice is your own call and is ignored).",
    "Give more than one option, each with its trade-offs; name the recommended option and give your rationale.",
    "A choice on one of these kinds is the founder's to make, not yours.",
  ];
  const proofInstructions = buildProofContractInstructions(task);
  const basePrompt = [...companyContext, task.description, "", ...artifactInstructions, "", ...proofInstructions];

  if (handoffs.length === 0) {
    return basePrompt.join("\n");
  }

  return [
    ...basePrompt,
    "",
    "## Upstream Handoffs",
    "",
    ...handoffs.flatMap((handoff, index) => [
      `${index + 1}. Task: ${handoff.upstreamTaskTitle}`,
      `   Business Artifact: ${handoff.artifactKind} / ${handoff.artifactRole} / ${handoff.artifactSubtype} / ${handoff.businessArtifactId}`,
      `   Task Type: ${handoff.taskType}`,
      `   Payload: ${JSON.stringify(handoff.payload)}`,
      `   Lineage: ${JSON.stringify(handoff.lineage)}`,
      ...(handoff.proofId ? [`   Source Proof: ${handoff.proofType} / ${handoff.proofId}`] : []),
      ...(handoff.uri ? [`   Source URI: ${handoff.uri}`] : []),
      ...(handoff.summary ? [`   Summary: ${handoff.summary}`] : []),
      ...(handoff.handoffContract ? [`   Handoff Contract: ${handoff.handoffContract}`] : []),
      ...(handoff.handoffPackagePath ? [`   Handoff Package: ${handoff.handoffPackagePath}`] : []),
      ...(handoff.artifactWorkspacePath ? [`   Artifact Workspace: ${handoff.artifactWorkspacePath}`] : []),
    ]),
  ].join("\n");
}
