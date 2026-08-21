import type {
  AgentAdapter,
  AgentRunRequest,
  AgentRunResult,
  AgentSession,
  AgentSessionKey,
  AgentSessionProbeResult,
} from "../adapters/types";

export type AgentSessionRunMode = "one_shot" | "persistent_used" | "persistent_fallback";

export type AgentSessionRunEvent = {
  mode: AgentSessionRunMode;
  reason?: string;
};

export type RunWithOptionalSessionInput = {
  adapter: AgentAdapter;
  request: AgentRunRequest;
  sessionKey?: AgentSessionKey | null;
  onSessionEvent?: (event: AgentSessionRunEvent) => void;
};

export type RunWithOptionalSessionResult = {
  result: AgentRunResult;
  mode: AgentSessionRunMode;
  reason?: string;
};

export class AgentSessionManager {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly busyKeys = new Set<string>();

  async run(input: RunWithOptionalSessionInput): Promise<RunWithOptionalSessionResult> {
    if (!input.sessionKey || !input.adapter.session) {
      return this.runOneShot(input, "session_not_configured");
    }

    const serializedKey = serializeSessionKey(input.sessionKey);

    if (this.busyKeys.has(serializedKey)) {
      return this.runOneShot(input, "session_busy");
    }

    this.busyKeys.add(serializedKey);

    let probeResult: AgentSessionProbeResult | null = null;
    try {
      probeResult = input.adapter.session.probe ? await input.adapter.session.probe(input.sessionKey) : null;
    } catch (error) {
      try {
        return await this.runOneShot(input, `session_probe_failed: ${(error as Error).message}`);
      } finally {
        this.busyKeys.delete(serializedKey);
      }
    }

    if (probeResult?.status === "unavailable") {
      try {
        return await this.runOneShot(input, probeResult.reason);
      } finally {
        this.busyKeys.delete(serializedKey);
      }
    }

    let session: AgentSession | null | undefined = this.sessions.get(serializedKey);
    if (!session?.alive) {
      try {
        session = await input.adapter.session.getOrStart(input.sessionKey);
      } catch (error) {
        try {
          return await this.runOneShot(input, `session_start_failed: ${(error as Error).message}`);
        } finally {
          this.busyKeys.delete(serializedKey);
        }
      }
    }

    if (!session?.alive) {
      this.sessions.delete(serializedKey);
      try {
        return await this.runOneShot(input, "session_unavailable");
      } finally {
        this.busyKeys.delete(serializedKey);
      }
    }

    this.sessions.set(serializedKey, session);
    input.onSessionEvent?.({ mode: "persistent_used" });

    try {
      const result = await session.run(input.request);
      return { result, mode: "persistent_used" };
    } catch (error) {
      return {
        result: {
          status: "failed",
          exitCode: null,
          stdout: "",
          stderr: (error as Error).message,
          failureReason: "agent_failed",
        },
        mode: "persistent_used",
      };
    } finally {
      this.busyKeys.delete(serializedKey);
      if (!session.alive) {
        this.sessions.delete(serializedKey);
      }
    }
  }

  stopCompanySessions(companyId: string, reason: string): string[] {
    const stoppedSessionIds: string[] = [];

    for (const [serializedKey, session] of this.sessions) {
      if (session.key.companyId !== companyId) {
        continue;
      }

      session.stop(reason);
      stoppedSessionIds.push(session.id);
      this.sessions.delete(serializedKey);
      this.busyKeys.delete(serializedKey);
    }

    return stoppedSessionIds;
  }

  private async runOneShot(
    input: RunWithOptionalSessionInput,
    reason: string,
  ): Promise<RunWithOptionalSessionResult> {
    input.onSessionEvent?.({
      mode: input.sessionKey ? "persistent_fallback" : "one_shot",
      reason,
    });
    const result = await input.adapter.run(input.request);
    return {
      result,
      mode: input.sessionKey ? "persistent_fallback" : "one_shot",
      reason,
    };
  }
}

export const defaultAgentSessionManager = new AgentSessionManager();

function serializeSessionKey(key: AgentSessionKey): string {
  return `${key.companyId}\0${key.agentId}\0${key.permissionMode}`;
}
