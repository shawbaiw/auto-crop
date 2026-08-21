import { describe, expect, it } from "vitest";
import type { AgentAdapter, AgentRunRequest, AgentRunResult, AgentSession, AgentSessionKey } from "../adapters/types";
import { AgentSessionManager } from "./agentSessions";

const request: AgentRunRequest = {
  taskId: "task_1",
  prompt: "Plan the work.",
  promptPath: ".auto-crop/prompt.md",
  workspacePath: ".",
  metadata: {},
};

const sessionKey: AgentSessionKey = {
  companyId: "company_1",
  agentId: "codex",
  permissionMode: "balanced",
};

describe("AgentSessionManager", () => {
  it("falls back to one-shot execution when the adapter has no session capability", async () => {
    const manager = new AgentSessionManager();
    const oneShotRuns: AgentRunRequest[] = [];
    const adapter = createAdapter({
      run: async (runRequest) => {
        oneShotRuns.push(runRequest);
        return complete("one-shot");
      },
    });

    const result = await manager.run({ adapter, request, sessionKey });

    expect(result).toMatchObject({ mode: "persistent_fallback", reason: "session_not_configured" });
    expect(result.result.stdout).toBe("one-shot");
    expect(oneShotRuns).toEqual([request]);
  });

  it("runs through a persistent session when the adapter provides one", async () => {
    const manager = new AgentSessionManager();
    const sessionRuns: AgentRunRequest[] = [];
    const session = createSession({
      run: async (runRequest) => {
        sessionRuns.push(runRequest);
        return complete("session");
      },
    });
    const adapter = createAdapter({
      session: {
        async getOrStart() {
          return session;
        },
      },
    });

    const result = await manager.run({ adapter, request, sessionKey });

    expect(result).toMatchObject({ mode: "persistent_used" });
    expect(result.result.stdout).toBe("session");
    expect(sessionRuns).toEqual([request]);
  });

  it("starts a different session for a different permission mode", async () => {
    const manager = new AgentSessionManager();
    const startedModes: string[] = [];
    const adapter = createAdapter({
      session: {
        async getOrStart(key) {
          startedModes.push(key.permissionMode);
          return createSession({
            id: `session_${key.permissionMode}`,
            key,
          });
        },
      },
    });

    await manager.run({ adapter, request, sessionKey });
    await manager.run({
      adapter,
      request,
      sessionKey: {
        ...sessionKey,
        permissionMode: "autonomous",
      },
    });

    expect(startedModes).toEqual(["balanced", "autonomous"]);
  });

  it("falls back to one-shot execution when the session probe is unavailable", async () => {
    const manager = new AgentSessionManager();
    const events: Array<{ mode: string; reason?: string }> = [];
    const adapter = createAdapter({
      run: async () => complete("fallback"),
      session: {
        async probe() {
          return { status: "unavailable", reason: "cli has no session support" };
        },
        async getOrStart() {
          throw new Error("getOrStart should not run after an unavailable probe");
        },
      },
    });

    const result = await manager.run({
      adapter,
      request,
      sessionKey,
      onSessionEvent: (event) => events.push(event),
    });

    expect(result).toMatchObject({
      mode: "persistent_fallback",
      reason: "cli has no session support",
    });
    expect(result.result.stdout).toBe("fallback");
    expect(events).toEqual([
      {
        mode: "persistent_fallback",
        reason: "cli has no session support",
      },
    ]);
  });

  it("does not run concurrent turns through the same session", async () => {
    const manager = new AgentSessionManager();
    const oneShotRuns: string[] = [];
    let releaseSessionRun: () => void = () => {
      return;
    };
    const session = createSession({
      async run() {
        await new Promise<void>((resolve) => {
          releaseSessionRun = resolve;
        });
        return complete("session");
      },
    });
    const adapter = createAdapter({
      run: async () => {
        oneShotRuns.push("fallback");
        return complete("fallback");
      },
      session: {
        async getOrStart() {
          return session;
        },
      },
    });

    const firstRun = manager.run({ adapter, request, sessionKey });
    const secondRun = await manager.run({ adapter, request: { ...request, taskId: "task_2" }, sessionKey });
    releaseSessionRun?.();
    const firstResult = await firstRun;

    expect(firstResult).toMatchObject({ mode: "persistent_used" });
    expect(secondRun).toMatchObject({ mode: "persistent_fallback", reason: "session_busy" });
    expect(oneShotRuns).toEqual(["fallback"]);
  });

  it("stops tracked company sessions", async () => {
    const manager = new AgentSessionManager();
    const stoppedReasons: string[] = [];
    const session = createSession({
      stop(reason) {
        stoppedReasons.push(reason);
        session.alive = false;
      },
    });
    const adapter = createAdapter({
      session: {
        async getOrStart() {
          return session;
        },
      },
    });

    await manager.run({ adapter, request, sessionKey });

    expect(manager.stopCompanySessions("company_1", "emergency_stop")).toEqual(["session_1"]);
    expect(stoppedReasons).toEqual(["emergency_stop"]);
  });
});

function createAdapter(overrides: Partial<AgentAdapter>): AgentAdapter {
  return {
    id: "codex",
    name: "Codex",
    capabilities: ["code"],
    async detect() {
      return true;
    },
    async run() {
      return complete("one-shot");
    },
    ...overrides,
  };
}

function createSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "session_1",
    key: sessionKey,
    alive: true,
    async run() {
      return complete("session");
    },
    stop() {
      this.alive = false;
    },
    ...overrides,
  };
}

function complete(stdout: string): AgentRunResult {
  return {
    status: "complete",
    exitCode: 0,
    stdout,
    stderr: "",
  };
}
