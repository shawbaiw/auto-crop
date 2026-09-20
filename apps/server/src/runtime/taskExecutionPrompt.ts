import { actionIntentCategories, type Company, type Locale, type Task, type VerificationInputs } from "@auto-crop/core";
import { describeRuntimeCapability, type AgentCapabilityGrant } from "../policies/capabilityGrant";
import type { TaskHandoff } from "./dependencyReadiness";
import { LOCALE_LANGUAGE_NAME } from "./localePromptText";
import { buildProofContractInstructions } from "./proofContract";

export type BuildTaskExecutionPromptInput = {
  company: Company;
  task: Task;
  handoffs: TaskHandoff[];
  /** What this run may actually do. Omitted only by callers that do not launch an agent. */
  grant?: AgentCapabilityGrant;
  /** Failed checks a verifier sent back to this task, to fix in this run. */
  rework?: Array<{
    round: number;
    verifierTitle: string;
    failedChecks: Array<{ requirementId: string; description: string; outcome: string; evidence: string }>;
  }>;
  /** This task's Verification Contract obligations, resolved by the runtime before dispatch. */
  verification?: {
    producesRequirements: boolean;
    inputs: VerificationInputs | null;
  };
};

/**
 * Tell a producer what its verifier found. The previous delivery was judged and failed; this run exists
 * to fix exactly those checks, so they lead the prompt's task-specific instructions.
 */
function buildReworkInstructions(rework: BuildTaskExecutionPromptInput["rework"]): string[] {
  if (!rework || rework.length === 0) {
    return [];
  }
  return [
    "## Rework Requested",
    "",
    "Your previous delivery was verified and did not pass. Fix every check below in the existing work, then deliver again;",
    "the verifier will check a fresh snapshot of your new output against the same requirements.",
    ...rework.flatMap((entry) => [
      "",
      `${entry.verifierTitle}, verification round ${entry.round}:`,
      ...entry.failedChecks.map((check) => `- \`${check.requirementId}\` (${check.outcome}): ${check.description} — evidence: ${check.evidence}`),
    ]),
    "",
  ];
}

/**
 * State the Verification Contract a run is under. A requirements producer declares the checks its
 * downstream verifier is judged against; a verifier gets the runtime's snapshots and the requirements,
 * and reports one check per requirement. The verdict is derived by the runtime from those checks, so the
 * prompt never asks for an overall pass/fail the agent could phrase optimistically.
 */
function buildVerificationInstructions(
  verification: BuildTaskExecutionPromptInput["verification"],
  languageName: string,
): string[] {
  if (!verification) {
    return [];
  }

  const lines: string[] = [];
  if (verification.producesRequirements) {
    lines.push(
      "## Verification Requirements",
      "",
      "A downstream task verifies the delivered work against the requirements you declare here, and cannot add or drop any.",
      "Add `payload.verification_requirements`: a non-empty array of `{ \"id\": \"...\", \"description\": \"...\" }`.",
      "Each `id` is a short unique slug. Each `description` states one observable condition the delivered output must meet,",
      `derived from this task and its accepted upstream handoffs, written in ${languageName}. Declare every condition that must hold for the work to count as done.`,
      "",
    );
  }

  if (verification.inputs) {
    lines.push(
      "## Verification Contract",
      "",
      "You verify upstream output. The runtime copied it into your workspace; verify these snapshots and nothing else:",
      ...verification.inputs.targets.map((target) => `- \`${target.path}\` (task ${target.taskId}, artifact ${target.artifactId})`),
      "Each snapshot holds `business-artifact.json`, the delivered artifact, and a `files/` directory when the producer delivered files.",
      "Do not modify the snapshots. If a check needs to build or run something, copy the files into a scratch directory first.",
      "",
      "Requirements:",
      ...verification.inputs.requirements.map((requirement) => `- \`${requirement.id}\`: ${requirement.description}`),
      "",
      "Report `payload.verification.checks` with exactly one entry per requirement:",
      JSON.stringify({ requirement_id: verification.inputs.requirements[0]?.id ?? "requirement-id", outcome: "passed", evidence: "..." }),
      "`outcome` is `passed`, `failed`, or `not_run`. `evidence` names the command output, file, or observation behind the outcome.",
      ...(verification.inputs.targets.length > 1
        ? ["When a check fails because of one target, add `target_task_id` naming it, so only that target is sent back for rework."]
        : []),
      "Use `not_run` when you could not perform a check — never `passed`. Leaving a requirement out fails validation.",
      "The runtime derives the overall verdict from these checks; do not state one of your own.",
      "",
    );
  }

  return lines;
}

/**
 * State the run's Agent Capability Grant, and forbid substituting priors for a capability it holds or
 * lacks.
 *
 * An agent that discovers a denial mid-run has no vocabulary for it and will invent one. That is not
 * hypothetical: a keyword research run met a silent `WebSearch` permission denial, reported it as "a
 * sandbox environment with no live keyword tooling", screened eight keywords from prior knowledge,
 * and submitted the result as a deliverable — which Automatic Acceptance passed. Naming the grant up
 * front is what makes "file a blocker instead" an instruction the agent can actually follow, and what
 * makes runtime refutation of a false capability claim fair (ADR 0021).
 */
