import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskAffordanceKindSchema, type TaskAffordanceKind } from "@auto-crop/core";
import { createMockAgentAdapter } from "../adapters/mockAgent";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { createApiServer } from "./routes";

const createdDirs: string[] = [];
const openClients: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const client of openClients.splice(0)) {
    client.close();
  }
});

type AffordanceRoute = {
  path: (id: string) => string;
  body?: (id: string) => unknown;
};

/**
 * The route that honours each Resume Affordance.
 *
 * This map is the contract `resolveTaskAffordances` implicitly promises: if a Hold offers an action,
 * something must actually perform it. Founder Approval was offered for months against a route that
 * echoed the request back and wrote nothing, so the button would have done nothing at all — an
 * affordance no route honours is worse than no affordance, because it lies to the founder.
 */
const affordanceRoutes: Record<TaskAffordanceKind, AffordanceRoute> = {
  ceo_review_decision: {
    path: () => "/api/ceo-review-decisions",
    body: (id) => ({ taskId: id, decision: "approve" }),
  },
  decide_founder_approval: {
    path: (id) => `/api/approvals/${id}`,
    body: () => ({ decision: "approved" }),
  },
  confirm_human_action: {
    path: (id) => `/api/companies/${id}/human-actions/${id}/confirm`,
    body: () => ({ evidence: {} }),
  },
  resolve_founder_decision: {
    path: () => "/api/founder-decisions",
    body: (id) => ({ founderDecisionId: id, chosenOption: "Flat" }),
  },
  refresh_task: { path: (id) => `/api/tasks/${id}/refresh` },
  recover_task: { path: (id) => `/api/tasks/${id}/recover` },
  request_replan: { path: (id) => `/api/tasks/${id}/replan-proposals` },
  confirm_replan: { path: (id) => `/api/replan-proposals/${id}/confirm` },
  cancel_task: { path: (id) => `/api/tasks/${id}/cancel` },
};

describe("Resume Affordance coverage", () => {
  it("declares a route for every affordance kind", () => {
    expect(Object.keys(affordanceRoutes).sort()).toEqual([...taskAffordanceKindSchema.options].sort());
  });

  /**
   * The stub oracle. A route that only echoes its request back answers `200` for a subject that does
   * not exist, because it never looks anything up — which is exactly how the old
   * `POST /api/approvals/:id` behaved. A route that actually does the work cannot.
   */
  it.each(Object.entries(affordanceRoutes))(
    "%s is answered by a route that looks its subject up",
    async (_kind, route) => {
      const fixture = await startBareServer();
      const missingId = "does_not_exist";

      const response = await fetch(`${fixture.baseUrl}${route.path(missingId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(route.body?.(missingId) ?? {}),
      });

      expect(response.ok, "a missing subject must not be answered with success").toBe(false);
      await fixture.close();
    },
  );
});

async function startBareServer() {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-affordance-"));
  createdDirs.push(projectRoot);
  const client = createDatabaseClient(":memory:");
  openClients.push(client);
  migrate(client);

  const server = createApiServer({
    projectRoot,
    repositories: createRepositories(client),
    agents: [createMockAgentAdapter({ id: "codex", name: "Codex", capabilities: ["code"] })],
    now: () => new Date("2026-09-14T00:00:00.000Z"),
  });

  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
