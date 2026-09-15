import { describe, expect, it } from "vitest";
import type { Company, Task } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest } from "../adapters/types";
import { executionBriefOutputSchema, prepareExecutionBrief } from "./executionBrief";

const request: AgentRunRequest = {
  taskId: "task_1",
  prompt: "",
  promptPath: "",
  workspacePath: "/tmp/workspace",
  metadata: {},
};

describe("prepareExecutionBrief", () => {
  /**
   * The reported failure. A Chinese-locale brief quoted a phrase in a prose field, the model emitted
   * a bare `"` inside a JSON string, and the whole task failed before any research ran. Pinned as a
   * literal because the exact byte sequence is the bug (ADR 0022).
   */
  it("declares an output contract the CLI can enforce, so quoted prose cannot break the reply", async () => {
    const adapter = adapterReturning(
      '{"purpose":"明确切入哪个关键词。","approach":"调研候选词。","expectedOutcome":"支持\\"做哪个网站\\"的决策。"}',
    );

    const { result, brief } = await prepareExecutionBrief({
      adapter: adapter.agent,
      request,
      company: createCompany("zh"),
      task: createTask(),
      handoffs: [],
    });

    expect(adapter.lastRequest?.outputSchema).toEqual(executionBriefOutputSchema);
    expect(result.status).toBe("complete");
    expect(brief?.expectedOutcome).toEqual({ zh: '支持"做哪个网站"的决策。' });
  });

  it("launches the planning run holding no capabilities at all", async () => {
    const adapter = adapterReturning('{"purpose":"p","approach":"a","expectedOutcome":"e"}');

    await prepareExecutionBrief({
      adapter: adapter.agent,
      request,
      company: createCompany("en"),
      task: createTask(),
      handoffs: [],
    });

    expect(adapter.lastRequest?.grant?.granted).toEqual([]);
  });

  /**
   * The contract makes this rare, not impossible — a CLI that ignored the schema must not read as a
   * valid brief. What it must not do is blame the agent: the process exited 0 and answered.
   */
  it("reports unreadable output as the runtime's contract failure, not as an agent failure", async () => {
    // The exact shape that failed: an unescaped ASCII quote inside a JSON string value.
    const adapter = adapterReturning(
      '{"purpose":"p","approach":"a","expectedOutcome":"支持"做哪个网站"的决策。"}',
    );

    const { result, brief } = await prepareExecutionBrief({
      adapter: adapter.agent,
      request,
      company: createCompany("zh"),
      task: createTask(),
      handoffs: [],
    });

    expect(brief).toBeNull();
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("invalid_agent_output");
    expect(result.failureReason).not.toBe("agent_failed");
    expect(result.stderr).toContain("substantive work was not dispatched");
  });

  it("rejects a structurally valid reply that leaves a required field empty", async () => {
    const adapter = adapterReturning('{"purpose":"p","approach":"   ","expectedOutcome":"e"}');

    const { result } = await prepareExecutionBrief({
      adapter: adapter.agent,
      request,
      company: createCompany("en"),
      task: createTask(),
      handoffs: [],
    });

    expect(result.failureReason).toBe("invalid_agent_output");
  });
});

function adapterReturning(stdout: string): { agent: AgentAdapter; lastRequest?: AgentRunRequest } {
  const state: { agent: AgentAdapter; lastRequest?: AgentRunRequest } = {
    agent: {
      id: "fake",
      name: "Fake",
      capabilities: ["research"],
      detect: async () => true,
      run: async (received) => {
        state.lastRequest = received;
        return { status: "complete", exitCode: 0, stdout, stderr: "" };
      },
    },
  };

  return state;
}

function createCompany(locale: Company["locale"]): Company {
  return {
    id: "company_1",
    name: "MATT",
    founderVision: "Find an English SEO opportunity and ship a small web product.",
    playbookId: "ai-saas",
    permissionMode: "balanced",
    locale,
    status: "active",
  } as Company;
}

function createTask(): Task {
  return {
    id: "task_1",
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    title: "Research overseas keyword and competitor opportunity",
    description: "Find keyword clusters with manageable competition.",
    assigneeAgentId: "fake",
    requiredCapabilities: ["research", "writing"],
    proofSchemaId: "research-report",
    workspacePath: null,
    status: "running",
    riskLevel: "low",
    position: 0,
  } as Task;
}
