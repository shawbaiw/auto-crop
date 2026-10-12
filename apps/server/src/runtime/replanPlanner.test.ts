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
      stuck: { holds: [], blocker: null, failedVerdicts: [], lastRejection: null },
      requestedMode: null,
      founderNote: null,
      revisable: { editable: [], sourced: [] },
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

  // ADR 0043: the planner is told why the task is stuck, not only that it is, because a task asked for
  // what its environment cannot provide needs a Revision, and no Split helps it.
  it("tells the planner why the task is stuck, what the founder asked, and which standards it may amend", () => {
    const verifier = { ...createTaskRecord("verifier_task", "Check the keyword"), verificationRequirements: [{ id: "meets-thresholds", description: "Ahrefs KD <= 15" }] };
    const prompt = buildReplanPlannerPrompt({
      company: createCompanyRecord(),
      sourceTask: createTaskRecord("source_task", "Pick a low-KD keyword"),
      downstreamTasks: [],
      proofSchemas: aiSaasPlaybook.proofSchemas,
      stuck: {
        holds: [{ kind: "awaiting_human_action", reason: "Human Action required: Ahrefs KD for five keywords" }],
        blocker: {
          subtype: "keyword_data_unavailable",
          payload: { reason: "Every KD source needs a login." },
          unblockRequest: { needed: "Ahrefs KD for five keywords", why: "Every KD source needs a login.", evidenceRequirements: ["KD keyword-a"] },
        },
        failedVerdicts: [{ verifierTitle: "Check the keyword", outcome: "failed", issues: [], checks: [{ requirementId: "meets-thresholds", description: "Ahrefs KD <= 15", outcome: "failed", evidence: "No KD value." }] }],
        lastRejection: { rationale: "Split into five lookups.", note: "Splitting does not help; every piece needs KD." },
      },
      requestedMode: "revision",
      founderNote: "Accept a SERP-based difficulty estimate instead of KD.",
      revisable: {
        editable: [{ verifier, requirements: verifier.verificationRequirements }],
        sourced: [{ verifier: createTaskRecord("other_verifier", "Audit"), producer: createTaskRecord("define_task", "Define checks") }],
      },
    });

    expect(prompt).toContain("Hold `awaiting_human_action`: Human Action required: Ahrefs KD for five keywords");
    expect(prompt).toContain("Every KD source needs a login.");
    expect(prompt).toContain("- Needed: Ahrefs KD for five keywords");
    expect(prompt).toContain("`meets-thresholds` (failed): Ahrefs KD <= 15 — evidence: No KD value.");
    expect(prompt).toContain("Founder's reason: Splitting does not help; every piece needs KD.");
    expect(prompt).toContain("Mode: revision");
    expect(prompt).toContain("Note: Accept a SERP-based difficulty estimate instead of KD.");
    expect(prompt).toContain("Verifier verifier_task (Check the keyword) — planned, a Revision may amend:");
    expect(prompt).toContain("takes its requirements from task define_task (Define checks); they cannot be amended here — revise that task instead.");
    expect(prompt).toContain("A split never changes a requirement");
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
    expect(parsed.mode).toBe("split");
    expect(parsed.mode === "split" && parsed.replacementTasks.map((task) => task.title)).toEqual([
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
            replacementTasks: [1, 2].map(() => ({
              title: "Do unbounded work",
              description: "This should not parse.",
              requiredCapabilities: ["code"],
              proofSchemaId: "made-up-proof",
              riskLevel: "medium",
            })),
          }),
          "```",
        ].join("\n"),
        aiSaasPlaybook,
      ),
    ).toThrow(/unsupported proof schema/i);
  });

  const revision = {
    mode: "revision",
    rationale: "KD is unobtainable without a login; accept a SERP-based estimate.",
    revisedTask: {
      title: "Pick a low-difficulty keyword",
      description: "Rank candidates by a SERP-based difficulty estimate, stating the method.",
      proofSchemaId: "research-report",
      requiredCapabilities: ["research"],
    },
    requirementChanges: [{ verifierTaskId: "verifier_task", requirements: [{ id: "meets-thresholds", description: "Estimated difficulty is low, with the method stated." }] }],
  };
  const fence = (value: unknown) => ["```json", JSON.stringify(value), "```"].join("\n");
  const context = { requestedMode: null, editableVerifierIds: ["verifier_task"] };

  it("parses a Revision with an amendment to a verifier's planned requirements", () => {
    const parsed = parseReplanPlannerOutput(fence(revision), aiSaasPlaybook, context);
    expect(parsed).toMatchObject({ mode: "revision", revisedTask: revision.revisedTask, requirementChanges: revision.requirementChanges });
  });

  it("holds a Revision to what it may change", () => {
    expect(() => parseReplanPlannerOutput(fence({ ...revision, requirementChanges: [{ ...revision.requirementChanges[0], verifierTaskId: "elsewhere" }] }), aiSaasPlaybook, context))
      .toThrow(/not a verifier with planned requirements/);
    expect(() => parseReplanPlannerOutput(fence({ ...revision, revisedTask: { ...revision.revisedTask, dependsOnTaskIds: ["x"] } }), aiSaasPlaybook, context))
      .toThrow(/cannot change dependsOnTaskIds/);
    expect(() => parseReplanPlannerOutput(fence(revision), aiSaasPlaybook, { ...context, requestedMode: "split" }))
      .toThrow(/asked for a split/);
  });

  it("never lets a Split change the standard, and keeps it to 2 to 5 tasks", () => {
    const task = { title: "t", description: "d", requiredCapabilities: ["research"], proofSchemaId: "research-report", riskLevel: "low" };
    expect(() => parseReplanPlannerOutput(fence({ mode: "split", rationale: "r", replacementTasks: [task, task], requirementChanges: revision.requirementChanges }), aiSaasPlaybook, context))
      .toThrow(/split cannot change verification requirements/);
    expect(() => parseReplanPlannerOutput(fence({ mode: "split", rationale: "r", replacementTasks: [task] }), aiSaasPlaybook, context))
      .toThrow(/2 to 5/);
  });
});

function createCompanyRecord(): Company {
  return {
    id: "company_1",
    name: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    locale: "en",
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
