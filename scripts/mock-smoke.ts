import { mkdtempSync, rmSync } from "node:fs";
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
      capabilities: ["code", "frontend", "test"],
      output: ["## Human CEO Brief", "Validate.", "```json", JSON.stringify({ brief: "Validate.", blueprint }), "```"].join("\n"),
    }),
  ];
  const server = createApiServer({
    projectRoot,
    repositories,
    agents,
    now: () => new Date("2026-08-17T00:00:00.000Z"),
    createId: createSequentialIdFactory(),
  });

  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const eventMessages: string[] = [];
  const events = await connectEvents(`${baseUrl}/api/events`, eventMessages);

  const detected = await getJson<{ agents: Array<{ id: string; detected: boolean }> }>(`${baseUrl}/api/agents`);
  assert(detected.agents.some((agent) => agent.id === "codex" && agent.detected), "Codex mock agent should be detected.");

  const created = await postJson<{
    company: { id: string; name: string; status: string };
    tasks: Array<{ id: string }>;
  }>(`${baseUrl}/api/companies`, {
    founderVision: "Build an AI SaaS that creates pricing pages.",
    selectedCeoAgentId: "codex",
    permissionMode: "balanced",
    assets: [],
  });
  assert(created.company.status === "draft", "Company should start as draft.");
  assert(created.company.name === "Pricing Page Studio", "CEO blueprint should be reviewable.");

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
    emit: (event) => server.events.publish(event),
  });

  await waitFor(() => eventMessages.some((message) => message.includes("Task is ready for review.")));

  const taskId = created.tasks[0]?.id;
  assert(Boolean(taskId), "Created company should include at least one task.");
  const proof = await getJson<{ proof: Proof[] }>(`${baseUrl}/api/tasks/${taskId}/proof`);
  assert(proof.proof.length === 1, "Task proof should be readable.");

  runCompanyReview({
    projectRoot,
    companyId: created.company.id,
    repositories,
    now: () => new Date("2026-08-17T00:00:00.000Z"),
    createId: () => "review_smoke_1",
  });
  const reviews = await getJson<{ reviews: Array<{ summary: string }> }>(
    `${baseUrl}/api/companies/${created.company.id}/reviews`,
  );
  assert(reviews.reviews.some((review) => review.summary.includes("Completed 1 task")), "Review should be readable.");

  const killed = await postJson<{ paused: boolean; company: { status: string } }>(`${baseUrl}/api/kill-switch`, {
    companyId: created.company.id,
  });
  assert(killed.paused, "Kill switch should set global pause.");
  assert(killed.company.status === "review", "Kill switch should move company to review.");

  events.abort();
  await new Promise<void>((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
  });

  console.log("Mock smoke test passed.");
  console.log(`Project root: ${projectRoot}`);
  console.log(`API URL: ${baseUrl}`);
  console.log(`SSE events observed: ${eventMessages.length}`);
} finally {
  database.close();
  rmSync(projectRoot, { recursive: true, force: true });
}

async function connectEvents(url: string, messages: string[]) {
  const abort = new AbortController();
  const response = await fetch(url, { signal: abort.signal });
  assert(response.ok, "SSE endpoint should connect.");
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("Missing SSE reader.");
  }

  void (async () => {
    const decoder = new TextDecoder();
    while (!abort.signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      messages.push(decoder.decode(chunk.value));
    }
  })().catch((error) => {
    if (!abort.signal.aborted) {
      throw error;
    }
  });

  return abort;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  assert(response.ok, `GET ${url} should return 2xx.`);
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert(response.ok, `POST ${url} should return 2xx.`);
  return (await response.json()) as T;
}

async function waitFor(check: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
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
