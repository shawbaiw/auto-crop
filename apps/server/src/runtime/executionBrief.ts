import type { Company, ExecutionBrief, Task } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "../adapters/types";
import type { TaskHandoff } from "./dependencyReadiness";

/** Preparation is a separate run: a brief is durable before the work prompt is dispatched. */
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
  try {
    const value = JSON.parse(result.stdout.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? result.stdout.trim());
    const fields = ["purpose", "approach", "expectedOutcome"] as const;
    if (fields.some(key => typeof value?.[key] !== "string" || !value[key].trim())) throw new Error("Incomplete brief");
    return { result, brief: Object.fromEntries(fields.map(key => [key, { [input.company.locale]: value[key].trim() }])) as ExecutionBrief };
  } catch {
    return { brief: null, result: { ...result, status: "failed", failureReason: "agent_failed", stderr: "The agent did not return a valid execution brief; substantive work was not dispatched." } };
  }
}
