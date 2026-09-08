import { describe, expect, it } from "vitest";
import type { Company, Task } from "@auto-crop/core";
import type { TaskHandoff } from "./dependencyReadiness";
import { buildTaskExecutionPrompt } from "./taskExecutionPrompt";

describe("buildTaskExecutionPrompt", () => {
  it("makes company context mandatory for first tasks without upstream handoffs", () => {
    const prompt = buildTaskExecutionPrompt({
      company: createCompanyRecord({
        name: "matt",
        founderVision:
          "Find an English SEO opportunity, build a small website or web product, rank it in Google, and validate the launch-to-indexing loop.",
      }),
      task: createTaskRecord({
        title: "Find and validate the first keyword opportunity",
        description:
          "Research English keyword candidates, search intent, competitor pages, SERP difficulty, content gaps, and monetization signals.",
        proofSchemaId: "research-report",
      }),
      handoffs: [],
    });

    expect(prompt).toContain("## Company Context");
    expect(prompt).toContain("Company Name: matt");
    expect(prompt).toContain(
      "Founder Vision: Find an English SEO opportunity, build a small website or web product, rank it in Google, and validate the launch-to-indexing loop.",
    );
    expect(prompt).toContain("Do not infer product direction from examples, placeholders, repository names, or previous work");
    expect(prompt).toContain("## Current Task");
    expect(prompt).toContain("Task Title: Find and validate the first keyword opportunity");
    expect(prompt).toContain("Original Proof Schema: research-report");
    expect(prompt).toContain("## Structured Execution Report");
    expect(prompt).toContain("`conclusion`, `vision_impact`, `remaining_gap`, and `recommendation`");
    expect(prompt).toContain("Also include `outcome_summary` for compatibility");
  });

  it("keeps accepted upstream business handoffs inside the same execution prompt contract", () => {
    const prompt = buildTaskExecutionPrompt({
      company: createCompanyRecord(),
      task: createTaskRecord({
        title: "Define the MVP product wedge",
        description: "Turn the selected keyword into a narrow product concept.",
        proofSchemaId: "product-brief",
      }),
      handoffs: [
        {
          upstreamTaskId: "task_research",
          upstreamTaskTitle: "Find and validate the first keyword opportunity",
          businessArtifactId: "business_artifact_research",
          artifactKind: "deliverable",
          artifactRole: "findings",
          artifactSubtype: "keyword_research",
          artifactType: "research_findings",
          taskType: "research.seo_keyword_opportunity",
          payload: { primary_keyword: "json to csv converter" },
          lineage: { founder_vision: "Find an SEO opportunity and build a lightweight web product." },
          proofId: "proof_research",
          proofType: "file",
          uri: "research-report.md",
          summary: "Keyword research findings.",
          artifactWorkspacePath: "/tmp/research-workspace",
          handoffContract: "Use the accepted keyword research before product planning.",
          handoffPackagePath: "/tmp/research-workspace/.auto-crop-handoff/package.json",
        } satisfies TaskHandoff,
      ],
    });

    expect(prompt).toContain("## Company Context");
    expect(prompt).toContain("## Upstream Handoffs");
    expect(prompt).toContain("Business Artifact: deliverable / findings / keyword_research / business_artifact_research");
    expect(prompt).toContain('"primary_keyword":"json to csv converter"');
    expect(prompt).toContain("Handoff Contract: Use the accepted keyword research before product planning.");
  });
});

function createCompanyRecord(overrides: Partial<Company> = {}): Company {
  return {
    id: "company_1",
    name: "Launch Loop Lab",
    founderVision: "Find an SEO opportunity and build a lightweight web product.",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    status: "active",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

function createTaskRecord(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_1",
    companyId: "company_1",
    departmentId: "department_1",
    departmentKey: "research",
    keyResultId: "key_result_1",
    title: "Task 1",
    titleText: null,
    description: "Run task work.",
    descriptionText: null,
    assigneeAgentId: "mock-worker",
    requiredCapabilities: ["research", "writing"],
    proofSchemaId: "research-report",
    workspacePath: null,
    artifactWorkspacePath: null,
    status: "queued",
    riskLevel: "medium",
    position: 0,
    latestFailureReason: null,
    latestFailureMessage: null,
    latestExecutionProfileName: null,
    latestRequestedTimeoutMs: null,
    latestEffectiveTimeoutMs: null,
    dependencyNote: null,
    parentTaskId: null,
    taskKind: "parent",
    source: "ceo",
    ...overrides,
  };
}
