import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runtimeActionMcpServer } from "../adapters/cliAgent";
import { handleRuntimeActionMcpMessage } from "./runtimeActionMcpServer";
import { createRuntimeActionChannel } from "./runtimeActionChannel";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime action MCP server", () => {
  /**
   * The server as a CLI actually starts it: the adapter's command, args and env, in a task workspace
   * outside this repository. Handling messages in-process proved nothing about that launch, which is
   * how a delivery tool that could not start shipped.
   */
  it("starts from a foreign workspace with the launch the adapter hands the CLI and records a candidate", () => {
    const workspace = mkdtempSync(join(tmpdir(), "auto-crop-foreign-workspace-"));
    const candidateDir = mkdtempSync(join(tmpdir(), "auto-crop-runtime-action-launch-"));
    createdDirs.push(workspace, candidateDir);
    const server = runtimeActionMcpServer({
      candidateDir, companyId: "company_1", taskId: "task_1", runId: "run_1", locale: "en", requireExecutionDetails: false,
      proofSchemaId: "product-brief", acceptedProofTypes: ["file"],
    });
    const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "submit_artifact_envelope", arguments: completeDeliverable("launched") } };

    const result = spawnSync(server.command, server.args, {
      cwd: workspace,
      env: { PATH: process.env.PATH, ...server.env },
      input: `${JSON.stringify(call)}\n`,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ id: 1, result: { isError: false, structuredContent: { ok: true } } });
    expect(readdirSync(candidateDir)).toHaveLength(1);
  });

  /**
   * The tool schema is the agent's first description of the envelope. Advertising every proof type
   * invited `url` refs a `product-brief` task refuses, so it carries the run's own accepted types.
   */
  it("advertises only the proof_refs types the run's Proof Schema accepts", () => {
    const toolSchema = (overrides: Record<string, string | undefined>) => (handleRuntimeActionMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      env({ AUTO_CROP_RUNTIME_ACTION_LOCALE: "en", AUTO_CROP_RUNTIME_ACTION_PROOF_SCHEMA_ID: "product-brief", ...overrides }),
    ) as { result: { tools: Array<{ inputSchema: { properties: Record<string, unknown> } }> } }).result.tools[0]!.inputSchema.properties.proof_refs;

    expect(toolSchema({ AUTO_CROP_RUNTIME_ACTION_ACCEPTED_PROOF_TYPES: "file" })).toMatchObject({
      items: { properties: { type: { enum: ["file"] } } },
    });
    expect(toolSchema({ AUTO_CROP_RUNTIME_ACTION_ACCEPTED_PROOF_TYPES: "" })).toMatchObject({ maxItems: 0 });
  });

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
    // Nested fields are typed, so a client sends `payload` as an object rather than a JSON string.
    expect(response).toMatchObject({
      result: { tools: [{ inputSchema: { properties: { payload: { type: "object" }, lineage: { type: "object" } } } }] },
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
    expect(createRuntimeActionChannel({ candidateDir }).consumeRunSubmission({
      companyId: "company_1",
      taskId: "task_1",
      runId: "run_1",
    }).envelope).toMatchObject({ artifactSubtype: "submitted" });
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

/** A deliverable that also meets the delivery contract the launched server enforces. */
function completeDeliverable(subtype: string) {
  return {
    ...validEnvelope(subtype),
    payload: {
      outcome_summary: "The implementation is complete.",
      execution_report: {
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
