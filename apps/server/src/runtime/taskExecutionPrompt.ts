import type { Company, Locale, Task } from "@auto-crop/core";
import type { TaskHandoff } from "./dependencyReadiness";
import { LOCALE_LANGUAGE_NAME } from "./localePromptText";
import { buildProofContractInstructions } from "./proofContract";

export type BuildTaskExecutionPromptInput = {
  company: Company;
  task: Task;
  handoffs: TaskHandoff[];
};

type PromptExamples = {
  executionReport: {
    conclusion: string;
    vision_impact: string;
    remaining_gap: string;
    recommendation: string;
  };
  outcomeSummary: string;
  openDecision: {
    options: { label: string; tradeoffs: string }[];
    recommendation: string;
    rationale: string;
    briefing: string;
  };
};

const LOCALE_PROMPT_EXAMPLES: Record<Locale, PromptExamples> = {
  en: {
    executionReport: {
      conclusion: "The target keyword has a rankable opening and the competing pages are stale.",
      vision_impact:
        "Advances the founder vision: gives an executable entry point for finding an SEO opportunity and shipping a lightweight web product.",
      remaining_gap:
        "The monetization path for this keyword is unvalidated; the next step must assess demand and willingness to pay.",
      recommendation: "Build a single-page conversion tool around this keyword as the MVP.",
    },
    outcomeSummary:
      "The target keyword has a rankable, low-competition opening; recommend building a single-page conversion tool around it, with monetization still to be validated.",
    openDecision: {
      options: [
        { label: "Flat monthly fee", tradeoffs: "Predictable revenue; leaves heavy users underpriced." },
        { label: "Usage-based", tradeoffs: "Scales with value delivered; harder for buyers to forecast." },
      ],
      recommendation: "Flat monthly fee",
      rationale: "Early buyers want a predictable bill and the usage spread is still narrow.",
      briefing:
        "We explored three pricing shapes against the resume-tool buyers we interviewed. The opportunity is solo job seekers who convert on a single polished output; what is differentiated is same-session turnaround with no account setup. Monetization is a low-friction paid unlock at the moment of value, and a flat fee is the only shape those buyers could forecast.",
    },
  },
  zh: {
    executionReport: {
      conclusion: "目标关键词具备可排名的机会，竞争页面内容陈旧。",
      vision_impact: "推动创始人愿景：为“找到 SEO 机会并上线轻量级网页产品”提供了可执行的切入点。",
      remaining_gap: "该关键词的变现路径尚未验证，下一步需要评估需求与付费意愿。",
      recommendation: "以该关键词为核心，构建一个单页转换工具作为最小可行产品。",
    },
    outcomeSummary: "目标关键词有排名机会且竞争薄弱，建议据此构建单页转换工具，变现路径仍待验证。",
    openDecision: {
      options: [
        { label: "统一月费", tradeoffs: "收入可预测；重度用户定价偏低。" },
        { label: "按用量计费", tradeoffs: "随交付价值扩展；买方难以预估费用。" },
      ],
      recommendation: "统一月费",
      rationale: "早期买家希望账单可预测，且当前用量差异仍然较小。",
      briefing:
        "我们针对访谈过的简历工具买家评估了三种定价形态。机会点在于以单份高质量成品完成转化的个人求职者；差异化在于无需注册、当次会话即可交付。变现方式是在价值兑现的节点提供低摩擦的付费解锁，而只有统一月费这种形态是这些买家能够预估的。",
    },
  },
};

export function buildTaskExecutionPrompt(input: BuildTaskExecutionPromptInput): string {
  const { company, task, handoffs } = input;
  const languageName = LOCALE_LANGUAGE_NAME[company.locale];
  const examples = LOCALE_PROMPT_EXAMPLES[company.locale];
  const companyContext = [
    "## Company Context",
    "",
    `Company Name: ${company.name}`,
    `Founder Vision: ${company.founderVision}`,
    `Selected Playbook: ${company.playbookId}`,
    "",
    "Use this company context as the source of truth for business direction. Do not infer product direction from examples, placeholders, repository names, or previous work unless they are included in this context or accepted upstream handoffs.",
    "",
    `Company Language: ${languageName}. Author every founder-facing prose field in ${languageName} — this includes each Structured Execution Report field and every Open Decisions entry described below.`,
    "Do not translate machine identifiers, file paths, URLs, code, or brand names; leave them exactly as they are.",
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
        payload: {
          execution_report: examples.executionReport,
          outcome_summary: examples.outcomeSummary,
        },
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
    "## Structured Execution Report",
    "",
    "Every `deliverable` and `final_report` payload must include `execution_report` with four fields:",
    `\`conclusion\`, \`vision_impact\`, \`remaining_gap\`, and \`recommendation\`. Write each one in ${languageName}`,
    "as business judgement, not process notes.",
    "",
    `Also include \`outcome_summary\`, written in ${languageName}, for compatibility with older CEO Office readers.`,
    "It should be a plain-language string that combines the same conclusion, vision impact, remaining gap, and",
    "recommendation. Missing or malformed `execution_report` fails validation, and a missing `outcome_summary`",
    "still fails validation.",
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
        options: examples.openDecision.options,
        recommendation: examples.openDecision.recommendation,
        rationale: examples.openDecision.rationale,
        briefing: examples.openDecision.briefing,
      },
      null,
      2,
    ),
    "`decisionKind` must be one of the five kinds above (any other choice is your own call and is ignored).",
    "Give more than one option, each with its trade-offs; name the recommended option and give your rationale.",
    "`briefing` is required: the substance the founder needs to decide from the card alone — what you",
    "explored, where the opportunity is, what is differentiated, the monetization angle and why these",
    "options exist. An entry missing `briefing` fails validation, exactly like a missing `rationale`.",
    `Write every \`label\`, \`tradeoffs\`, \`recommendation\`, \`rationale\`, and \`briefing\` in ${languageName}.`,
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
