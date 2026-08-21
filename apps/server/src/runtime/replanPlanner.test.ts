import { describe, expect, it } from "vitest";
import type { Company, Task } from "@auto-crop/core";
import { aiSaasPlaybook } from "../playbooks/aiSaas";
import { buildReplanPlannerPrompt, parseReplanPlannerOutput } from "./replanPlanner";

describe("replan planner prompt", () => {
  it("asks for strict JSON using source task, downstream consumers, and allowed proof schemas", () => {
    const prompt = buildReplanPlannerPrompt({
      company: createCompanyRecord(),
      sourceTask: createTaskRecord("source_task", "Build full prototype"),
      downstreamTasks: [createTaskRecord("consumer_task", "Validate full prototype")],
      proofSchemas: aiSaasPlaybook.proofSchemas,
    });

    expect(prompt).toContain("## Source Task");
    expect(prompt).toContain("Build full prototype");
    expect(prompt).toContain("## Downstream Consumers");
    expect(prompt).toContain("Validate full prototype");
    expect(prompt).toContain("landing-page-file");
    expect(prompt).toContain("Strict JSON");
    expect(prompt).toContain("replacementTasks");
    expect(prompt).toContain("```json");
  });
});

describe("parseReplanPlannerOutput", () => {
  it("parses a valid fenced planner response", () => {
    const parsed = parseReplanPlannerOutput(
      [
        "## Replan",
        "```json",
        JSON.stringify({
          rationale: "Split the oversized prototype into a brief, implementation, and validation handoff.",
          replacementTasks: [
            {
              title: "Define the smallest playable prototype slice",
              description: "Write the constraints and acceptance criteria for the smaller prototype.",
              requiredCapabilities: ["writing", "research"],
              proofSchemaId: "product-brief",
              riskLevel: "low",
            },
            {
              title: "Build the smaller playable prototype",
              description: "Implement only the approved slice and produce runnable files.",
              requiredCapabilities: ["code", "frontend"],
              proofSchemaId: "landing-page-file",
              riskLevel: "medium",
            },
          ],
        }),
        "```",
      ].join("\n"),
      aiSaasPlaybook,
    );

    expect(parsed.rationale).toMatch(/oversized prototype/i);
    expect(parsed.replacementTasks.map((task) => task.title)).toEqual([
      "Define the smallest playable prototype slice",
      "Build the smaller playable prototype",
    ]);
  });

  it("rejects replacement proof schemas outside the playbook", () => {
    expect(() =>
      parseReplanPlannerOutput(
        [
          "```json",
          JSON.stringify({
            rationale: "Bad proof schema.",
            replacementTasks: [
              {
                title: "Do unbounded work",
                description: "This should not parse.",
                requiredCapabilities: ["code"],
                proofSchemaId: "made-up-proof",
                riskLevel: "medium",
              },
            ],
          }),
          "```",
        ].join("\n"),
        aiSaasPlaybook,
      ),
    ).toThrow(/unsupported proof schema/i);
  });
});

function createCompanyRecord(): Company {
  return {
    id: "company_1",
    name: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    status: "active",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };
}

function createTaskRecord(id: string, title: string): Task {
  return {
    id,
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    title,
    description: `Original description for ${title}.`,
    assigneeAgentId: "codex",
    requiredCapabilities: ["code", "frontend"],
    proofSchemaId: "landing-page-file",
    workspacePath: null,
    artifactWorkspacePath: null,
    status: "needs_replan",
    riskLevel: "medium",
    position: 0,
  };
}
