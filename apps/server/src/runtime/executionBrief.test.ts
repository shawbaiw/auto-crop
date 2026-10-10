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

    const preparation = await prepareExecutionBrief({
      adapter: adapter.agent,
      request,
      company: createCompany("zh"),
      task: createTask(),
      handoffs: [],
    });

    expect(adapter.lastRequest?.outputSchema).toEqual(executionBriefOutputSchema);
    expect(preparation.kind).toBe("structured");
    expect(preparation.result.status).toBe("complete");
    expect(preparation.brief?.expectedOutcome).toEqual({ zh: '支持"做哪个网站"的决策。' });
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

  it("degrades to a minimal runtime brief when the adapter does not support structured execution briefs", async () => {
    const adapter = adapterReturning("must not be used", { structuredExecutionBrief: false });

    const preparation = await prepareExecutionBrief({
      adapter: adapter.agent,
      request,
      company: createCompany("en"),
      task: createTask(),
      handoffs: [],
    });

    expect(adapter.lastRequest).toBeUndefined();
    expect(preparation.kind).toBe("degraded");
    if (preparation.kind !== "degraded") throw new Error("Expected degraded preparation");
    expect(preparation.cause).toBe("unsupported_adapter_capability");
    expect(preparation.brief.purpose).toEqual({
      en: 'Complete "Research overseas keyword and competitor opportunity" for MATT.',
    });
    expect(preparation.result.status).toBe("complete");
  });

  it.each(["Structured output submitted.", "Planning brief submitted -- no execution performed."])(
    "degrades known adapter status stdout instead of failing the task: %s",
    async (stdout) => {
      const adapter = adapterReturning(stdout);

      const preparation = await prepareExecutionBrief({
        adapter: adapter.agent,
        request,
        company: createCompany("zh"),
        task: createTask(),
        handoffs: [],
      });

      expect(preparation.kind).toBe("degraded");
      if (preparation.kind !== "degraded") throw new Error("Expected degraded preparation");
      expect(preparation.cause).toBe("unreadable_structured_output");
      expect(preparation.brief.expectedOutcome.zh).toContain("research-report");
      expect(preparation.warning).toContain("did not return readable structured brief output");
    },
  );

  it("does not synthesize a brief when the preparation process fails", async () => {
    const adapter = adapterFailing();

    const preparation = await prepareExecutionBrief({
      adapter: adapter.agent,
      request,
      company: createCompany("en"),
      task: createTask(),
      handoffs: [],
    });

    expect(preparation.kind).toBe("failed");
    expect(preparation.brief).toBeNull();
    expect(preparation.result.failureReason).toBe("agent_failed");
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

    const preparation = await prepareExecutionBrief({
      adapter: adapter.agent,
      request,
      company: createCompany("zh"),
      task: createTask(),
      handoffs: [],
    });

    expect(preparation.kind).toBe("failed");
    expect(preparation.brief).toBeNull();
    expect(preparation.result.status).toBe("failed");
    expect(preparation.result.failureReason).toBe("invalid_agent_output");
    expect(preparation.result.failureReason).not.toBe("agent_failed");
    expect(preparation.result.stderr).toContain("substantive work was not dispatched");
  });

  it("rejects a structurally valid reply that leaves a required field empty", async () => {
    const adapter = adapterReturning('{"purpose":"p","approach":"   ","expectedOutcome":"e"}');

    const preparation = await prepareExecutionBrief({
      adapter: adapter.agent,
      request,
      company: createCompany("en"),
      task: createTask(),
      handoffs: [],
    });

    expect(preparation.kind).toBe("failed");
    expect(preparation.result.failureReason).toBe("invalid_agent_output");
  });
});

function adapterReturning(
  stdout: string,
  options: { structuredExecutionBrief?: boolean } = {},
): { agent: AgentAdapter; lastRequest?: AgentRunRequest } {
  const state: { agent: AgentAdapter; lastRequest?: AgentRunRequest } = {
    agent: {
      id: "fake",
      name: "Fake",
      capabilities: ["research"],
      contractCapabilities: options.structuredExecutionBrief === false ? ["artifact_envelope"] : ["structured_execution_brief", "artifact_envelope"],
      detect: async () => true,
      run: async (received) => {
        state.lastRequest = received;
        return { status: "complete", exitCode: 0, stdout, stderr: "" };
      },
    },
  };

  return state;
}

function adapterFailing(): { agent: AgentAdapter } {
  return {
    agent: {
      id: "fake",
      name: "Fake",
      capabilities: ["research"],
      contractCapabilities: ["structured_execution_brief", "artifact_envelope"],
      detect: async () => true,
      run: async () => ({ status: "failed", exitCode: 1, stdout: "", stderr: "launch failed", failureReason: "agent_failed" }),
    },
  };
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
