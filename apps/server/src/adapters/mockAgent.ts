import { DEFAULT_LAUNCH_POLICY, type AdapterLaunchSupport } from "./launchPolicy";
import type { AdapterContractCapability, AgentAdapter, AgentRunRequest, AgentRunResult } from "./types";

export type MockAgentOptions = {
  id: string;
  name: string;
  capabilities: string[];
  contractCapabilities?: AdapterContractCapability[];
  detected?: boolean;
  output?: string;
  status?: AgentRunResult["status"];
  failureReason?: AgentRunResult["failureReason"];
  /**
   * The Artifact Envelope the mock submits through the run's Runtime Action Channel, as an agent
   * would by calling `submit_artifact_envelope`. Undefined submits nothing.
   */
  deliver?: (request: AgentRunRequest) => unknown;
  /** Launch support to report. Omitted: the mock makes no launch-isolation claim. */
  launchSupport?: Omit<AdapterLaunchSupport, "adapterId">;
};

export function createMockAgentAdapter(options: MockAgentOptions): AgentAdapter {
  const launchSupport = options.launchSupport;
  return {
    id: options.id,
    name: options.name,
    capabilities: options.capabilities,
    contractCapabilities: options.contractCapabilities ?? ["structured_execution_brief", "artifact_envelope"],
    async detect(): Promise<boolean> {
      return (options.detected ?? true) && launchSupport?.isolationLevel !== "unavailable";
    },
    ...(launchSupport
      ? { launchPlan: async () => ({ policy: DEFAULT_LAUNCH_POLICY, support: { adapterId: options.id, ...launchSupport } }) }
      : {}),
    async run(request: AgentRunRequest): Promise<AgentRunResult> {
      if (request.metadata.phase === "execution_brief") {
        return { status: "complete", exitCode: 0, stderr: "", stdout: JSON.stringify({
          purpose: "Evaluate the task requirements",
          approach: "Compare the supplied inputs, perform the requested checks, and record their results",
          expectedOutcome: "A deliverable with evidence for the requested acceptance conditions",
        }) };
      }
      const envelope = options.deliver?.(request);
      if (envelope !== undefined) {
        request.runtimeActions?.submitArtifactEnvelope(envelope);
      }
      return {
        status: options.status ?? "complete",
        exitCode: options.status === "failed" ? 1 : 0,
        stdout:
          options.output ??
          `Mock agent ${options.id} completed task ${request.taskId} in ${request.workspacePath}`,
        stderr: "",
        failureReason: options.failureReason ?? (options.status === "failed" ? "agent_failed" : undefined),
      };
    },
  };
}
