import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeActionChannel } from "./runtimeActionChannel";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempCandidateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "auto-crop-runtime-actions-"));
  createdDirs.push(dir);
  return dir;
}

describe("RuntimeActionChannel", () => {
  const context = { companyId: "company_1", taskId: "task_1", runId: "run_1" };

  it("stores the last valid envelope for a run", () => {
    const channel = createRuntimeActionChannel();
    channel.submitArtifactEnvelope(context, validEnvelope("first"));
    channel.submitArtifactEnvelope(context, validEnvelope("second"));

    expect(channel.consumeRunSubmission(context).envelope).toMatchObject({
      artifactSubtype: "second",
    });
    expect(channel.consumeRunSubmission(context).envelope).toBeNull();
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
    expect(channel.consumeRunSubmission(context).envelope).toMatchObject({
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
    expect(channel.consumeRunSubmission({ ...context, runId: "other_run" }).envelope).toBeNull();
    expect(channel.consumeRunSubmission(context).envelope).toMatchObject({ artifactSubtype: "identity" });
  });

  /**
   * The delivery contract is checked when the agent submits, with the rules settlement applies, so a
   * missing Execution Report is something the agent hears about and fixes inside the same run.
   */
  it("rejects a submission that breaks the delivery contract settlement would apply", () => {
    const channel = createRuntimeActionChannel();
    const contract = { locale: "en" as const, requireDetails: true };

    const missingReport = channel.submitArtifactEnvelope(context, validEnvelope("no_report"), contract);
    const complete = channel.submitArtifactEnvelope(context, deliverableWithReport("complete"), contract);

    expect(missingReport).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.stringContaining("payload.outcome_summary"), expect.stringContaining("payload.execution_report")]),
    });
    expect(complete).toMatchObject({ ok: true });
    expect(channel.consumeRunSubmission(context).envelope).toMatchObject({ artifactSubtype: "complete" });
  });

  /**
   * An agent whose every call is rejected has still tried to deliver. Settlement must report that as
   * an invalid delivery with the errors it was given, not as nothing submitted.
   */
  it("rejects proof_refs the task's Proof Schema does not accept, at submit time", () => {
    const channel = createRuntimeActionChannel();
    const contract = { locale: "en" as const, requireDetails: true, proofRefs: { proofSchemaId: "product-brief", acceptedTypes: ["file" as const] } };
    const citingSources = { ...deliverableWithReport("cited"), proof_refs: [{ type: "url", uri: "https://example.com/source" }] };

    expect(channel.submitArtifactEnvelope(context, citingSources, contract)).toMatchObject({
      ok: false,
      errors: ["proof_refs[0].type url is not accepted by product-brief; it accepts file"],
    });
    expect(channel.submitArtifactEnvelope(context, deliverableWithReport("cited"), contract)).toMatchObject({ ok: true });
  });

  it("keeps the last rejection only while the run has no valid candidate", () => {
    const channel = createRuntimeActionChannel();
    const contract = { locale: "en" as const, requireDetails: true };
    channel.submitArtifactEnvelope(context, validEnvelope("no_report"), contract);

    expect(channel.consumeRunSubmission(context)).toEqual({
      envelope: null,
      rejection: expect.arrayContaining([expect.stringContaining("payload.execution_report")]),
    });

    channel.submitArtifactEnvelope(context, deliverableWithReport("accepted"), contract);
    channel.submitArtifactEnvelope(context, validEnvelope("rejected_later"), contract);
    expect(channel.consumeRunSubmission(context)).toMatchObject({ envelope: { artifactSubtype: "accepted" }, rejection: null });
  });

  it.each([
    ["in memory", () => createRuntimeActionChannel()],
    ["file-backed", () => createRuntimeActionChannel({ candidateDir: tempCandidateDir() })],
  ])("keeps one candidate per task, its latest run's, for recovery (%s)", (_label, create) => {
    const channel = create();
    const task = { companyId: context.companyId, taskId: context.taskId };
    channel.submitArtifactEnvelope({ ...context, runId: "run_1" }, validEnvelope("first_run"));

    // The next dispatch supersedes it; that run times out after submitting its own.
    channel.discardTask(task);
    channel.submitArtifactEnvelope({ ...context, runId: "run_2" }, validEnvelope("second_run"));

    expect(channel.latestTaskSubmission(task).envelope).toMatchObject({ artifactSubtype: "second_run" });
    expect(channel.latestTaskSubmission({ ...task, taskId: "task_2" }).envelope).toBeNull();
    channel.discardTask(task);
    expect(channel.latestTaskSubmission(task).envelope).toBeNull();
  });

  it("shares candidates through a file-backed store for an external MCP server process", () => {
    const candidateDir = mkdtempSync(join(tmpdir(), "auto-crop-runtime-actions-"));
    try {
      const serverSide = createRuntimeActionChannel({ candidateDir });
      const schedulerSide = createRuntimeActionChannel({ candidateDir });

      serverSide.submitArtifactEnvelope(context, validEnvelope("from_mcp"));

      expect(schedulerSide.consumeRunSubmission(context).envelope).toMatchObject({
        artifactSubtype: "from_mcp",
      });
      expect(serverSide.consumeRunSubmission(context).envelope).toBeNull();
    } finally {
      rmSync(candidateDir, { recursive: true, force: true });
    }
  });
});

function deliverableWithReport(subtype: string) {
  return {
    ...validEnvelope(subtype),
    payload: {
      outcome_summary: "The implementation is complete.",
      execution_report: {
        work_summary: "Implemented the change.",
        evidence: "Its tests pass.",
        conclusion: "The change is complete.",
        vision_impact: "It unblocks the next milestone.",
        remaining_gap: "Nothing for this task.",
        recommendation: "Review it.",
      },
    },
  };
}

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
