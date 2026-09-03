import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Proof, Task } from "@auto-crop/core";
import {
  captureBusinessArtifact,
  isVerifiableEnvironmentBlocker,
  readEnvironmentBlockerClaim,
  verifyEnvironmentBlockerClaim,
} from "./businessArtifact";

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
        payload: {
          selected_keyword: "pricing page generator",
          outcome_summary:
            "The MVP brief settles on a pricing page generator. This gives Product a concrete wedge to build; the remaining gap is validating demand with real founders.",
        },
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

  function writeEnvironmentBlockerArtifact(workspacePath: string): void {
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
          blocker_class: "environment_blocked",
          capability: "browser_screenshot",
          target_url: "http://localhost:4173/",
          proof: { status: "blocked_by_browser_sandbox", screenshot_path: null },
        },
        lineage: { proof_schema: "landing-page-file" },
      }),
      "utf8",
    );
  }

  it("keeps an environment-blocked blocker in place when its claim is not verified", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    writeEnvironmentBlockerArtifact(workspacePath);

    const artifact = captureBusinessArtifact({
      task: { ...createTaskRecord(), proofSchemaId: "landing-page-file" },
      proofs: [{ ...createProofRecord(), type: "file", uri: join(workspacePath, "index.html") }],
      workspacePath,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact.artifactKind).toBe("blocker");
  });

  it("degrades an environment-blocked blocker to a reviewable deliverable when the runtime verifies the claim", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    writeEnvironmentBlockerArtifact(workspacePath);

    const artifact = captureBusinessArtifact({
      task: { ...createTaskRecord(), proofSchemaId: "landing-page-file" },
      proofs: [{ ...createProofRecord(), type: "file", uri: join(workspacePath, "index.html") }],
      workspacePath,
      environmentBlockerVerification: {
        capability: "browser_screenshot",
        verified: true,
        checkedUrl: "http://localhost:4173/",
        status: 200,
      },
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact).toMatchObject({
      artifactKind: "deliverable",
      validationStatus: "valid",
      reviewStatus: "unreviewed",
    });
    expect(artifact.payload).toMatchObject({
      validationLimits: {
        capability: "browser_screenshot",
        status: "degraded_from_environment_blocked",
        checkedUrl: "http://localhost:4173/",
      },
    });
  });

  // The shape a real codex run left for task_cf0714bc "Capture Prototype Screenshot": an honest
  // blocker with a reachable local URL, but no `blocker_class`/`capability` gate keys.
  function writeNaturalScreenshotBlockerArtifact(workspacePath: string): void {
    mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".auto-crop", "business-artifact.json"),
      JSON.stringify({
        artifact_kind: "blocker",
        artifact_role: "validation",
        artifact_subtype: "prototype_screenshot_capture",
        task_type: "screenshot_capture",
        payload: {
          target_url: "http://127.0.0.1:4173/index.html?variant=A",
          server_validation: {
            status: "running",
            http_status: 200,
            url: "http://127.0.0.1:4173/index.html?variant=A",
          },
          proof: { schema: "screenshot", status: "blocked", created: false },
          capture_attempts: [{ method: "Playwright Chromium", result: "failed" }],
        },
        lineage: {},
      }),
      "utf8",
    );
  }

  it("reads a screenshot-capture blocker claim even without blocker_class/capability keys", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    writeNaturalScreenshotBlockerArtifact(workspacePath);

    expect(readEnvironmentBlockerClaim(workspacePath, [])).toEqual({
      capability: "browser_screenshot",
      url: "http://127.0.0.1:4173/index.html?variant=A",
      reachabilitySnapshot: { httpStatus: 200 },
    });
  });

  it("degrades a screenshot-capture blocker to a deliverable when the runtime verifies the claim", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    writeNaturalScreenshotBlockerArtifact(workspacePath);

    const artifact = captureBusinessArtifact({
      task: { ...createTaskRecord(), title: "Capture Prototype Screenshot", proofSchemaId: "screenshot" },
      proofs: [],
      workspacePath,
      environmentBlockerVerification: {
        capability: "browser_screenshot",
        verified: true,
        checkedUrl: "http://127.0.0.1:4173/index.html?variant=A",
        status: 200,
      },
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact).toMatchObject({
      artifactKind: "deliverable",
      validationStatus: "valid",
      reviewStatus: "unreviewed",
    });
    expect(artifact.payload).toMatchObject({
      validationLimits: { capability: "browser_screenshot", status: "degraded_from_environment_blocked" },
    });
  });

  it("records verifiedVia: capture_time_snapshot when the claim was confirmed from the snapshot", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    writeNaturalScreenshotBlockerArtifact(workspacePath);

    const artifact = captureBusinessArtifact({
      task: { ...createTaskRecord(), title: "Capture Prototype Screenshot", proofSchemaId: "screenshot" },
      proofs: [],
      workspacePath,
      environmentBlockerVerification: {
        capability: "browser_screenshot",
        verified: true,
        checkedUrl: "http://127.0.0.1:4173/index.html?variant=A",
        status: 200,
        verifiedVia: "capture_time_snapshot",
      },
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact.artifactKind).toBe("deliverable");
    expect(artifact.payload).toMatchObject({
      validationLimits: { verifiedVia: "capture_time_snapshot", httpStatus: 200 },
    });
  });

  it("isVerifiableEnvironmentBlocker requires blocker_class and capability", () => {
    expect(
      isVerifiableEnvironmentBlocker({ artifactKind: "blocker", payload: { blocker_class: "environment_blocked", capability: "browser_screenshot" } }),
    ).toBe(true);
    expect(isVerifiableEnvironmentBlocker({ artifactKind: "blocker", payload: { capability: "browser_screenshot" } })).toBe(false);
    expect(isVerifiableEnvironmentBlocker({ artifactKind: "deliverable", payload: { blocker_class: "environment_blocked", capability: "x" } })).toBe(false);
  });

  it("readEnvironmentBlockerClaim resolves the check URL by precedence", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    writeEnvironmentBlockerArtifact(workspacePath);

    expect(readEnvironmentBlockerClaim(workspacePath, [])).toEqual({
      capability: "browser_screenshot",
      url: "http://localhost:4173/",
      reachabilitySnapshot: null,
    });
  });

  it("readEnvironmentBlockerClaim falls back to a local-url proof", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".auto-crop", "business-artifact.json"),
      JSON.stringify({
        artifact_kind: "blocker",
        artifact_role: "validation",
        artifact_subtype: "screenshot",
        task_type: "t",
        payload: { blocker_class: "environment_blocked", capability: "browser_screenshot" },
        lineage: {},
      }),
      "utf8",
    );

    expect(
      readEnvironmentBlockerClaim(workspacePath, [{ ...createProofRecord(), type: "url", uri: "http://localhost:5173" }]),
    ).toEqual({ capability: "browser_screenshot", url: "http://localhost:5173", reachabilitySnapshot: null });
  });

  it("readEnvironmentBlockerClaim reads a reachability snapshot from server_validation", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".auto-crop", "business-artifact.json"),
      JSON.stringify({
        artifact_kind: "blocker",
        artifact_role: "validation",
        artifact_subtype: "screenshot",
        task_type: "t",
        payload: {
          blocker_class: "environment_blocked",
          capability: "browser_screenshot",
          target_url: "http://127.0.0.1:4173/",
          server_validation: { status: "running", http_status: 200 },
        },
        lineage: {},
      }),
      "utf8",
    );

    expect(readEnvironmentBlockerClaim(workspacePath, [])).toEqual({
      capability: "browser_screenshot",
      url: "http://127.0.0.1:4173/",
      reachabilitySnapshot: { httpStatus: 200 },
    });
  });

  it("readEnvironmentBlockerClaim ignores a non-numeric server_validation status", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".auto-crop", "business-artifact.json"),
      JSON.stringify({
        artifact_kind: "blocker",
        artifact_role: "validation",
        artifact_subtype: "screenshot",
        task_type: "t",
        payload: {
          blocker_class: "environment_blocked",
          capability: "browser_screenshot",
          target_url: "http://127.0.0.1:4173/",
          server_validation: { status: "running" },
        },
        lineage: {},
      }),
      "utf8",
    );

    expect(readEnvironmentBlockerClaim(workspacePath, [])?.reachabilitySnapshot).toBeNull();
  });

  it("verifyEnvironmentBlockerClaim passes on a 2xx response and fails otherwise", async () => {
    const ok = await verifyEnvironmentBlockerClaim({
      claim: { capability: "browser_screenshot", url: "http://localhost:4173/", reachabilitySnapshot: null },
      fetchImpl: async () => new Response("ok", { status: 200 }),
    });
    expect(ok.verified).toBe(true);
    expect(ok.verifiedVia).toBe("runtime_url_check");

    const notFound = await verifyEnvironmentBlockerClaim({
      claim: { capability: "browser_screenshot", url: "http://localhost:4173/", reachabilitySnapshot: null },
      fetchImpl: async () => new Response("nope", { status: 404 }),
    });
    expect(notFound.verified).toBe(false);
    expect(notFound.reason).toBe("non_2xx");

    const threw = await verifyEnvironmentBlockerClaim({
      claim: { capability: "browser_screenshot", url: "http://localhost:4173/", reachabilitySnapshot: null },
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(threw.verified).toBe(false);
    expect(threw.reason).toBe("fetch_failed");
  });

  it("verifyEnvironmentBlockerClaim refuses unknown capabilities and missing URLs", async () => {
    expect(
      (
        await verifyEnvironmentBlockerClaim({
          claim: { capability: "time_travel", url: "http://x/", reachabilitySnapshot: null },
        })
      ).reason,
    ).toBe("unsupported_capability");
    expect(
      (
        await verifyEnvironmentBlockerClaim({
          claim: { capability: "browser_screenshot", url: null, reachabilitySnapshot: null },
        })
      ).reason,
    ).toBe("no_verifiable_url");
  });

  it("verifyEnvironmentBlockerClaim falls back to the reachability snapshot when the server is gone", async () => {
    const result = await verifyEnvironmentBlockerClaim({
      claim: {
        capability: "browser_screenshot",
        url: "http://127.0.0.1:4173/index.html?variant=A",
        reachabilitySnapshot: { httpStatus: 200 },
      },
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(result).toMatchObject({ verified: true, verifiedVia: "capture_time_snapshot", status: 200 });
  });

  it("verifyEnvironmentBlockerClaim prefers the live check over the snapshot when both confirm", async () => {
    const result = await verifyEnvironmentBlockerClaim({
      claim: {
        capability: "browser_screenshot",
        url: "http://127.0.0.1:4173/",
        reachabilitySnapshot: { httpStatus: 200 },
      },
      fetchImpl: async () => new Response("ok", { status: 200 }),
    });
    expect(result.verifiedVia).toBe("runtime_url_check");
  });

  it("verifyEnvironmentBlockerClaim keeps the blocker when the server is gone and the snapshot is non-2xx", async () => {
    const result = await verifyEnvironmentBlockerClaim({
      claim: {
        capability: "browser_screenshot",
        url: "http://127.0.0.1:4173/",
        reachabilitySnapshot: { httpStatus: 500 },
      },
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("fetch_failed");
  });

  it("verifyEnvironmentBlockerClaim keeps the blocker when a live non-2xx contradicts a 2xx snapshot", async () => {
    const result = await verifyEnvironmentBlockerClaim({
      claim: {
        capability: "browser_screenshot",
        url: "http://127.0.0.1:4173/",
        reachabilitySnapshot: { httpStatus: 200 },
      },
      fetchImpl: async () => new Response("gone", { status: 404 }),
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("non_2xx");
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
          outcome_summary:
            "Research points to a resume bullet point generator as the strongest first opportunity. It sets the direction for the objective; the remaining gap is confirming live search volume before building.",
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

  it("fails structural validation when a deliverable omits the Task Outcome Summary", () => {
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
        payload: { selected_keyword: "pricing page generator" },
        lineage: {},
      }),
      "utf8",
    );

    const artifact = captureBusinessArtifact({
      task: { ...createTaskRecord(), proofSchemaId: "generic-proof" },
      proofs: [createProofRecord()],
      workspacePath,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact.validationStatus).toBe("invalid_schema");
    expect(artifact.validationErrors).toContain(
      "payload.outcome_summary: Required for deliverable and final_report artifacts (non-empty string or { en, zh }).",
    );
  });

  it("accepts a localized-object Task Outcome Summary on a final_report", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-business-artifact-"));
    createdDirs.push(workspacePath);
    mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".auto-crop", "business-artifact.json"),
      JSON.stringify({
        artifact_kind: "final_report",
        artifact_role: "report",
        artifact_subtype: "final_founder_report",
        task_type: "founder_report",
        payload: {
          outcome_summary: { en: "The launch path is proven.", zh: "发布路径已验证。" },
        },
        lineage: {},
      }),
      "utf8",
    );

    const artifact = captureBusinessArtifact({
      task: { ...createTaskRecord(), proofSchemaId: "generic-proof" },
      proofs: [createProofRecord()],
      workspacePath,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: () => "business_artifact_1",
    });

    expect(artifact.validationStatus).toBe("valid");
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
