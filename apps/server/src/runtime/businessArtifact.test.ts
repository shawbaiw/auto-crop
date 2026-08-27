import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Proof, Task } from "@auto-crop/core";
import { captureBusinessArtifact } from "./businessArtifact";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("captureBusinessArtifact", () => {
  it("captures a valid artifact file with snake_case aliases", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".auto-crop", "business-artifact.json"),
      JSON.stringify({
        artifact_type: "product_mvp_brief",
        task_type: "product_planning",
        source_proof_id: "proof_1",
        payload: { selected_keyword: "pricing page generator" },
        lineage: { founder_vision: "Build an AI SaaS that creates pricing pages." },
      }),
      "utf8",
    );

    const artifact = captureBusinessArtifact({
      task: createTaskRecord(),
      proofs: [createProofRecord()],
      workspacePath,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact).toMatchObject({
      id: "business_artifact_1",
      sourceProofId: "proof_1",
      artifactType: "product_mvp_brief",
      taskType: "product_planning",
      payload: { selected_keyword: "pricing page generator" },
      validationStatus: "valid",
      reviewStatus: "unreviewed",
    });
  });

  it("records an invalid blocker artifact when no artifact file exists", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);

    const artifact = captureBusinessArtifact({
      task: createTaskRecord(),
      proofs: [createProofRecord()],
      workspacePath,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact).toMatchObject({
      artifactType: "blocker_report",
      validationStatus: "invalid_schema",
      reviewStatus: "not_reviewable",
      isCurrent: true,
    });
  });
});

function createTaskRecord(): Task {
  return {
    id: "task_1",
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    position: 0,
    title: "Create product brief",
    description: "Create a product brief.",
    assigneeAgentId: "codex",
    requiredCapabilities: ["writing"],
    proofSchemaId: "product-brief",
    workspacePath: null,
    status: "review",
    riskLevel: "low",
  };
}

function createProofRecord(): Proof {
  return {
    id: "proof_1",
    taskId: "task_1",
    type: "file",
    uri: "proof.md",
    summary: "Proof exists.",
    verifiedAt: null,
  };
}
