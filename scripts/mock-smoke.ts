import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Proof } from "@auto-crop/core";
import {
  aiSaasPlaybook,
  createApiServer,
  createDatabaseClient,
  createMockAgentAdapter,
  createRepositories,
  migrate,
  runCompanyReview,
  runSchedulerOnce,
} from "@auto-crop/server";

const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-mock-smoke-"));
const database = createDatabaseClient(":memory:");
let server: ReturnType<typeof createApiServer> | undefined;
let events: Awaited<ReturnType<typeof connectEvents>> | undefined;

try {
  migrate(database);
  const repositories = createRepositories(database);
  const blueprint = aiSaasPlaybook.createBlueprint({
    companyName: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    preferredEngineeringAgentId: "codex",
    preferredStrategyAgentId: "codex",
  });
  const agents = [
    createMockAgentAdapter({
      id: "codex",
      name: "Codex",
      capabilities: ["code", "frontend", "test", "writing", "research"],
      output: ["## Human CEO Brief", "Validate.", "```json", JSON.stringify({ brief: "Validate.", blueprint }), "```"].join("\n"),
    }),
  ];
  const mockRun = agents[0]!.run;
  agents[0]!.run = async (request) => {
    if (request.metadata?.proofSchemaId && request.metadata.phase !== "execution_brief") {
      assert(request.metadata.proofSchemaId === "product-brief", "Smoke should execute the first product brief task.");
      mkdirSync(join(request.workspacePath, ".auto-crop"), { recursive: true });
      writeFileSync(join(request.workspacePath, ".auto-crop", "business-artifact.json"), JSON.stringify({
        artifact_kind: "deliverable",
        artifact_role: "spec",
        artifact_subtype: "mvp_brief",
        task_type: "product_planning",
        payload: {
          summary: "A pricing page generator for solo SaaS founders.",
          target_user: "Solo SaaS founders",
          wedge: "Generate pricing page copy from a product description.",
          mvp_scope: "One-page form with a pricing copy preview.",
          first_revenue_path: "A fixed-price paid pilot.",
          execution_report: {
            work_summary: "Defined the customer, wedge, MVP scope, and first revenue path.",
            evidence: "The mock product brief records each requested planning input.",
            conclusion: "The first product brief is complete.",
            vision_impact: "It gives the pricing page SaaS a concrete scope to build.",
            remaining_gap: "Validate demand with real founders.",
            recommendation: "Review this brief before downstream implementation.",
          },
          outcome_summary: "The product brief defines the pricing page MVP; real customer validation remains.",
        },
        lineage: { task_id: request.taskId },
      }), "utf8");
      return { status: "complete", exitCode: 0, stdout: "Mock product brief written.", stderr: "" };
    }
    return mockRun(request);
  };
  server = createApiServer({
    projectRoot,
    repositories,
    agents,
    now: () => new Date("2026-08-17T00:00:00.000Z"),
    createId: createSequentialIdFactory(),
  });

  await new Promise<void>((resolve) => server!.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const eventMessages: Array<{ type: string; companyId?: string; taskId?: string }> = [];

  const detected = await getJson<{ agents: Array<{ id: string; detected: boolean }> }>(`${baseUrl}/api/agents`);
  assert(detected.agents.some((agent) => agent.id === "codex" && agent.detected), "Codex mock agent should be detected.");

  const created = await postJson<{
    company: { id: string; name: string; status: string };
    tasks: Array<{ id: string }>;
  }>(`${baseUrl}/api/companies`, {
    companyName: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    selectedCeoAgentId: "codex",
    permissionMode: "balanced",
    assets: [],
  });
  assert(created.company.status === "creating", "Company creation should be accepted asynchronously.");
  events = await connectEvents(`${baseUrl}/api/events?companyId=${encodeURIComponent(created.company.id)}`, eventMessages);
  let ready = created;
  await waitFor(async () => {
    ready = await getJson<typeof created>(`${baseUrl}/api/companies/${created.company.id}/state`);
    assert(ready.company.status !== "creation_failed", "Company creation failed.");
    return ready.company.status === "draft";
  });
  assert(ready.company.name === "Pricing Page Studio", "CEO blueprint should be reviewable.");

  const activated = await postJson<{ company: { status: string } }>(
    `${baseUrl}/api/companies/${created.company.id}/activate`,
    {},
  );
  assert(activated.company.status === "active", "Company should activate.");

  await runSchedulerOnce({
    projectRoot,
    repositories,
    adapters: agents,
    workerId: "mock-smoke-worker",
    maxTasks: 1,
    approvalRequired: () => false,
    proofCollector: ({ task, stdout }) => [
      {
        id: "proof_smoke_1",
        taskId: task.id,
        type: "command_output",
        uri: "agent.log",
        summary: stdout,
        verifiedAt: null,
      } satisfies Proof,
    ],
    emit: (event) => server!.events.publish({ ...event, companyId: created.company.id }),
  });

  const taskId = ready.tasks[0]?.id;
  assert(taskId, "Created company should include at least one task.");
  assert(repositories.getTask(taskId)?.status === "complete", `Task should complete through Automatic Acceptance: ${JSON.stringify(repositories.getTask(taskId))}`);
  await waitFor(() => {
    events!.check();
    return eventMessages.some((event) => event.type === "automatic_acceptance"
      && event.companyId === created.company.id && event.taskId === taskId);
  });
  const proof = await getJson<{ proof: Proof[] }>(`${baseUrl}/api/tasks/${taskId}/proof`);
  assert(proof.proof.length === 1, "Task proof should be readable.");

  const delivered = await getJson<{
    businessArtifacts: Array<{ taskId: string; validationStatus: string; reviewStatus: string }>;
  }>(`${baseUrl}/api/companies/${created.company.id}/state`);
  assert(delivered.businessArtifacts.some((artifact) => artifact.taskId === taskId
    && artifact.validationStatus === "valid" && artifact.reviewStatus === "accepted"),
  "Automatic Acceptance should accept a valid business artifact.");

  const reviewResult = runCompanyReview({
    projectRoot,
    companyId: created.company.id,
    repositories,
    now: () => new Date("2026-08-17T00:00:00.000Z"),
    createId: () => "review_smoke_1",
  });
  const reviews = await getJson<{ reviews: Array<{ id: string; summary: string }> }>(
    `${baseUrl}/api/companies/${created.company.id}/reviews`,
  );
  // Automatic Acceptance already completed the task; company review must not complete it again.
  assert(reviewResult.completedTasks.length === 0 && reviewResult.missingProofTasks.length === 0,
    "Company review should not re-complete the accepted task or report missing proof.");
  assert(reviews.reviews.some((review) => review.id === reviewResult.reviewId
    && review.summary === "Completed 0 task(s), 0 missing proof."), "Review should be readable.");

  const killed = await postJson<{ paused: boolean; company: { status: string } }>(`${baseUrl}/api/kill-switch`, {
    companyId: created.company.id,
  });
  assert(killed.paused, "Kill switch should set global pause.");
  assert(killed.company.status === "review", "Kill switch should move company to review.");

  console.log("Mock smoke test passed.");
  console.log(`Project root: ${projectRoot}`);
  console.log(`API URL: ${baseUrl}`);
  console.log(`SSE events observed: ${eventMessages.length}`);
} finally {
  await events?.close();
  if (server?.httpServer.listening) {
    const httpServer = server.httpServer;
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
      httpServer.closeAllConnections();
    });
  }
  database.close();
  rmSync(projectRoot, { recursive: true, force: true });
}

