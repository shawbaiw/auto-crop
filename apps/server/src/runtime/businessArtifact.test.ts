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
        artifact_kind: "deliverable",
        artifact_role: "spec",
        artifact_subtype: "mvp_brief",
        task_type: "product_planning",
        source_proof_id: "proof_1",
        payload: { selected_keyword: "pricing page generator" },
        lineage: { founder_vision: "Build an AI SaaS that creates pricing pages." },
      }),
      "utf8",
    );

    const artifact = captureBusinessArtifact({
      task: {
        ...createTaskRecord(),
        title: "Do the work",
        description: "Complete the assigned task.",
        proofSchemaId: "generic-proof",
      },
      proofs: [createProofRecord()],
      workspacePath,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact).toMatchObject({
      id: "business_artifact_1",
      sourceProofId: "proof_1",
      artifactKind: "deliverable",
      artifactRole: "spec",
      artifactSubtype: "mvp_brief",
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
      task: {
        ...createTaskRecord(),
        title: "Do the work",
        description: "Complete the assigned task.",
        proofSchemaId: "generic-proof",
      },
      proofs: [createProofRecord()],
      workspacePath,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact).toMatchObject({
      artifactKind: "blocker",
      artifactRole: "none",
      artifactSubtype: "missing_business_artifact_file",
      artifactType: "blocker_report",
      validationStatus: "invalid_schema",
      reviewStatus: "not_reviewable",
      isCurrent: true,
    });
  });

  it("downgrades browser-sandbox screenshot blockers to reviewable landing page deliverables when file proof exists", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
    writeFileSync(join(workspacePath, "index.html"), "<main>Auto Crop Workspace</main>", "utf8");
    writeFileSync(
      join(workspacePath, ".auto-crop", "business-artifact.json"),
      JSON.stringify({
        artifact_kind: "blocker",
        artifact_role: "validation",
        artifact_subtype: "prototype_screenshot_validation",
        task_type: "local_prototype_exposure",
        payload: {
          proof: {
            status: "blocked_by_browser_sandbox",
            screenshot_path: null,
          },
        },
        lineage: {
          proof_schema: "landing-page-file",
        },
      }),
      "utf8",
    );

    const artifact = captureBusinessArtifact({
      task: {
        ...createTaskRecord(),
        title: "Execute Provide local prototype access",
        description: "Expose the working prototype through a local development URL and capture a screenshot.",
        proofSchemaId: "landing-page-file",
      },
      proofs: [
        {
          ...createProofRecord(),
          type: "file",
          uri: join(workspacePath, "index.html"),
          summary: "File proof: index.html",
        },
      ],
      workspacePath,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact).toMatchObject({
      artifactKind: "deliverable",
      artifactRole: "implementation",
      artifactSubtype: "prototype_implementation",
      artifactType: "implementation_summary",
      taskType: "local_prototype_exposure",
      validationStatus: "valid",
      reviewStatus: "unreviewed",
    });
    expect(artifact.payload).toMatchObject({
      proof: {
        status: "blocked_by_browser_sandbox",
      },
      validationLimits: {
        screenshotCapture: "blocked_by_browser_sandbox",
      },
    });
  });

  it("infers kind and role for an unknown legacy artifactType", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".auto-crop", "business-artifact.json"),
      JSON.stringify({
        artifactType: "keyword_research",
        taskType: "keyword_opportunity_research",
        payload: {
          summary: "Resume bullet point generator is the best first opportunity.",
          recommendation: "Build a focused resume bullet point generator.",
          evidence: ["High intent", "Weak direct competition"],
          risks: ["Validate live volume before building"],
          next_steps: ["Create MVP brief"],
        },
        lineage: { founder_vision: "Find an SEO opportunity and build a lightweight web product." },
      }),
      "utf8",
    );

    const artifact = captureBusinessArtifact({
      task: {
        ...createTaskRecord(),
        title: "Find the first SEO keyword opportunity",
        description: "Research English-language keyword opportunities.",
        proofSchemaId: "research-report",
      },
      proofs: [createProofRecord()],
      workspacePath,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact).toMatchObject({
      artifactKind: "deliverable",
      artifactRole: "findings",
      artifactSubtype: "keyword_research",
      artifactType: "research_findings",
      taskType: "keyword_opportunity_research",
      validationStatus: "valid",
      validationErrors: [],
      reviewStatus: "unreviewed",
    });
  });

  it("rejects unknown legacy artifactType when no role can be inferred", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".auto-crop", "business-artifact.json"),
      JSON.stringify({
        artifactType: "keyword_research",
        taskType: "unknown_work",
        payload: {
          summary: "Something useful happened.",
          recommendation: "Continue.",
          evidence: [],
          risks: [],
          next_steps: [],
        },
        lineage: {},
      }),
      "utf8",
    );

    const artifact = captureBusinessArtifact({
      task: {
        ...createTaskRecord(),
        title: "Do the work",
        description: "Complete the assigned task.",
        proofSchemaId: "generic-proof",
      },
      proofs: [createProofRecord()],
      workspacePath,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact).toMatchObject({
      artifactKind: "blocker",
      artifactRole: "none",
      artifactSubtype: "invalid_business_artifact_schema",
      artifactType: "blocker_report",
      validationStatus: "invalid_schema",
      reviewStatus: "not_reviewable",
    });
    expect(artifact.validationErrors).toContain("artifactType: Unknown legacy artifact type and artifact role could not be inferred.");
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
