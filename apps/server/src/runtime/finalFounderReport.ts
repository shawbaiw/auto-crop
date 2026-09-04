import { writeFileSync } from "node:fs";
import {
  localizedTextFromString,
  parseFinalFounderReportOutput,
  resolveLocalizedText,
  type BusinessArtifact,
  type Company,
  type CompleteLocalizedText,
  type Department,
  type FinalFounderReport,
  type FinalFounderReportClassification,
  type FinalFounderReportSections,
  type FounderDecision,
  type HumanAction,
  type KeyResult,
  type LocalizedText,
  type Objective,
  type Task,
  type TaskCompletionEvent,
  type TaskDependency,
  type VisionGap,
  type WaitState,
} from "@auto-crop/core";
import type { AgentAdapter } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import { defaultAgentSessionManager, type AgentSessionManager } from "./agentSessions";
import { resolveEffectiveTimeoutForProfileName } from "./executionProfile";
import { summarizeFounderReport, type FounderReportProjection } from "./founderReportProjection";
import { createDefaultId } from "./ids";
import { runtimeText } from "./localizedRuntimeText";
import { resolveAgentSessionPolicy } from "./sessionPolicy";
import { createCompanyWorkspace } from "./workspace";

/**
 * The authoring-run ceiling for a Final Founder Report, reusing the Bounded Recovery pattern (a fixed
 * attempt count, then a terminal fallback). After this many failed or unparseable CEO Agent runs the
 * runtime stops retrying and assembles a deterministic report instead, so a generation failure never
 * leaves the founder without a report.
 */
export const MAX_FINAL_REPORT_AUTHORING_ATTEMPTS = 3;

