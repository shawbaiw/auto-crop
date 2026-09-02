import { describe, expect, it } from "vitest";
import { companyBlueprintSchema } from "@auto-crop/core";
import { aiSaasPlaybook } from "./aiSaas";
import { selectPlaybook } from "./selectPlaybook";

describe("AI SaaS playbook", () => {
  it("defines the required playbook interface fields", () => {
    expect(aiSaasPlaybook.id).toBe("ai-saas");
    expect(aiSaasPlaybook.suitableFor).toContain("AI tools");
    expect(aiSaasPlaybook.defaultDepartments.map((department) => department.key)).toEqual([
      "product",
      "research",
      "growth",
      "engineering",
    ]);
    expect(aiSaasPlaybook.defaultDepartments[0]?.nameText).toEqual({ en: "Product", zh: "产品" });
    expect(aiSaasPlaybook.okrTemplates.length).toBeGreaterThan(0);
    expect(aiSaasPlaybook.taskTemplates.length).toBeGreaterThan(0);
    expect(aiSaasPlaybook.reviewCriteria.length).toBeGreaterThan(0);
  });

  it("includes only Collectable Proof Schemas for first-version SaaS proof", () => {
    expect(aiSaasPlaybook.proofSchemas.map((proofSchema) => proofSchema.id)).toEqual([
      "product-brief",
      "research-report",
      "landing-page-file",
      "repo-diff",
      "test-output",
      "local-url",
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
    expect(blueprint.departments.find((department) => department.key === "engineering")?.nameText).toEqual({
      en: "Engineering",
      zh: "工程",
    });
    expect(blueprint.objectives[0]?.titleText).toEqual({
      en: "Validate the first AI SaaS wedge",
      zh: "验证第一个 AI SaaS 切入点",
    });
    expect(blueprint.tasks.find((task) => task.key === "landing_page_prototype")?.departmentKey).toBe("engineering");
    expect(blueprint.tasks.find((task) => task.key === "landing_page_prototype")?.titleText).toEqual({
      en: "Create the first landing page prototype",
      zh: "创建第一个落地页原型",
    });
    expect(blueprint.tasks.some((task) => task.proofSchemaId === "landing-page-file")).toBe(true);
  });

  it("localizes playbook-authored proof schemas, review criteria, and handoff contracts", () => {
    expect(aiSaasPlaybook.proofSchemas.find((proofSchema) => proofSchema.id === "product-brief")?.descriptionText).toEqual({
      en: "A product or growth brief stored as a file artifact.",
      zh: "以文件产物形式保存的产品或增长简报。",
    });
    expect(aiSaasPlaybook.reviewCriteriaText[0]).toEqual({
      en: "Every completed task must include proof matching its proof schema.",
      zh: "每个已完成任务都必须包含与其 proof schema 匹配的证明。",
    });
    expect(aiSaasPlaybook.taskTemplates[0]?.handoffContractText).toEqual({
      en: "Produce a concise product brief with target customer, wedge, MVP scope, and first revenue path.",
      zh: "产出一份简洁的产品简报，包含目标客户、切入点、MVP 范围和第一条收入路径。",
    });
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
