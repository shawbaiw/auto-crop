import type { Company, ExecutionBrief, Task } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "../adapters/types";
import { noToolGrant } from "../policies/capabilityGrant";
import type { TaskHandoff } from "./dependencyReadiness";

const EXECUTION_BRIEF_FIELDS = ["purpose", "approach", "expectedOutcome"] as const;

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

export async function prepareExecutionBrief(input: {
  adapter: AgentAdapter;
  request: AgentRunRequest;
  company: Company;
  task: Task;
  handoffs: TaskHandoff[];
}): Promise<{ result: AgentRunResult; brief: ExecutionBrief | null }> {
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
  if (result.status !== "complete") return { result, brief: null };
  // The contract makes this parse reliable rather than redundant: it still has to run, and a CLI
  // that silently ignored the schema must not be read as a valid brief.
  try {
    const value = JSON.parse(result.stdout.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? result.stdout.trim());
    const fields = EXECUTION_BRIEF_FIELDS;
    if (fields.some(key => typeof value?.[key] !== "string" || !value[key].trim())) throw new Error("Incomplete brief");
    return { result, brief: Object.fromEntries(fields.map(key => [key, { [input.company.locale]: value[key].trim() }])) as ExecutionBrief };
  } catch (error) {
    // `invalid_agent_output`, not `agent_failed`: the process exited 0 and did what it was asked.
    // What broke is the runtime's own contract, and naming it that way is what stops the next
    // person reading this failure from going to look at the agent.
    return {
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
