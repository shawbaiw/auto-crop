import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentAdapter, AgentRunRequest } from "../adapters/types";
import type { AgentCapabilityGrant } from "../policies/capabilityGrant";
import { artifactSyntaxRepairGrant, preservesArtifactContent, repairBusinessArtifactSyntax } from "./artifactSyntaxRepair";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A Chinese delivery quoting a phrase with bare ASCII quotes — the shape a real run produced. */
const brokenArtifact = '{"artifact_kind": "deliverable", "payload": {"summary": "竞品都已做到"免登录"，不再是差异点"}}';
const escapedArtifact = '{"artifact_kind": "deliverable", "payload": {"summary": "竞品都已做到\\"免登录\\"，不再是差异点"}}';
const researchGrant: AgentCapabilityGrant = {
  granted: ["workspace_read", "workspace_write", "web_research"],
  withheld: ["run_command"],
  id: "workspace_read+workspace_write+web_research",
};

describe("business artifact syntax repair", () => {
  it("accepts a repair that only escapes or swaps quote marks, and fixes punctuation", () => {
    expect(preservesArtifactContent(brokenArtifact, escapedArtifact)).toBe(true);
    expect(preservesArtifactContent(brokenArtifact, brokenArtifact.replace('"免登录"', "「免登录」"))).toBe(true);
    expect(preservesArtifactContent('{"a": "x" "b": "y"', '{"a": "x", "b": "y"}')).toBe(true);
    expect(preservesArtifactContent('{"a": "line one\nline two"}', '{"a": "line one\\nline two"}')).toBe(true);
  });

  it("refuses a repair that changes what the artifact says", () => {
    expect(preservesArtifactContent(brokenArtifact, escapedArtifact.replace("不再是差异点", "仍是差异点"))).toBe(false);
    expect(preservesArtifactContent(brokenArtifact, escapedArtifact.replace('"deliverable"', '"blocker"'))).toBe(false);
  });

  it("does nothing, and runs nothing, when the artifact parses or is absent", async () => {
    const workspace = createWorkspace();
    const adapter = scriptedAdapter(() => undefined);

    expect(await repairBusinessArtifactSyntax({ adapter, request: requestFor(workspace), grant: researchGrant })).toBeNull();
    writeArtifact(workspace, escapedArtifact);
    expect(await repairBusinessArtifactSyntax({ adapter, request: requestFor(workspace), grant: researchGrant })).toBeNull();
    expect(adapter.runs).toHaveLength(0);
  });

  it("keeps a repair that makes the file parse without changing content, on a workspace-only grant", async () => {
    const workspace = createWorkspace();
    writeArtifact(workspace, brokenArtifact);
    const adapter = scriptedAdapter((request) => writeArtifact(request.workspacePath, escapedArtifact));

    const repair = await repairBusinessArtifactSyntax({ adapter, request: requestFor(workspace), grant: researchGrant });

    expect(repair?.outcome).toBe("repaired");
    expect(JSON.parse(readArtifact(workspace)).payload.summary).toBe("竞品都已做到\"免登录\"，不再是差异点");
    expect(adapter.runs[0]?.grant).toEqual({
      granted: ["workspace_read", "workspace_write"],
      withheld: ["run_command", "web_research"],
      id: "workspace_read+workspace_write",
    });
    expect(adapter.runs[0]?.prompt).toContain(repair!.syntaxError);
  });

  it("restores the original file when the repair changed content, left it broken, or did not finish", async () => {
    const cases: Array<{ expected: string; act: (request: AgentRunRequest) => { status: "complete" | "failed" } | void }> = [
      { expected: "content_changed", act: (request) => writeArtifact(request.workspacePath, '{"artifact_kind": "deliverable", "payload": {}}') },
      { expected: "still_invalid", act: (request) => writeArtifact(request.workspacePath, `${brokenArtifact} `) },
      { expected: "still_invalid", act: (request) => rmSync(join(request.workspacePath, ".auto-crop", "business-artifact.json")) },
      {
        expected: "run_failed",
        act: (request) => {
          writeArtifact(request.workspacePath, escapedArtifact);
          return { status: "failed" };
        },
      },
    ];

    for (const { expected, act } of cases) {
      const workspace = createWorkspace();
      writeArtifact(workspace, brokenArtifact);

      const repair = await repairBusinessArtifactSyntax({ adapter: scriptedAdapter(act), request: requestFor(workspace), grant: researchGrant });

      expect(repair?.outcome).toBe(expected);
      expect(readArtifact(workspace)).toBe(brokenArtifact);
    }
  });

  it("never grants the repair more than the delivery held", () => {
    expect(artifactSyntaxRepairGrant({ granted: ["workspace_read"], withheld: ["workspace_write"], id: "workspace_read" })).toEqual({
      granted: ["workspace_read"],
      withheld: ["workspace_write"],
      id: "workspace_read",
    });
  });
});

function createWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "auto-crop-artifact-repair-"));
  createdDirs.push(workspace);
  return workspace;
}

function writeArtifact(workspace: string, content: string): void {
  mkdirSync(join(workspace, ".auto-crop"), { recursive: true });
  writeFileSync(join(workspace, ".auto-crop", "business-artifact.json"), content, "utf8");
}

function readArtifact(workspace: string): string {
  return readFileSync(join(workspace, ".auto-crop", "business-artifact.json"), "utf8");
}

function requestFor(workspacePath: string) {
  return { taskId: "task_1", promptPath: "", workspacePath, metadata: {} };
}

function scriptedAdapter(
  act: (request: AgentRunRequest) => { status: "complete" | "failed" } | void,
): AgentAdapter & { runs: AgentRunRequest[] } {
  const runs: AgentRunRequest[] = [];
  return {
    id: "mock-worker",
    name: "Mock Worker",
    capabilities: ["code"],
    runs,
    detect: async () => true,
    run: async (request) => {
      runs.push(request);
      const status = act(request)?.status ?? "complete";
      return { status, exitCode: status === "complete" ? 0 : 1, stdout: "", stderr: "" };
    },
  };
}