async function connectEvents(url: string, messages: Array<{ type: string; companyId?: string; taskId?: string }>) {
  const abort = new AbortController();
  const response = await fetch(url, { signal: abort.signal });
  assert(response.ok, `SSE ${url}: ${response.status} ${response.ok ? "" : await response.text()}`);
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("Missing SSE reader.");
  }

  let streamError: unknown;
  const reading = (async () => {
    const decoder = new TextDecoder();
    let buffered = "";
    while (!abort.signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffered += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = buffered.indexOf("\n\n")) !== -1) {
        const frame = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const data = frame.split("\n").filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6)).join("\n");
        if (data) messages.push(JSON.parse(data));
      }
    }
  })().catch((error) => {
    if (!abort.signal.aborted) {
      streamError = error;
    }
  });

  return {
    check: () => { if (streamError) throw streamError; },
    close: async () => { abort.abort(); await reading; reader.releaseLock(); },
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  assert(response.ok, `GET ${url}: ${response.status} ${response.ok ? "" : await response.text()}`);
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert(response.ok, `POST ${url}: ${response.status} ${response.ok ? "" : await response.text()}`);
  return (await response.json()) as T;
}

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  const startedAt = Date.now();
  while (!(await check())) {
    if (Date.now() - startedAt > 2_000) {
      throw new Error("Timed out waiting for smoke condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createSequentialIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}