function buildCapabilityGrantInstructions(grant: AgentCapabilityGrant | undefined): string[] {
  if (!grant) {
    return [];
  }

  return [
    "## Granted Capabilities",
    "",
    "This run holds exactly these capabilities, and nothing else:",
    ...grant.granted.map((capability) => `- ${describeRuntimeCapability(capability)}`),
    ...(grant.withheld.length > 0
      ? [
        "",
        "Refused by this company's Permission Mode:",
        ...grant.withheld.map((capability) => `- ${describeRuntimeCapability(capability)}`),
      ]
      : []),
    "",
    "This list is authoritative. It is not a sandbox limitation to work around, and the runtime knows what it granted.",
    "If the task cannot be done with what is listed, write `.auto-crop/business-artifact.json` as a `blocker` with",
    "`payload.blocker_class: \"environment_blocked\"` and `payload.capability` naming the missing capability.",
    "Do not substitute estimates, priors, or recalled figures for data a capability would have retrieved and then",
    "submit the result as a `deliverable`. Claiming a capability you were granted was unavailable fails the task.",
    "Where a finding rests on judgement rather than retrieved evidence, say so in `payload.validationLimits`.",
  ];
}

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
    recommended_option_index: number;
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
      recommended_option_index: 0,
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
      recommended_option_index: 0,
      rationale: "早期买家希望账单可预测，且当前用量差异仍然较小。",
      briefing:
        "我们针对访谈过的简历工具买家评估了三种定价形态。机会点在于以单份高质量成品完成转化的个人求职者；差异化在于无需注册、当次会话即可交付。变现方式是在价值兑现的节点提供低摩擦的付费解锁，而只有统一月费这种形态是这些买家能够预估的。",
    },
  },
};

export function buildTaskExecutionPrompt(input: BuildTaskExecutionPromptInput): string {
  const { company, task, handoffs, grant } = input;
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
          report_version: 2,
          execution_report: { ...examples.executionReport, work_summary: "Describe the work actually performed, including alternatives explored and checks run.", evidence: "Identify the observations, results and source references that support the conclusion; distinguish limitations and assumptions." },
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
    "Every `deliverable` and `final_report` payload must include `execution_report` with six fields:",
    `\`work_summary\`, \`evidence\`, \`conclusion\`, \`vision_impact\`, \`remaining_gap\`, and \`recommendation\`. Write each one in ${languageName}`,
    "as a founder-readable report: what you actually did, what you found, why the evidence supports your judgement, and what happens next. Do not substitute generic claims for concrete observations. Do not invent work or evidence.",
    "",
    `Also include \`outcome_summary\`, written in ${languageName}, for compatibility with older CEO Office readers.`,
    "It should be a plain-language string that combines the same conclusion, vision impact, remaining gap, and",
    "recommendation. Missing or malformed `execution_report` fails validation, and a missing `outcome_summary`",
    "still fails validation.",
    "",
    "## Actions You Take",
    "",
    "Declare `payload.actions`: every external or sensitive action this run performed, or asks approval to perform now.",
    "Use `[]` when there is none — that is the normal case for research, planning, writing and local implementation work.",
    JSON.stringify([{ category: "search_engine_submission", status: "performed", description: "Submitted the sitemap.", target: "example.com" }]),
    `\`category\` is one of: ${actionIntentCategories.join(", ")}.`,
    "`status` is `performed` (this run did it), `requested` (the work is blocked until someone approves and does it now),",
    "or `considered` (a later step, a limitation, or something deliberately not done).",
    "Naming a service in your report is not an action: \"we have no Search Console access yet\" or \"submit the sitemap after launch\"",
    "is `considered`, or not an entry at all. Only what this run actually did, or needs done now, is `performed` or `requested`.",
    "This declaration is what routes work to the founder, so an action left undeclared is one nobody was asked about.",
    "It does not grant anything: an action still needs the capability and the approval it always did.",
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
        recommended_option_index: examples.openDecision.recommended_option_index,
        rationale: examples.openDecision.rationale,
        briefing: examples.openDecision.briefing,
      },
      null,
      2,
    ),
    "`decisionKind` must be one of the five kinds above (any other choice is your own call and is ignored).",
    "Give more than one option, each with its trade-offs; set `recommended_option_index` to the zero-based index",
    "of the option you recommend, and give your rationale. Do not repeat the option label as the reference;",
    "the index is the reference.",
    "`briefing` is required: the substance the founder needs to decide from the card alone — what you",
    "explored, where the opportunity is, what is differentiated, the monetization angle and why these",
    "options exist. An entry missing `briefing` fails validation, exactly like a missing `rationale`.",
    `Write every \`label\`, \`tradeoffs\`, \`rationale\`, and \`briefing\` in ${languageName}.`,
    "A choice on one of these kinds is the founder's to make, not yours.",
  ];
  const proofInstructions = buildProofContractInstructions(task);
  const grantInstructions = buildCapabilityGrantInstructions(grant);
  const verificationInstructions = buildVerificationInstructions(input.verification, languageName);
  const reworkInstructions = buildReworkInstructions(input.rework);
  const basePrompt = [
    ...companyContext,
    task.description,
    "",
    ...reworkInstructions,
    ...(grantInstructions.length > 0 ? [...grantInstructions, ""] : []),
    ...artifactInstructions,
    "",
    ...verificationInstructions,
    ...proofInstructions,
  ];

  if (handoffs.length === 0) {
    return basePrompt.join("\n");
  }
  const snapshotPaths = new Map(input.verification?.inputs?.targets.map((target) => [target.taskId, target.path]) ?? []);

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
      // A verification target is read from its snapshot, never from the producer's live workspace.
      ...(snapshotPaths.has(handoff.upstreamTaskId)
        ? [`   Verification Snapshot: ${snapshotPaths.get(handoff.upstreamTaskId)}`]
        : handoff.artifactWorkspacePath ? [`   Artifact Workspace: ${handoff.artifactWorkspacePath}`] : []),
    ]),
  ].join("\n");
}
