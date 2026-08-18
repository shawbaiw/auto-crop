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
