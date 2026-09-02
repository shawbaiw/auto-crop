import { describe, expect, it } from "vitest";
import { aiSaasPlaybook } from "../playbooks/aiSaas";
import { buildCeoPrompt } from "./ceoPrompt";
import { parseCeoOutput } from "./ceoParser";

const validBlueprint = aiSaasPlaybook.createBlueprint({
  companyName: "Pricing Page Studio",
  founderVision: "Build an AI SaaS that creates pricing pages.",
  preferredEngineeringAgentId: "codex",
  preferredStrategyAgentId: "claude-code",
});

describe("buildCeoPrompt", () => {
  it("includes founder vision, selected playbook, agents, permission mode, assets, and strict JSON instructions", () => {
    const prompt = buildCeoPrompt({
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      playbook: aiSaasPlaybook,
      availableAgents: [
        { id: "codex", name: "Codex", capabilities: ["code", "frontend"] },
        { id: "claude-code", name: "Claude Code", capabilities: ["writing", "research"] },
      ],
      permissionMode: "balanced",
      assets: ["README.md", "docs/research.md"],
    });

    expect(prompt).toContain("Build an AI SaaS that creates pricing pages.");
    expect(prompt).toContain("## Company Name");
    expect(prompt).toContain("Use the provided company name exactly");
    expect(prompt).toContain("Pricing Page Studio");
    expect(prompt).toContain("AI SaaS");
    expect(prompt).toContain("codex");
    expect(prompt).toContain("claude-code");
    expect(prompt).toContain("balanced");
    expect(prompt).toContain("README.md");
    expect(prompt).toContain("Human CEO Brief");
    expect(prompt).toContain("Strict JSON");
    expect(prompt).toContain("dependsOnTaskKeys");
    expect(prompt).toContain("handoffContract");
    expect(prompt).toContain("nameText");
    expect(prompt).toContain("titleText");
    expect(prompt).toContain("descriptionText");
    expect(prompt).toContain("handoffContractText");
    expect(prompt).toContain("Provide Localized Business Content in English and Chinese");
    expect(prompt).toContain("Dependencies must reference earlier task keys");
    expect(prompt).toContain("```json");
  });
});

describe("parseCeoOutput", () => {
  it("parses a valid fenced strict JSON response", () => {
    const response = parseCeoOutput(
      [
        "## Human CEO Brief",
        "Validate the wedge first.",
        "",
        "## Strict JSON",
        "```json",
        JSON.stringify({ brief: "Validate the wedge first.", blueprint: validBlueprint }),
        "```",
      ].join("\n"),
      aiSaasPlaybook,
    );

    expect(response.blueprint.company.name).toBe("Pricing Page Studio");
    expect(response.blueprint.departments[0]?.nameText?.zh).toBe("产品");
    expect(response.blueprint.tasks[0]?.titleText?.zh).toBe("撰写第一份产品简报");
  });

  it("keeps legacy single-string blueprint output valid with explicit localized fallback", () => {
    const legacyBlueprint = {
      ...validBlueprint,
      departments: validBlueprint.departments.map(({ key: _key, nameText: _nameText, responsibilityText: _responsibilityText, ...department }) => department),
      objectives: validBlueprint.objectives.map(({ titleText: _titleText, keyResults, ...objective }) => ({
        ...objective,
        keyResults: keyResults.map(({ titleText: _krTitleText, targetValueText: _targetValueText, currentValueText: _currentValueText, ...keyResult }) => keyResult),
      })),
      tasks: validBlueprint.tasks.map(
        ({ departmentKey: _departmentKey, titleText: _titleText, descriptionText: _descriptionText, handoffContractText: _handoffContractText, ...task }) => task,
      ),
    };

    const response = parseCeoOutput(
      ["```json", JSON.stringify({ brief: "Legacy.", blueprint: legacyBlueprint }), "```"].join("\n"),
      aiSaasPlaybook,
    );

    expect(response.blueprint.departments[0]?.nameText).toEqual({ en: "Product", zh: "Product" });
    expect(response.blueprint.tasks[0]?.titleText).toEqual({
      en: "Write the first product brief",
      zh: "Write the first product brief",
    });
  });

  it("rejects malformed strict JSON", () => {
    expect(() =>
      parseCeoOutput(
        ["## Strict JSON", "```json", "{ bad json", "```"].join("\n"),
        aiSaasPlaybook,
      ),
    ).toThrow(/invalid/i);
  });

  it("rejects task proof schemas outside the selected playbook", () => {
    const blueprint = {
      ...validBlueprint,
      proofSchemas: [
        ...validBlueprint.proofSchemas,
        {
          id: "made-up-proof",
          description: "Not part of the selected playbook.",
          acceptedTypes: ["file"],
        },
      ],
      tasks: [
        {
          ...validBlueprint.tasks[0],
          proofSchemaId: "made-up-proof",
        },
      ],
    };

    expect(() =>
      parseCeoOutput(
        ["```json", JSON.stringify({ brief: "Bad proof schema.", blueprint }), "```"].join("\n"),
        aiSaasPlaybook,
      ),
    ).toThrow(/unsupported proof schema/i);
  });

  it("normalizes a non-collectable task proof schema to test-output instead of throwing", () => {
    const blueprint = {
      ...validBlueprint,
      proofSchemas: [
        ...validBlueprint.proofSchemas,
        {
          id: "screenshot",
          description: "A screenshot proving the prototype renders.",
          acceptedTypes: ["screenshot"],
        },
      ],
      tasks: validBlueprint.tasks.map((task, index) =>
        index === 0 ? { ...task, proofSchemaId: "screenshot" } : task,
      ),
    };

    const response = parseCeoOutput(
      ["```json", JSON.stringify({ brief: "Screenshot task.", blueprint }), "```"].join("\n"),
      aiSaasPlaybook,
    );

    expect(response.blueprint.tasks[0]?.proofSchemaId).toBe("test-output");
    expect(response.proofSchemaNormalizations).toEqual([
      { taskKey: validBlueprint.tasks[0]!.key, from: "screenshot", to: "test-output", reason: "not_collectable" },
    ]);
    expect(response.blueprint.proofSchemas.some((proofSchema) => proofSchema.id === "screenshot")).toBe(false);
  });

  it("rejects departments outside the selected playbook", () => {
    const blueprint = {
      ...validBlueprint,
      departments: [
        ...validBlueprint.departments,
        {
          name: "Legal",
          responsibility: "Review legal documents.",
          leadAgentId: "claude-code",
        },
      ],
      tasks: [
        {
          ...validBlueprint.tasks[0],
          departmentName: "Legal",
        },
      ],
    };

    expect(() =>
      parseCeoOutput(
        ["```json", JSON.stringify({ brief: "Bad department.", blueprint }), "```"].join("\n"),
        aiSaasPlaybook,
      ),
    ).toThrow(/unsupported department/i);
  });
});
