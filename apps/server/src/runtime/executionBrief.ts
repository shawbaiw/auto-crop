import type { Company, ExecutionBrief, Task } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "../adapters/types";
import { noToolGrant } from "../policies/capabilityGrant";
import type { TaskHandoff } from "./dependencyReadiness";

const EXECUTION_BRIEF_FIELDS = ["purpose", "approach", "expectedOutcome"] as const;
const KNOWN_NON_JSON_STATUS_STDOUT = new Set([
  "Structured output submitted.",
  "Planning brief submitted -- no execution performed.",
]);

/**
 * The Structured Output Contract for an Execution Brief.
 *
 * Asking for JSON in the prompt was not enough. A Chinese-locale brief quoted a phrase inside a
 * prose field — `支持"做哪个网站"的决策` — the model emitted a bare `"` inside a JSON string, and
 * `JSON.parse` threw. The task failed as `agent_failed` on a run that exited 0, and the substantive
 * research was never dispatched. Chinese prose quotes phrases routinely, so this was not bad luck;
 * the previous run survived only because it happened to reach for `'` instead. See ADR 0022.
 */
export const executionBriefOutputSchema: Record<string, unknown> = {
  type: "object",
  properties: Object.fromEntries(EXECUTION_BRIEF_FIELDS.map((field) => [field, { type: "string" }])),
  required: [...EXECUTION_BRIEF_FIELDS],
  additionalProperties: false,
};

/** Preparation is a separate run: a brief is durable before the work prompt is dispatched. */
/**
 * The brief's own budget. It is a short planning reply, not the work, and it is capped independently
 * of the task's execution profile — which is why a failure here cannot be reported, or retried, as a
 * failure of the task's budget (ADR 0032).
 */
export const EXECUTION_BRIEF_TIMEOUT_MS = 60_000;

export type ExecutionBriefPreparation =
  | {
      kind: "structured";
      result: AgentRunResult;
      brief: ExecutionBrief;
    }
  | {
      kind: "degraded";
      result: AgentRunResult;
      brief: ExecutionBrief;
      warning: string;
      cause: "unsupported_adapter_capability" | "unreadable_structured_output";
    }
  | {
      kind: "failed";
      result: AgentRunResult;
      brief: null;
    };

export async function prepareExecutionBrief(input: {
  adapter: AgentAdapter;
  request: AgentRunRequest;
  company: Company;
  task: Task;
  handoffs: TaskHandoff[];
}): Promise<ExecutionBriefPreparation> {
  if (!input.adapter.contractCapabilities?.includes("structured_execution_brief")) {
    return {
      kind: "degraded",
      result: {
        status: "complete",
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      brief: createMinimalExecutionBrief(input.company, input.task),
      warning: `${input.adapter.name} does not declare structured execution brief support; using runtime minimal brief.`,
      cause: "unsupported_adapter_capability",
    };
  }

  const language = input.company.locale === "zh" ? "Chinese" : "English";
  const result = await input.adapter.run({
    ...input.request,
    // "Do not use tools" below is enforced, not requested: this run is launched holding none.
    grant: noToolGrant,
    // Likewise "Return only JSON": the CLI enforces the shape, the prompt only explains it.
    outputSchema: executionBriefOutputSchema,
    metadata: { ...input.request.metadata, phase: "execution_brief", locale: input.company.locale },
    prompt: [
      "Prepare a founder-facing execution brief. This is a planning-only run.",
      "Do not execute the task, use tools, search, modify files, or produce a deliverable yet.",
      `Write in ${language}. Return only JSON with non-empty string fields: purpose, approach, expectedOutcome.`,
      "purpose: the specific question or outcome this task will address.",
      "approach: the concrete inputs, methods, comparison criteria or checks you plan to use, specific to this task.",
      "expectedOutcome: the deliverable and conditions by which its completion will be judged.",
      "Describe intentions honestly; do not claim you have already performed work or verified evidence.",
      `Founder vision: ${input.company.founderVision}`,
      `Task: ${input.task.title}\n${input.task.description}`,
      `Accepted upstream handoffs: ${JSON.stringify(input.handoffs)}`,
    ].join("\n\n"),
  });
  if (result.status !== "complete") return { kind: "failed", result, brief: null };
  // The contract makes this parse reliable rather than redundant: it still has to run, and a CLI
  // that silently ignored the schema must not be read as a valid brief.
  try {
    const value = JSON.parse(result.stdout.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? result.stdout.trim());
    const fields = EXECUTION_BRIEF_FIELDS;
    if (fields.some(key => typeof value?.[key] !== "string" || !value[key].trim())) throw new Error("Incomplete brief");
    return {
      kind: "structured",
      result,
      brief: Object.fromEntries(fields.map(key => [key, { [input.company.locale]: value[key].trim() }])) as ExecutionBrief,
    };
  } catch (error) {
    if (KNOWN_NON_JSON_STATUS_STDOUT.has(result.stdout.trim())) {
      return {
        kind: "degraded",
        result,
        brief: createMinimalExecutionBrief(input.company, input.task),
        warning: `${input.adapter.name} did not return readable structured brief output; using runtime minimal brief.`,
        cause: "unreadable_structured_output",
      };
    }
    // `invalid_agent_output`, not `agent_failed`: the process exited 0 and did what it was asked.
    // What broke is the runtime's own contract, and naming it that way is what stops the next
    // person reading this failure from going to look at the agent.
    return {
      kind: "failed",
      brief: null,
      result: {
        ...result,
        status: "failed",
        failureReason: "invalid_agent_output",
        stderr: `The agent's execution brief did not satisfy the runtime's output contract (${(error as Error).message}); substantive work was not dispatched.`,
      },
    };
  }
}

function createMinimalExecutionBrief(company: Company, task: Task): ExecutionBrief {
  if (company.locale === "zh") {
    return {
      purpose: { zh: `为 ${company.name} 完成“${task.title}”。` },
      approach: { zh: "使用任务描述、创始人愿景、已接受的上游交接和已授予能力，产出所需证明。" },
      expectedOutcome: { zh: `一份符合证明模式 ${task.proofSchemaId} 的交付物。` },
    };
  }

  return {
    purpose: { en: `Complete "${task.title}" for ${company.name}.` },
    approach: {
      en: "Use the task description, founder vision, accepted upstream handoffs, and granted capabilities to produce the required proof.",
    },
    expectedOutcome: { en: `A deliverable matching proof schema ${task.proofSchemaId}.` },
  };
}
