import { describe, expect, it } from "vitest";
import { parseArtifactEnvelope } from "./artifactEnvelope";

describe("parseArtifactEnvelope", () => {
  it("accepts a valid envelope with optional refs", () => {
    const parsed = parseArtifactEnvelope({
      artifact_kind: "deliverable",
      artifact_role: "implementation",
      artifact_subtype: "prototype",
      task_type: "engineering.prototype",
      payload: { outcome_summary: "Done." },
      lineage: {},
      proof_refs: [{ type: "url", uri: "http://localhost:3000", summary: "Preview" }],
      file_refs: [{ path: "dist/index.html", description: "Built page" }],
    });

    expect(parsed).toMatchObject({
      success: true,
      value: {
        artifactKind: "deliverable",
        artifactRole: "implementation",
        artifactSubtype: "prototype",
        taskType: "engineering.prototype",
        proofRefs: [{ type: "url", uri: "http://localhost:3000", summary: "Preview" }],
        fileRefs: [{ path: "dist/index.html", description: "Built page" }],
      },
    });
  });

  it("rejects unsupported kind and role", () => {
    const parsed = parseArtifactEnvelope({
      artifact_kind: "note",
      artifact_role: "memo",
      artifact_subtype: "x",
      task_type: "task",
      payload: {},
      lineage: {},
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.errors).toContain("artifactKind/artifact_kind: Expected a supported business artifact kind.");
      expect(parsed.errors).toContain("artifactRole/artifact_role: Expected a supported business artifact role.");
    }
  });

  it("requires payload and lineage", () => {
    const parsed = parseArtifactEnvelope({
      artifact_kind: "blocker",
      artifact_role: "none",
      artifact_subtype: "missing_access",
      task_type: "research",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.errors).toContain("payload: Required.");
      expect(parsed.errors).toContain("lineage: Required.");
    }
  });

  it("reports malformed refs", () => {
    const parsed = parseArtifactEnvelope({
      artifact_kind: "deliverable",
      artifact_role: "findings",
      artifact_subtype: "scan",
      task_type: "research.scan",
      payload: {},
      lineage: {},
      proof_refs: [{ type: "", uri: "" }],
      file_refs: [{ path: 1 }],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.errors).toContain("proofRefs[0].type: Expected a supported proof type.");
      expect(parsed.errors).toContain("proofRefs[0].uri: Expected a non-empty string.");
      expect(parsed.errors).toContain("fileRefs[0].path: Expected a non-empty string.");
    }
  });

  it("ignores identity fields instead of passing them through", () => {
    const parsed = parseArtifactEnvelope({
      taskId: "fake_task",
      company_id: "fake_company",
      runId: "fake_run",
      artifact_kind: "deliverable",
      artifact_role: "plan",
      artifact_subtype: "launch_plan",
      task_type: "growth.launch",
      payload: {},
      lineage: {},
    });

    expect(parsed.success).toBe(true);
    expect(parsed.ignoredIdentityFields).toEqual(["taskId", "company_id", "runId"]);
    if (parsed.success) {
      expect(parsed.value).not.toHaveProperty("taskId");
      expect(parsed.value).not.toHaveProperty("companyId");
      expect(parsed.value).not.toHaveProperty("runId");
    }
  });
});
