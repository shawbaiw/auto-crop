import type { AgentRunRequest } from "../../adapters/types";
import { createRuntimeActionChannel, type RuntimeActionChannel } from "../runtimeActionChannel";

/**
 * Test seam for task delivery (ADR 0041): a test stages the Artifact Envelope a workspace's agent
 * will submit, and a mock adapter built with `deliver: deliverStaged` submits it through the run's
 * Runtime Action Channel — the same path an agent calling `submit_artifact_envelope` takes. Nothing
 * here is read by the runtime; the channel is the only way a staged delivery reaches settlement.
 *
 * Keyed by workspace path, and kept across runs, as a delivery the agent would make again.
 */
const staged = new Map<string, unknown>();

export function stageDelivery(workspacePath: string, envelope: unknown): void {
  staged.set(workspacePath, envelope);
}

export function unstageDelivery(workspacePath: string): void {
  staged.delete(workspacePath);
}

export function deliverStaged(request: AgentRunRequest): unknown {
  return staged.get(request.workspacePath);
}

/**
 * A channel holding what a task's run that did not complete left behind: its last accepted Artifact
 * Envelope, which Proof recovery recaptures. `envelope` undefined leaves nothing.
 */
export function channelWithUnfinishedDelivery(
  task: { companyId: string; id: string },
  envelope: unknown,
): RuntimeActionChannel {
  const channel = createRuntimeActionChannel();
  if (envelope !== undefined) {
    channel.submitArtifactEnvelope({ companyId: task.companyId, taskId: task.id, runId: "run_unfinished" }, envelope);
  }
  return channel;
}
