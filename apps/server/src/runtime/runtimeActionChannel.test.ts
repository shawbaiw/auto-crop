import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeActionChannel } from "./runtimeActionChannel";

describe("RuntimeActionChannel", () => {
  const context = { companyId: "company_1", taskId: "task_1", runId: "run_1" };

  it("stores the last valid envelope for a run", () => {
    const channel = createRuntimeActionChannel();
    channel.submitArtifactEnvelope(context, validEnvelope("first"));
    channel.submitArtifactEnvelope(context, validEnvelope("second"));

    expect(channel.consumeArtifactEnvelopeCandidate(context)).toMatchObject({
      artifactSubtype: "second",
    });
    expect(channel.consumeArtifactEnvelopeCandidate(context)).toBeNull();
  });

  it("returns structured errors and keeps the previous valid candidate", () => {
    const channel = createRuntimeActionChannel();
    channel.submitArtifactEnvelope(context, validEnvelope("good"));
    const invalid = channel.submitArtifactEnvelope(context, {
      artifact_kind: "bad",
      artifact_role: "implementation",
      artifact_subtype: "bad",
      task_type: "task",
      lineage: {},
    });

    expect(invalid).toMatchObject({
      ok: false,
      code: "invalid_artifact_envelope",
      errors: expect.arrayContaining([
        "artifactKind/artifact_kind: Expected a supported business artifact kind.",
        "payload: Required.",
      ]),
    });
    expect(channel.consumeArtifactEnvelopeCandidate(context)).toMatchObject({
      artifactSubtype: "good",
    });
  });

  it("does not trust identity fields inside the envelope", () => {
    const channel = createRuntimeActionChannel();
    const result = channel.submitArtifactEnvelope(context, {
      ...validEnvelope("identity"),
      taskId: "other_task",
      companyId: "other_company",
      runId: "other_run",
    });

    expect(result).toEqual({ ok: true, ignoredIdentityFields: ["taskId", "companyId", "runId"] });
    expect(channel.consumeArtifactEnvelopeCandidate({ ...context, runId: "other_run" })).toBeNull();
    expect(channel.consumeArtifactEnvelopeCandidate(context)).toMatchObject({ artifactSubtype: "identity" });
  });

  it("cleans up a run without a settlement consume", () => {
    const channel = createRuntimeActionChannel();
    channel.submitArtifactEnvelope(context, validEnvelope("cleanup"));
    channel.discardRun(context);

    expect(channel.consumeArtifactEnvelopeCandidate(context)).toBeNull();
  });

  it("shares candidates through a file-backed store for an external MCP server process", () => {
    const candidateDir = mkdtempSync(join(tmpdir(), "auto-crop-runtime-actions-"));
    try {
      const serverSide = createRuntimeActionChannel({ candidateDir });
      const schedulerSide = createRuntimeActionChannel({ candidateDir });

      serverSide.submitArtifactEnvelope(context, validEnvelope("from_mcp"));

      expect(schedulerSide.consumeArtifactEnvelopeCandidate(context)).toMatchObject({
        artifactSubtype: "from_mcp",
      });
      expect(serverSide.consumeArtifactEnvelopeCandidate(context)).toBeNull();
    } finally {
      rmSync(candidateDir, { recursive: true, force: true });
    }
  });
});

function validEnvelope(subtype: string) {
  return {
    artifact_kind: "deliverable",
    artifact_role: "implementation",
    artifact_subtype: subtype,
    task_type: "engineering.implementation",
    payload: {},
    lineage: {},
  };
}