export type GenerateFinalFounderReportInput = {
  projectRoot: string;
  repositories: ReturnType<typeof createRepositories>;
  company: Company;
  classification: FinalFounderReportClassification;
  ceoAgent: AgentAdapter;
  tasks: Task[];
  departments: Department[];
  objectives: Objective[];
  keyResults: KeyResult[];
  taskCompletionEvents: TaskCompletionEvent[];
  businessArtifacts: BusinessArtifact[];
  taskDependencies: TaskDependency[];
  visionGaps: VisionGap[];
  waitStates: WaitState[];
  humanActions: HumanAction[];
  founderDecisions: FounderDecision[];
  agentSessionManager?: AgentSessionManager;
  agentSessionEnv?: Record<string, string | undefined>;
  /** Override the authoring-run ceiling (tests). Defaults to {@link MAX_FINAL_REPORT_AUTHORING_ATTEMPTS}. */
  maxAuthoringAttempts?: number;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

/**
 * Author a Final Founder Report by running the company's selected CEO Agent, mirroring
 * `generateCompanyBlueprint`: a built prompt, the company workspace, an `agentSessionManager.run`,
 * and a parsed structured payload. Retries the authoring run to
 * {@link MAX_FINAL_REPORT_AUTHORING_ATTEMPTS}; on exhaustion it assembles a deterministic report
 * from the shared `summarizeFounderReport` projection instead, so a generation failure never leaves
 * the founder without a report. Persists the result as the company's `isCurrent` `founder_reports`
 * record — `generatedBy: ceo_agent` when the agent authored it, `deterministic_fallback` otherwise —
 * and returns it.
 *
 * Generation is synchronous in the scheduler tick for this ticket; the async job, the "preparing"
 * state, and version supersession land in later tickets.
 */
export async function generateFinalFounderReport(
  input: GenerateFinalFounderReportInput,
): Promise<FinalFounderReport> {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? createDefaultId;
  const ceiling = Math.max(1, input.maxAuthoringAttempts ?? MAX_FINAL_REPORT_AUTHORING_ATTEMPTS);

  let sections: FinalFounderReportSections | null = null;
  let generatedBy: FinalFounderReport["generatedBy"] = "ceo_agent";

  for (let attempt = 1; attempt <= ceiling; attempt += 1) {
    try {
      sections = await authorFinalFounderReportSections(input);
      break;
    } catch {
      // Retry to the ceiling; on exhaustion the loop exits with `sections` still null and the
      // deterministic fallback below fills it. Agent-run history is preserved for diagnosis.
    }
  }

  if (!sections) {
    sections = buildDeterministicFinalFounderReportSections(input);
    generatedBy = "deterministic_fallback";
  }

  const timestamp = now().toISOString();
  const report: FinalFounderReport = {
    id: createId("founder_report"),
    companyId: input.company.id,
    // The classification is the runtime's computed value (a fixed core enum), not the agent's echo —
    // the dashboard and the report share one derived source. The agent authors only the prose.
    classification: input.classification,
    sections,
    generatedBy,
    isCurrent: true,
    supersedesReportId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  input.repositories.createFinalFounderReport(report);
  return report;
}

/**
 * One authoring attempt: build the prompt, run the CEO Agent in the company workspace, and parse the
 * structured payload. Throws on a non-`complete` run or an unparseable payload — the caller counts
 * that as a failed attempt.
 */
async function authorFinalFounderReportSections(
  input: GenerateFinalFounderReportInput,
): Promise<FinalFounderReportSections> {
  const companyWorkspace = createCompanyWorkspace(input.projectRoot, input.company.id);
  const prompt = buildFinalFounderReportPrompt(input);
  const promptPath = `${companyWorkspace.companyRoot}/final-founder-report-prompt.md`;
  writeFileSync(promptPath, prompt, "utf8");

  const sessionPolicy = resolveAgentSessionPolicy({
    companyId: input.company.id,
    agentId: input.ceoAgent.id,
    permissionMode: input.company.permissionMode,
    purpose: "ceo_blueprint",
    env: input.agentSessionEnv,
  });
  const agentRun = await (input.agentSessionManager ?? defaultAgentSessionManager).run({
    adapter: input.ceoAgent,
    request: {
      taskId: `${input.company.id}_final_founder_report`,
      prompt,
      promptPath,
      workspacePath: companyWorkspace.companyRoot,
      metadata: { classification: input.classification },
      timeoutMs: resolveEffectiveTimeoutForProfileName("long").effectiveTimeoutMs,
    },
    sessionKey: sessionPolicy.status === "enabled" ? sessionPolicy.key : null,
  });

  if (agentRun.result.status !== "complete") {
    const detail = agentRun.result.stderr.trim() || agentRun.result.stdout.trim() || "No agent output.";
    throw new Error(`CEO agent failed to author the Final Founder Report: ${detail}`);
  }

  return parseFinalFounderReportOutput(agentRun.result.stdout).sections;
}

type DeterministicReportInput = Pick<
  GenerateFinalFounderReportInput,
  | "company"
  | "classification"
  | "tasks"
  | "departments"
  | "keyResults"
  | "taskCompletionEvents"
  | "businessArtifacts"
  | "taskDependencies"
  | "visionGaps"
  | "waitStates"
  | "humanActions"
>;

/**
 * Assemble the six report sections deterministically from the shared `summarizeFounderReport`
 * projection — the same factual layer behind the API's `founderReport` field. Every factual section
 * (vision, department contributions, remaining gaps) is populated from projection data; the
 * synthesis sections (`actualResult`, `goalFit`, `recommendedNextStep`) are filled from templates
 * over Task Outcome Summaries and Vision Gaps rather than agent prose. Keyed to the same computed
 * classification the authored report would carry.
 */
export function buildDeterministicFinalFounderReportSections(
  input: DeterministicReportInput,
): FinalFounderReportSections {
  const projection = summarizeFounderReport(
    input.company,
    input.tasks,
    input.businessArtifacts,
    input.waitStates,
    input.humanActions,
    input.visionGaps,
    input.taskDependencies,
    input.departments,
  );

  return {
    vision: localizedTextFromString(projection.founderVision),
    actualResult: deterministicActualResult(input, projection),
    departmentContributions: deterministicDepartmentContributions(projection),
    goalFit: deterministicGoalFit(input),
    remainingGaps: deterministicRemainingGaps(projection),
    recommendedNextStep: deterministicRecommendedNextStep(input, projection),
  };
}

function deterministicActualResult(
  input: DeterministicReportInput,
  projection: FounderReportProjection,
): CompleteLocalizedText {
  const total = input.tasks.length;
  const completed = projection.completedTaskCount;
  const blocked = projection.blockedTaskCount;
  const accepted = projection.actualOutputs.length;
  const outcomeSummaries = input.taskCompletionEvents
    .filter((event) => event.outcome === "accepted" && event.outcomeSummaryText)
    .map((event) => event.outcomeSummaryText as LocalizedText);

  const en = [
    `${completed} of ${total} tasks completed and ${blocked} ended blocked; ${accepted} business artifact(s) were accepted.`,
    outcomeSummaries.length > 0
      ? `Delivered outcomes: ${outcomeSummaries.map((text) => resolveLocalizedText(text, "en")).join(" ")}`
      : "No Task Outcome Summaries were recorded for the completed work.",
  ].join(" ");
  const zh = [
    `${total} 项任务中完成 ${completed} 项，另有 ${blocked} 项处于受阻状态；共验收 ${accepted} 项业务成果。`,
    outcomeSummaries.length > 0
      ? `已交付成果：${outcomeSummaries.map((text) => resolveLocalizedText(text, "zh")).join(" ")}`
      : "已完成的工作没有记录任务成果摘要。",
  ].join(" ");

  return runtimeText(en, zh);
}

function deterministicDepartmentContributions(
  projection: FounderReportProjection,
): CompleteLocalizedText[] {
  if (projection.departmentContributions.length === 0) {
    return [runtimeText("No department activity was recorded.", "没有记录任何部门活动。")];
  }
  return projection.departmentContributions.map((department) => {
    const en =
      `${department.departmentName}: ${department.completedTaskCount} task(s) completed, ` +
      `${department.acceptedOutputCount} output(s) accepted` +
      (department.blockedTaskCount > 0 ? `, ${department.blockedTaskCount} blocked` : "") +
      (department.visionGapCount > 0 ? `, ${department.visionGapCount} open gap(s)` : "") +
      ".";
    const zh =
      `${department.departmentName}：完成 ${department.completedTaskCount} 项任务，` +
      `验收 ${department.acceptedOutputCount} 项产出` +
      (department.blockedTaskCount > 0 ? `，${department.blockedTaskCount} 项受阻` : "") +
      (department.visionGapCount > 0 ? `，${department.visionGapCount} 项待补差距` : "") +
      "。";
    return runtimeText(en, zh);
  });
}

function deterministicGoalFit(input: DeterministicReportInput): CompleteLocalizedText {
  const total = input.keyResults.length;
  const met = input.keyResults.filter((keyResult) => keyResult.status === "met").length;
  const unmet = input.keyResults.filter((keyResult) => keyResult.status !== "met");

  const classificationEn: Record<FinalFounderReportClassification, string> = {
    achieved: "The objectives were achieved.",
    stalled: "The company stalled with goals unmet and no path forward without new work.",
    waiting: "The remaining goals depend on items still open on the founder.",
  };
  const classificationZh: Record<FinalFounderReportClassification, string> = {
    achieved: "目标已达成。",
    stalled: "公司陷入停滞，目标未达成，且没有新的工作就无法推进。",
    waiting: "剩余目标取决于仍需创始人处理的事项。",
  };

  const en =
    `${met} of ${total} key results met.` +
    (unmet.length > 0 ? ` Not yet met: ${unmet.map((keyResult) => keyResult.title).join(", ")}.` : "") +
    ` ${classificationEn[input.classification]}`;
  const zh =
    `${total} 项关键结果中已达成 ${met} 项。` +
    (unmet.length > 0 ? ` 尚未达成：${unmet.map((keyResult) => keyResult.title).join("、")}。` : "") +
    ` ${classificationZh[input.classification]}`;

  return runtimeText(en, zh);
}

function deterministicRemainingGaps(projection: FounderReportProjection): CompleteLocalizedText {
  if (projection.visionGaps.length === 0) {
    return runtimeText(
      "No open Vision Gaps were recorded. 'All tasks done' does not by itself mean the vision is achieved — review the goal fit above.",
      "没有记录任何未解决的愿景差距。“所有任务完成”本身并不代表愿景已达成——请参阅上文的目标契合度。",
    );
  }
  const en = `Open Vision Gaps: ${projection.visionGaps
    .map((gap) => `${gap.label} (${gap.severity})`)
    .join("; ")}.`;
  const zh = `未解决的愿景差距：${projection.visionGaps
    .map((gap) => `${gap.label}（${gap.severity}）`)
    .join("；")}。`;
  return runtimeText(en, zh);
}

function deterministicRecommendedNextStep(
  input: DeterministicReportInput,
  projection: FounderReportProjection,
): CompleteLocalizedText {
  if (input.classification === "waiting" && projection.waitStates.length > 0) {
    const en = `The company is waiting on external timers. Next check-ins: ${projection.waitStates
      .map((waitState) => `${waitState.label} — ${waitState.nextCheckAt}`)
      .join("; ")}.`;
    const zh = `公司正在等待外部计时器。下次检查：${projection.waitStates
      .map((waitState) => `${waitState.label} — ${waitState.nextCheckAt}`)
      .join("；")}。`;
    return runtimeText(en, zh);
  }
  if (projection.nextSteps.length > 0) {
    const en = `Recommended next steps: ${projection.nextSteps.join(" ")}`;
    const zh = `建议的下一步：${projection.nextSteps.join(" ")}`;
    return runtimeText(en, zh);
  }
  return runtimeText(
    "No outstanding actions. Review the outcomes above and decide whether to extend the company with new work.",
    "没有待办事项。请查看上述成果，并决定是否为公司安排新的工作。",
  );
}

export function buildFinalFounderReportPrompt(input: GenerateFinalFounderReportInput): string {
  const departmentById = new Map(input.departments.map((department) => [department.id, department]));
  const keyResultsByObjectiveId = new Map<string, KeyResult[]>();
  for (const keyResult of input.keyResults) {
    keyResultsByObjectiveId.set(keyResult.objectiveId, [
      ...(keyResultsByObjectiveId.get(keyResult.objectiveId) ?? []),
      keyResult,
    ]);
  }
  const latestOutcomeByTaskId = new Map<string, TaskCompletionEvent>();
  for (const event of input.taskCompletionEvents) {
    latestOutcomeByTaskId.set(event.taskId, event);
  }
  const acceptedArtifactByTaskId = new Map(
    input.businessArtifacts
      .filter((artifact) => artifact.isCurrent && artifact.reviewStatus === "accepted")
      .map((artifact) => [artifact.taskId, artifact]),
  );

  const lines: string[] = [
    "# Final Founder Report",
    "",
    "You are the CEO Office. Every task the founder handed to the departments has finished or is",
    "parked on the founder — the company has no forward move left. Write the founder a single closing",
    "report in plain business language: what the vision was, what was actually produced, what each",
    "department contributed, how the result fits the goals, what gaps remain, and one recommended",
    "next step.",
    "",
    `## Computed Classification`,
    input.classification,
    "Use this exact classification value in your output.",
    "",
    "## Founder Vision",
    input.company.founderVision,
    "",
    "## Objectives And Key Results",
  ];
  for (const objective of input.objectives) {
    lines.push(`- Objective: ${objective.title} (status ${objective.status})`);
    for (const keyResult of keyResultsByObjectiveId.get(objective.id) ?? []) {
      lines.push(
        `  - Key Result: ${keyResult.title} — ${keyResult.metricName}: ${keyResult.currentValue} / target ${keyResult.targetValue} (status ${keyResult.status})`,
      );
    }
  }

  lines.push("", "## Departments, Tasks, And Outcomes");
  for (const department of input.departments) {
    lines.push(`### ${department.name}`, department.responsibility);
    const departmentTasks = input.tasks.filter((task) => task.departmentId === department.id);
    if (departmentTasks.length === 0) {
      lines.push("- (no tasks)");
    }
    for (const task of departmentTasks) {
      lines.push(`- Task: ${task.title} (status ${task.status})`);
      lines.push(`  Description: ${task.description}`);
      const outcome = latestOutcomeByTaskId.get(task.id);
      if (outcome?.outcomeSummaryText) {
        lines.push(`  Task Outcome Summary: ${resolveLocalizedText(outcome.outcomeSummaryText, "en")}`);
      } else if (task.status === "blocked" || task.status === "failed") {
        lines.push(`  Execution failure: ${task.latestFailureReason ?? "unknown"} / ${task.latestFailureMessage ?? ""}`);
      }
      const artifact = acceptedArtifactByTaskId.get(task.id);
      if (artifact) {
        lines.push(`  Accepted Business Artifact payload: ${JSON.stringify(artifact.payload)}`);
      }
    }
  }

  lines.push("", "## Open Vision Gaps");
  if (input.visionGaps.length === 0) {
    lines.push("- None");
  }
  for (const gap of input.visionGaps) {
    lines.push(`- ${gap.label} (${gap.severity}) — ${departmentById.get(gap.departmentId)?.name ?? gap.departmentId}`);
  }

  lines.push("", "## Pending Items Waiting On The Founder");
  const pendingHumanActions = input.humanActions.filter((action) => action.status === "pending");
  const pendingFounderDecisions = input.founderDecisions.filter((decision) => decision.status === "pending");
  if (pendingHumanActions.length === 0 && pendingFounderDecisions.length === 0 && input.waitStates.length === 0) {
    lines.push("- None");
  }
  for (const action of pendingHumanActions) {
    lines.push(`- Human Action: ${action.label}`);
  }
  for (const decision of pendingFounderDecisions) {
    lines.push(`- Founder Decision: ${decision.decisionKind.replace(/_/g, " ")} — ${decision.rationale}`);
  }
  for (const waitState of input.waitStates) {
    lines.push(`- Wait State: ${waitState.label} — next check ${waitState.nextCheckAt}`);
  }
  if (input.classification === "waiting" && input.waitStates.length > 0) {
    lines.push(
      "",
      "The company is waiting only on external timers. Your recommended_next_step MUST name each",
      "pending Wait State above and its next-check date.",
    );
  }

  lines.push(
    "",
    "## Output Contract",
    "Return a fenced JSON block. The runtime parses only this block. Every section value is Localized",
    'Business Content: a `{ "en": "...", "zh": "..." }` object (provide both locales).',
    "`departmentContributions` is a list — one entry per department that did work.",
    "",
    "```json",
    JSON.stringify(
      {
        classification: input.classification,
        sections: {
          vision: { en: "The founder's original vision, restated.", zh: "复述创始人的原始愿景。" },
          actualResult: { en: "What was actually produced, in plain language.", zh: "实际产出的成果，用通俗语言描述。" },
          departmentContributions: [
            { en: "Department X: inputs it consumed and outputs it delivered.", zh: "X 部门：消耗的输入与交付的产出。" },
          ],
          goalFit: { en: "How the result fits the objectives and key results.", zh: "成果与目标和关键结果的契合度。" },
          remainingGaps: { en: "Remaining Vision Gaps between 'all tasks done' and 'vision achieved'.", zh: "任务全部完成与愿景达成之间尚存的差距。" },
          recommendedNextStep: { en: "One concrete recommended next step for the founder.", zh: "为创始人推荐的一个具体下一步。" },
        },
      },
      null,
      2,
    ),
    "```",
  );

  return lines.join("\n");
}
