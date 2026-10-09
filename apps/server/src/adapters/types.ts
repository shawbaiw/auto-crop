import type { AgentFailureReason } from "@auto-crop/core";
import type { AgentCapabilityGrant } from "../policies/capabilityGrant";
import type { LaunchPlan } from "./launchPolicy";

export type AgentCapability = string;

export type AdapterContractCapability =
  | "structured_execution_brief"
  | "restricted_launch_isolation"
  | "artifact_envelope";

export type AgentRunRequest = {
  taskId: string;
  prompt: string;
  promptPath: string;
  workspacePath: string;
  metadata: Record<string, string>;
  timeoutMs?: number;
  /**
   * What this run is permitted to do. Resolved once by the runtime (ADR 0021); an adapter translates
   * it into its own launch flags and decides nothing else about it. Absent means the caller did not
   * resolve a grant, and the adapter falls back to a read/write-only workspace grant rather than to
   * whatever the host machine would have allowed.
   */
  grant?: AgentCapabilityGrant;
  /**
   * A JSON Schema the reply must satisfy — the run's **Structured Output Contract**.
   *
   * A prompt asking for JSON is a request; this is a constraint the CLI enforces. The difference is
   * not theoretical: an Execution Brief written in Chinese put a quoted phrase in a prose field, the
   * model emitted a bare `"` inside a JSON string, `JSON.parse` threw, and the task failed before
   * any substantive work was dispatched (ADR 0022).
   */
  outputSchema?: Record<string, unknown>;
  /**
   * Where to report what this run is doing while it does it.
   *
   * Optional, and ignored by adapters that have nothing to report: a run without it is observed as
   * unknown rather than as silent. Purely an outbound report — an adapter never reads the runtime's
   * judgement back, and nothing an adapter reports here ends its own run.
   */
  observe?: RunObservationSink;
  /**
   * Asks this run to stop.
   *
   * An adapter that honours it must not resolve when the signal fires, but when the process is
   * actually gone — or admit it could not confirm that. Resolving on the signal reports a process as
   * finished while it is still writing to the workspace the next run is about to use.
   */
  signal?: AbortSignal;
  /**
   * Runtime-owned action surface for facts the run submits explicitly. Adapters that can expose tools
   * such as `submit_artifact_envelope` call through this narrow interface; tests may call it directly.
   */
  runtimeActions?: {
    submitArtifactEnvelope(envelope: unknown): unknown;
    mcp?: {
      candidateDir: string;
      companyId: string;
      taskId: string;
      runId: string;
    };
  };
  /** How long the process gets to exit on its own after being asked, before the group is killed. */
  graceMs?: number;
  /** How long after the kill the runtime waits for proof the process is gone. */
  confirmMs?: number;
};

/**
 * The observation an adapter can offer about a run in flight.
 *
 * Deliberately narrow: how many bytes moved on which channel, not what they said. Storing the output
 * again would duplicate the log and drag prompts and credentials into the observation tables.
 */
export type RunObservationSink = {
  output(channel: "stdout" | "stderr", bytes: number): void;
};

export type AgentRunResult = {
  status: "complete" | "failed";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  failureReason?: AgentFailureReason;
  /**
   * Whether the runtime saw the process actually exit after asking it to stop.
   *
   * `true` may also record a natural exit with an absent POSIX process group. Absent means unknown.
   * `false` means the process was signalled, did not exit, and
   * the runtime cannot prove it is gone — it may still be writing to the workspace, so the task must
   * be isolated rather than re-run there (execution-health §7).
   */
  terminationConfirmed?: boolean;
};

export type AgentSessionKey = {
  companyId: string;
  agentId: string;
  permissionMode: string;
  /**
   * The Agent Capability Grant id the session was started under. A session is a live process holding
   * the capabilities it was launched with, so serving a run from a session started under a different
   * grant would hand that run capabilities it was never granted (ADR 0021).
   */
  grantId: string;
};

export type AgentSessionProbeResult =
  | {
      status: "available";
    }
  | {
      status: "unavailable";
      reason: string;
    };

export type AgentSession = {
  id: string;
  key: AgentSessionKey;
  alive: boolean;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  stop(reason: string): void;
};

export type AgentSessionCapability = {
  probe?(key: AgentSessionKey): Promise<AgentSessionProbeResult>;
  getOrStart(key: AgentSessionKey): Promise<AgentSession | null>;
};

export type AgentAdapter = {
  id: string;
  name: string;
  capabilities: AgentCapability[];
  /**
   * Runtime-facing contracts this adapter can satisfy reliably. Kept separate from work skills such
   * as `research` or `code`: these are about the adapter protocol, not what task work it can do.
   */
  contractCapabilities?: AdapterContractCapability[];
  resolveContractCapabilities?(): Promise<AdapterContractCapability[]>;
  /**
   * Whether this adapter can run a task under Auto-Crop's launch semantics — not merely whether its
   * executable exists. An adapter whose launch plan is `unavailable` is not detected.
   */
  detect(): Promise<boolean>;
  /**
   * How far the installed agent can enforce the Launch Policy, decided before dispatch. Absent means
   * the adapter makes no launch-isolation claim (mocks, grant-blind command templates) and is
   * launchable whenever it is detected.
   */
  launchPlan?(): Promise<LaunchPlan>;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  session?: AgentSessionCapability;
};
