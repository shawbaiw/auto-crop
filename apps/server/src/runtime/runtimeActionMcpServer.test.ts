import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleRuntimeActionMcpMessage } from "./runtimeActionMcpServer";
import { createRuntimeActionChannel } from "./runtimeActionChannel";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime action MCP server", () => {
  it("lists only the submit_artifact_envelope tool", () => {
    const response = handleRuntimeActionMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }, env());

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [{ name: "submit_artifact_envelope" }],
      },
    });
  });

  it("submits an envelope into the file-backed runtime action channel", () => {
    const candidateDir = mkdtempSync(join(tmpdir(), "auto-crop-runtime-actions-"));
    createdDirs.push(candidateDir);
    const context = {
      AUTO_CROP_RUNTIME_ACTION_DIR: candidateDir,
      AUTO_CROP_RUNTIME_ACTION_COMPANY_ID: "company_1",
      AUTO_CROP_RUNTIME_ACTION_TASK_ID: "task_1",
      AUTO_CROP_RUNTIME_ACTION_RUN_ID: "run_1",
    };

    const response = handleRuntimeActionMcpMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "submit_artifact_envelope",
        arguments: validEnvelope("submitted"),
      },
    }, context);

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text" }],
        structuredContent: { ok: true },
      },
    });
    expect(createRuntimeActionChannel({ candidateDir }).consumeArtifactEnvelopeCandidate({
      companyId: "company_1",
      taskId: "task_1",
      runId: "run_1",
    })).toMatchObject({ artifactSubtype: "submitted" });
  });
});

function env(overrides: Record<string, string> = {}) {
  return {
    AUTO_CROP_RUNTIME_ACTION_DIR: "/tmp/auto-crop-runtime-actions",
    AUTO_CROP_RUNTIME_ACTION_COMPANY_ID: "company_1",
    AUTO_CROP_RUNTIME_ACTION_TASK_ID: "task_1",
    AUTO_CROP_RUNTIME_ACTION_RUN_ID: "run_1",
    ...overrides,
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
