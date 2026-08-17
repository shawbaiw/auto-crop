import { describe, expect, it } from "vitest";
import { companyBlueprintSchema } from "@auto-crop/core";
import { aiSaasPlaybook } from "./aiSaas";
import { selectPlaybook } from "./selectPlaybook";

describe("AI SaaS playbook", () => {
  it("defines the required playbook interface fields", () => {
    expect(aiSaasPlaybook.id).toBe("ai-saas");
    expect(aiSaasPlaybook.suitableFor).toContain("AI tools");
    expect(aiSaasPlaybook.defaultDepartments.map((department) => department.name)).toEqual([
      "Product",
      "Research",
      "Growth",
      "Engineering",
    ]);
    expect(aiSaasPlaybook.okrTemplates.length).toBeGreaterThan(0);
    expect(aiSaasPlaybook.taskTemplates.length).toBeGreaterThan(0);
    expect(aiSaasPlaybook.reviewCriteria.length).toBeGreaterThan(0);
  });

  it("includes proof schemas for first-version SaaS proof", () => {
    expect(aiSaasPlaybook.proofSchemas.map((proofSchema) => proofSchema.id)).toEqual([
      "product-brief",
      "research-report",
      "landing-page-file",
      "repo-diff",
      "test-output",
      "local-url",
      "screenshot",
      "deployment-url",
    ]);
  });

  it("creates a valid company blueprint from a founder vision", () => {
    const blueprint = aiSaasPlaybook.createBlueprint({
      companyName: "Pricing Page Studio",
      founderVision:
        "Build an AI SaaS that helps independent developers create better pricing pages.",
      preferredEngineeringAgentId: "codex",
      preferredStrategyAgentId: "claude-code",
    });

    const result = companyBlueprintSchema.safeParse(blueprint);

    expect(result.success).toBe(true);
    expect(blueprint.tasks.some((task) => task.departmentName === "Engineering")).toBe(true);
    expect(blueprint.tasks.some((task) => task.proofSchemaId === "landing-page-file")).toBe(true);
  });
});

describe("selectPlaybook", () => {
  it("maps free-form SaaS visions to the AI SaaS playbook", () => {
    const playbook = selectPlaybook(
      "I want to build a small AI SaaS that generates pricing pages for indie hackers.",
    );

    expect(playbook.id).toBe("ai-saas");
  });

  it("maps AI tool visions to the AI SaaS playbook", () => {
    const playbook = selectPlaybook("Create an AI tool for Shopify product page optimization.");

    expect(playbook.id).toBe("ai-saas");
  });
});
