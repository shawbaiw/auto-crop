import { writeFileSync } from "node:fs";
import {
  parseFinalFounderReportOutput,
  resolveLocalizedText,
  type BusinessArtifact,
  type Company,
  type Department,
  type FinalFounderReport,
  type FinalFounderReportClassification,
  type FounderDecision,
  type HumanAction,
  type KeyResult,
  type Objective,
  type Task,
  type TaskCompletionEvent,
  type VisionGap,
  type WaitState,
} from "@auto-crop/core";
import type { AgentAdapter } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import { defaultAgentSessionManager, type AgentSessionManager } from "./agentSessions";
import { resolveEffectiveTimeoutForProfileName } from "./executionProfile";
import { createDefaultId } from "./ids";
import { resolveAgentSessionPolicy } from "./sessionPolicy";
import { createCompanyWorkspace } from "./workspace";

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
  visionGaps: VisionGap[];
  waitStates: WaitState[];
  humanActions: HumanAction[];
  founderDecisions: FounderDecision[];
  agentSessionManager?: AgentSessionManager;
  agentSessionEnv?: Record<string, string | undefined>;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

/**
 * Author a Final Founder Report by running the company's selected CEO Agent, mirroring
 * `generateCompanyBlueprint`: a built prompt, the company workspace, an `agentSessionManager.run`,
 * and a parsed structured payload. Persists the result as the company's `isCurrent`
 * `founder_reports` record with `generatedBy: ceo_agent` and returns it.
 *
 * Generation is synchronous in the scheduler tick for this ticket; the async job, the "preparing"
 * state, the deterministic fallback, and version supersession land in later tickets.
 */
export async function generateFinalFounderReport(
  input: GenerateFinalFounderReportInput,
): Promise<FinalFounderReport> {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? createDefaultId;
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

  const output = parseFinalFounderReportOutput(agentRun.result.stdout);
  const timestamp = now().toISOString();
  const report: FinalFounderReport = {
    id: createId("founder_report"),
    companyId: input.company.id,
    // The classification is the runtime's computed value (a fixed core enum), not the agent's echo —
    // the dashboard and the report share one derived source. The agent authors only the prose.
    classification: input.classification,
    sections: output.sections,
    generatedBy: "ceo_agent",
    isCurrent: true,
    supersedesReportId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  input.repositories.createFinalFounderReport(report);
  return report;
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
