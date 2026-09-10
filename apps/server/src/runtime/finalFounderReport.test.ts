import { describe, expect, it } from "vitest";
import type {
  Company,
  Department,
  KeyResult,
  Objective,
  Task,
} from "@auto-crop/core";
import {
  buildDeterministicFinalFounderReportSections,
  buildFinalFounderReportPrompt,
  type BuildFinalFounderReportPromptInput,
} from "./finalFounderReport";

describe("buildFinalFounderReportPrompt", () => {
  it("tells the CEO Agent to author every section in the company language and drops the bilingual contract", () => {
    const prompt = buildFinalFounderReportPrompt(promptInput({ locale: "zh" }));

    expect(prompt).toContain("## Company Language");
    expect(prompt).toContain(
      "Author every section value — `vision`, `actualResult`, each `departmentContributions` entry,",
    );
    expect(prompt).toContain("in 简体中文 (Simplified Chinese)");
    expect(prompt).toContain(
      "Do not translate machine identifiers, file paths, URLs, code, or brand names",
    );
    expect(prompt).toContain(
      "Each section value is a single plain string authored in 简体中文 (Simplified Chinese)",
    );
    // The "provide both locales" bilingual output contract is gone.
    expect(prompt).not.toContain("provide both locales");
    expect(prompt).not.toContain('{ en: "The founder\'s original vision, restated."');
  });

  it("localizes the JSON example section values to the company language", () => {
    const zhPrompt = buildFinalFounderReportPrompt(promptInput({ locale: "zh" }));
    const enPrompt = buildFinalFounderReportPrompt(promptInput({ locale: "en" }));

    expect(zhPrompt).toContain('"vision": "复述创始人的原始愿景。"');
    expect(zhPrompt).toContain('"复述创始人的原始愿景。"');
    // Example values are bare strings, not { en, zh } objects.
    expect(zhPrompt).not.toMatch(/"vision":\s*{/);

    expect(enPrompt).toContain('"vision": "The founder\'s original vision, restated."');
    expect(enPrompt).not.toMatch(/[一-鿿]/);
  });
});

describe("buildDeterministicFinalFounderReportSections", () => {
  it("still produces a readable report in both locales when the agent output is unusable", () => {
    const sections = buildDeterministicFinalFounderReportSections({
      ...promptInput({ locale: "zh" }),
      taskDependencies: [],
    });

    for (const value of [
      sections.vision,
      sections.actualResult,
      sections.goalFit,
      sections.remainingGaps,
      sections.recommendedNextStep,
    ]) {
      expect((value.en ?? "").trim().length).toBeGreaterThan(0);
      expect((value.zh ?? "").trim().length).toBeGreaterThan(0);
    }
    expect(sections.departmentContributions.length).toBeGreaterThan(0);
    expect((sections.departmentContributions[0]?.zh ?? "").trim().length).toBeGreaterThan(0);
  });
});

function promptInput(overrides: { locale: Company["locale"] }): BuildFinalFounderReportPromptInput {
  return {
    company: createCompanyRecord(overrides.locale),
    classification: "waiting",
    tasks: [createTaskRecord()],
    departments: [createDepartmentRecord()],
    objectives: [createObjectiveRecord()],
    keyResults: [createKeyResultRecord()],
    taskCompletionEvents: [],
    businessArtifacts: [],
    visionGaps: [],
    waitStates: [],
    humanActions: [],
    founderDecisions: [],
  };
}

function createCompanyRecord(locale: Company["locale"]): Company {
  return {
    id: "company_1",
    name: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    locale,
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    status: "active",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };
}

function createDepartmentRecord(): Department {
  return {
    id: "department_1",
    companyId: "company_1",
    name: "Engineering",
    responsibility: "Build and validate the product.",
    leadAgentId: "codex",
    memoryPath: ".auto-crop/companies/company_1/departments/engineering/memory.md",
  };
}

function createObjectiveRecord(): Objective {
  return {
    id: "objective_1",
    companyId: "company_1",
    title: "Validate the first wedge",
    status: "active",
    priority: 1,
  };
}

function createKeyResultRecord(): KeyResult {
  return {
    id: "key_result_1",
    objectiveId: "objective_1",
    title: "Ship proof-backed prototype",
    metricName: "prototype_status",
    targetValue: "local_url",
    currentValue: "not_started",
    status: "active",
  };
}

function createTaskRecord(): Task {
  return {
    id: "task_1",
    companyId: "company_1",
    departmentId: "department_1",
    departmentKey: "engineering",
    keyResultId: "key_result_1",
    title: "Create landing page",
    titleText: null,
    description: "Build the landing page prototype.",
    descriptionText: null,
    assigneeAgentId: "mock-worker",
    requiredCapabilities: ["code"],
    proofSchemaId: "landing-page-file",
    workspacePath: null,
    artifactWorkspacePath: null,
    status: "complete",
    riskLevel: "low",
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
  };
}
