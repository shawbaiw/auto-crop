import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_VERIFICATION_ROUNDS, type BusinessArtifact, type Task } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest } from "../adapters/types";
import { createMockAgentAdapter } from "../adapters/mockAgent";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { aiSaasPlaybook } from "../playbooks/aiSaas";
import { getDefaultPolicy } from "../policies/defaults";
import { createCompany } from "./createCompany";
import { capabilitiesNewlyRefused, confirmReplanProposal, createReplanProposalForTask, rejectReplanProposal, StaleReplanProposalError } from "./replan";
import { isReplanProposalCurrent } from "./replanContext";
import { resolveSettledFacts } from "./settledFacts";
import { runSchedulerOnce } from "./scheduler";
import { applyTaskTransition, releaseTaskHold } from "./taskTransition";
import { fingerprintRequirements, isVerificationCurrent } from "./verificationContract";

/**
 * ADR 0043, against the first real e2e run's shape. A keyword task (#1) was asked to prove "Ahrefs KD <= 15",
 * and that demand was not on the task at all: it was the `meets-thresholds` requirement its verifier (#2)
 * judged it against. Revising #1 alone would have been failed again by #2. A Revision rewrites #1 and amends
 * #2's planned requirement in one founder-confirmed proposal.
 */

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const KD_REQUIREMENT = { id: "meets-thresholds", description: "The chosen keyword has Ahrefs KD <= 15." };
const ESTIMATE_REQUIREMENT = { id: "meets-thresholds", description: "The chosen keyword has a low SERP-based difficulty estimate, with the method stated." };
const NOTE = "KD needs a login we will not provide. Accept a SERP-based difficulty estimate.";

describe("a Revision of a stuck task", () => {
  it("rewrites the task and the requirement that judges it, re-runs it, and the verifier passes the new standard", async () => {
    const run = await createKeywordCompany();
    await run.untilQuiet();
    // #1 asked for KD values (ADR 0042) and waits on the founder; #2 waits on #1.
    expect(run.keyword()).toMatchObject({ status: "blocked", latestFailureReason: "awaiting_human_action" });
    // A verdict #2 recorded against the KD standard sent #1 a rework that is still pending.
    const staleFinding = run.recordFailedKdVerdict();
    expect(resolveSettledFacts(run.repositories, run.keyword()).map((fact) => fact.kind)).toEqual(["verification_rework"]);
    const attemptsBefore = run.repositories.countAgentRunsForTask(run.keyword().id);
    expect(attemptsBefore).toBeGreaterThan(0);

    const proposal = await run.requestReplan({ mode: "revision", note: NOTE });

    // The planner was told why #1 is stuck, what the founder asked, and which standard it may amend.
    expect(run.plannerPrompts[0]).toContain("Hold `awaiting_human_action`");
    expect(run.plannerPrompts[0]).toContain("- Needed: Ahrefs KD for the five candidate keywords");
    expect(run.plannerPrompts[0]).toContain(`Note: ${NOTE}`);
    expect(run.plannerPrompts[0]).toContain(`Verifier ${run.verifier().id} (Check the keyword pick) — planned, a Revision may amend:`);
    expect(proposal).toMatchObject({
      status: "proposed",
      mode: "revision",
      founderNote: NOTE,
      taskBefore: { title: "Pick a low-KD keyword" },
      taskAfter: { title: "Pick a low-difficulty keyword" },
      capabilitiesChanged: false,
      requirementChanges: [{ verifierTaskId: run.verifier().id, before: [KD_REQUIREMENT], after: [ESTIMATE_REQUIREMENT] }],
    });
    // Asking is not a decision: nothing about the task moved.
    expect(run.repositories.countAgentRunsForTask(run.keyword().id)).toBe(attemptsBefore);
    expect(run.repositories.listOpenTaskHolds(run.keyword().id).map((hold) => hold.kind)).toEqual(["awaiting_human_action"]);

    confirmReplanProposal({ projectRoot: run.projectRoot, repositories: run.repositories, proposalId: proposal.id });

    expect(run.keyword()).toMatchObject({ status: "queued", title: "Pick a low-difficulty keyword", latestFailureReason: null });
    expect(run.keyword().description).toContain("SERP-based");
    // Every open Hold superseded, and Bounded Recovery restarts — only because a revision was confirmed.
    expect(run.repositories.listOpenTaskHolds(run.keyword().id)).toEqual([]);
    expect(run.repositories.listTaskHoldsForTask(run.keyword().id).filter((hold) => hold.kind === "awaiting_human_action"))
      .toEqual([expect.objectContaining({ resolution: "superseded" })]);
    expect(run.repositories.countAgentRunsForTask(run.keyword().id)).toBe(0);
    // #2 waits to judge the revised task's new delivery, by name.
    expect(run.verifier().status).toBe("waiting_dependency");
    expect(run.repositories.listOpenTaskHolds(run.verifier().id)).toEqual([
      expect.objectContaining({ kind: "awaiting_dependency_artifact", subjectId: run.keyword().id }),
    ]);
    // #2's standard is amended and its round budget starts again.
    expect(run.verifier().verificationRequirements).toEqual([ESTIMATE_REQUIREMENT]);
    expect(run.repositories.countVerificationRounds(run.verifier().id)).toBe(0);
    // The finding against the replaced standard is no longer a Settled Fact: it would tell #1 to meet KD <= 15.
    expect(resolveSettledFacts(run.repositories, run.keyword())).toEqual([]);
    expect(isVerificationCurrent(run.repositories, staleFinding)).toBe(false);

    await run.untilQuiet();

    const revisedRunPrompt = run.workPrompts.filter((entry) => entry.taskId === run.keyword().id).at(-1)!.prompt;
    expect(revisedRunPrompt).toContain("SERP-based");
    expect(revisedRunPrompt).not.toContain("KD <= 15");
    expect(run.keyword().status).toBe("complete");
    const verdict = run.repositories.getCurrentBusinessArtifactForTask(run.verifier().id)!;
    expect(verdict.verification).toMatchObject({
      outcome: "passed",
      requirements: [ESTIMATE_REQUIREMENT],
      requirementsFingerprint: fingerprintRequirements([ESTIMATE_REQUIREMENT]),
    });
    expect(isVerificationCurrent(run.repositories, verdict)).toBe(true);
    expect(run.verifier().status).toBe("complete");
  });

  it("revises an exhausted verifier's own planned requirements, with a new round budget", async () => {
    const run = await createKeywordCompany();
    await run.untilQuiet();
    // First, revise only #1: it now delivers an estimate, which #2, still holding the KD standard, fails
    // round after round until its budget is spent.
    run.plannerReplies.push(run.reviseKeyword([]));
    const taskOnly = await run.requestReplan({ mode: "revision", note: NOTE });
    confirmReplanProposal({ projectRoot: run.projectRoot, repositories: run.repositories, proposalId: taskOnly.id });
    await run.untilQuiet();
    expect(run.verifier()).toMatchObject({ status: "blocked", latestFailureReason: "verification_failed" });
    expect(run.repositories.countVerificationRounds(run.verifier().id)).toBe(MAX_VERIFICATION_ROUNDS);

    run.plannerReplies.push({
      mode: "revision",
      rationale: "The KD standard cannot be checked here; judge the stated estimate instead.",
      revisedTask: { title: "Check the keyword pick", description: "Check the keyword pick against its requirements.", proofSchemaId: "test-output", requiredCapabilities: ["research"] },
      requirementChanges: [{ verifierTaskId: run.verifier().id, requirements: [ESTIMATE_REQUIREMENT] }],
    });
    const ownStandard = await run.requestReplan({ mode: "revision", note: NOTE, taskId: run.verifier().id });
    expect(ownStandard.requirementChanges).toEqual([{ verifierTaskId: run.verifier().id, before: [KD_REQUIREMENT], after: [ESTIMATE_REQUIREMENT] }]);
    confirmReplanProposal({ projectRoot: run.projectRoot, repositories: run.repositories, proposalId: ownStandard.id });

    expect(run.verifier().status).toBe("queued");
    expect(run.repositories.countVerificationRounds(run.verifier().id)).toBe(0);
    await run.untilQuiet();
    expect(run.verifier().status).toBe("complete");
    expect(run.repositories.getCurrentBusinessArtifactForTask(run.verifier().id)?.verification?.outcome).toBe("passed");
  });

  it("refuses to confirm a proposal once the task has moved, and a new request replaces it", async () => {
    const run = await createKeywordCompany();
    await run.untilQuiet();
    const proposal = await run.requestReplan({ mode: "revision", note: NOTE });
    expect(isReplanProposalCurrent(run.repositories, proposal)).toBe(true);

    // The founder answered the Human Action after all: the planner reasoned about a task that is gone.
    const humanActionHold = run.repositories.listOpenTaskHolds(run.keyword().id)[0]!;
    releaseTaskHold({ repositories: run.repositories, task: run.keyword(), holdId: humanActionHold.id });

    expect(isReplanProposalCurrent(run.repositories, proposal)).toBe(false);
    expect(() => confirmReplanProposal({ projectRoot: run.projectRoot, repositories: run.repositories, proposalId: proposal.id }))
      .toThrow(StaleReplanProposalError);
    // Nothing applied.
    expect(run.keyword().title).toBe("Pick a low-KD keyword");
    expect(run.verifier().verificationRequirements).toEqual([KD_REQUIREMENT]);
    expect(run.repositories.getReplanProposal(proposal.id)?.status).toBe("proposed");
  });

  it("counts a change in what holds the task as moving, even when its status stays the same", async () => {
    const run = await createKeywordCompany();
    await run.untilQuiet();
    const proposal = await run.requestReplan({ mode: "revision", note: NOTE });

    // Still `blocked`, but now held for one more reason the planner never saw.
    applyTaskTransition({
      repositories: run.repositories,
      task: run.keyword(),
      status: "blocked",
      hold: { kind: "awaiting_founder_approval", resolver: "founder", subjectKind: "approval", subjectId: "approval_1", reason: "Approval required." },
    });
    expect(run.keyword().status).toBe("blocked");

    expect(isReplanProposalCurrent(run.repositories, proposal)).toBe(false);
    expect(() => confirmReplanProposal({ projectRoot: run.projectRoot, repositories: run.repositories, proposalId: proposal.id }))
      .toThrow(StaleReplanProposalError);
  });

  it("gives a rejected proposal's reason to the planner on the next request, and asking or rejecting changes nothing else", async () => {
    const run = await createKeywordCompany();
    await run.untilQuiet();
    const holdsBefore = run.repositories.listOpenTaskHolds(run.keyword().id);
    const attemptsBefore = run.repositories.countAgentRunsForTask(run.keyword().id);

    const first = await run.requestReplan({ mode: "revision", note: NOTE });
    const rejected = rejectReplanProposal({ repositories: run.repositories, proposalId: first.id, note: "Keep the keyword list to English terms." });
    expect(rejected).toMatchObject({ status: "rejected", rejectionNote: "Keep the keyword list to English terms." });
    await run.requestReplan({ mode: "revision", note: NOTE });

    expect(run.plannerPrompts[1]).toContain("Founder's reason: Keep the keyword list to English terms.");
    expect(run.repositories.listOpenTaskHolds(run.keyword().id)).toEqual(holdsBefore);
    expect(run.repositories.countAgentRunsForTask(run.keyword().id)).toBe(attemptsBefore);
  });

  it("is offered exactly where the Hold policy offers it: never to a task waiting on its upstream", async () => {
    const run = await createKeywordCompany();
    await run.untilQuiet();

    // #2 is held only because #1, its upstream, has not delivered: replanning #2 could not fix #1.
    expect(run.repositories.listOpenTaskHolds(run.verifier().id).map((hold) => hold.kind)).toEqual(["awaiting_dependency_artifact"]);
    await expect(createReplanProposalForTask({ repositories: run.repositories, taskId: run.verifier().id, mode: "revision" }))
      .rejects.toThrow(/does not offer replanning/);
  });
});

describe("a verdict's currency", () => {
  it("is derived from the requirement fingerprint, so amending a planned requirement needs no stale mark", async () => {
    const run = await createKeywordCompany();
    const verdict = run.recordFailedKdVerdict({ isCurrent: true, targetArtifactId: null });

    expect(isVerificationCurrent(run.repositories, verdict)).toBe(true);
    run.repositories.updateTaskVerificationRequirements(run.verifier().id, [ESTIMATE_REQUIREMENT]);
    expect(isVerificationCurrent(run.repositories, verdict)).toBe(false);
    // Put back, it is current again: nothing was written onto the verdict.
    run.repositories.updateTaskVerificationRequirements(run.verifier().id, [KD_REQUIREMENT]);
    expect(isVerificationCurrent(run.repositories, verdict)).toBe(true);
  });
});

describe("a Revision's capabilities", () => {
  it("stay bounded by the Permission Mode: a capability the mode refuses that the task did not need is refused", () => {
    const base = getDefaultPolicy();
    const policy = { ...base, decisions: { ...base.decisions, read_public_web: "deny" as const } };
    const current = { proofSchemaId: "test-output", requiredCapabilities: ["code"] };
    expect(capabilitiesNewlyRefused(current, { proofSchemaId: "test-output", requiredCapabilities: ["research"] }, policy)).toEqual(["web_research"]);
    expect(capabilitiesNewlyRefused(current, { proofSchemaId: "test-output", requiredCapabilities: ["code", "writing"] }, policy)).toEqual([]);
  });
});

async function createKeywordCompany() {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-revision-"));
  createdDirs.push(projectRoot);
  const database = createDatabaseClient(":memory:");
  migrate(database);
  const repositories = createRepositories(database);
  const base = aiSaasPlaybook.createBlueprint({
    companyName: "Keyword Studio",
    founderVision: "Find a low-competition keyword and ship a small tool for it.",
    preferredEngineeringAgentId: "worker",
    preferredStrategyAgentId: "worker",
  });
  const blueprint = {
    ...base,
    tasks: [
      {
        key: "pick_keyword", departmentName: "Research", title: "Pick a low-KD keyword",
        description: "Pick one keyword for the tool from five candidates.", requiredCapabilities: ["research"],
        proofSchemaId: "research-report", riskLevel: "low", handoffContract: "The chosen keyword.",
        assigneeAgentId: "worker", dependsOnTaskKeys: [], verification: null, decomposition: null,
      },
      {
        key: "check_keyword", departmentName: "Research", title: "Check the keyword pick",
        description: "Check the keyword pick against its requirements.", requiredCapabilities: ["research"],
        proofSchemaId: "test-output", riskLevel: "low", handoffContract: "A verdict per requirement.",
        assigneeAgentId: "worker", dependsOnTaskKeys: ["pick_keyword"],
        verification: { targetTaskKeys: ["pick_keyword"], requirements: [KD_REQUIREMENT] }, decomposition: null,
      },
    ],
  };
  const created = await createCompany({
    projectRoot,
    companyName: "Keyword Studio",
    founderVision: "Find a low-competition keyword and ship a small tool for it.",
    selectedCeoAgent: createMockAgentAdapter({
      id: "codex", name: "Codex", capabilities: ["code"],
      output: ["## Human CEO Brief", "Plan.", "```json", JSON.stringify({ brief: "Plan.", blueprint }), "```"].join("\n"),
    }),
    availableAgents: [],
    repositories,
    permissionMode: "balanced",
    assets: [],
  });
  repositories.updateCompanyStatus(created.company.id, "active", "2026-10-12T00:00:00.000Z");
  const keywordId = created.tasks.find((task) => task.title === "Pick a low-KD keyword")!.id;
  const verifierId = created.tasks.find((task) => task.title === "Check the keyword pick")!.id;
  const keyword = () => repositories.getTask(keywordId)!;
  const verifier = () => repositories.getTask(verifierId)!;

  const workPrompts: Array<{ taskId: string; prompt: string }> = [];
  const worker: AgentAdapter = {
    id: "worker",
    name: "Worker",
    capabilities: ["code", "research", "writing", "test"],
    contractCapabilities: ["artifact_envelope"],
    detect: async () => true,
    run: async (request: AgentRunRequest) => {
      workPrompts.push({ taskId: request.taskId, prompt: request.prompt });
      if (request.prompt.includes("## Verification Contract")) {
        // A verifier holding the KD standard cannot pass it here; the estimate standard it can.
        const requirements = [...request.prompt.matchAll(/^- `([^`]+)`: (.+)$/gm)].map((match) => ({ id: match[1]!, description: match[2]! }));
        request.runtimeActions!.submitArtifactEnvelope(envelope("validation", {
          verification: {
            checks: requirements.map((requirement) => ({
              requirement_id: requirement.id,
              outcome: requirement.description.includes("KD <= 15") ? "failed" : "passed",
              evidence: requirement.description.includes("KD <= 15") ? "No KD value could be obtained." : "The estimate method is stated and the score is low.",
            })),
          },
        }));
      } else if (request.prompt.includes("SERP-based")) {
        writeFileSync(join(request.workspacePath, "keyword.md"), "keyword-a: low difficulty (SERP-based estimate)\n");
        request.runtimeActions!.submitArtifactEnvelope(envelope("findings", { keyword: "keyword-a", difficulty_method: "SERP-based estimate" }));
      } else {
        request.runtimeActions!.submitArtifactEnvelope({
          artifact_kind: "blocker", artifact_role: "none", artifact_subtype: "keyword_data_unavailable", task_type: "research.keyword",
          payload: {
            blocker_class: "environment_blocked", capability: "keyword_data", reason: "Tried nine KD sources; every one needs a login.",
            unblock_request: { needed: "Ahrefs KD for the five candidate keywords", why: "Every KD source needs a login.", evidence_requirements: ["KD values"] },
          },
          lineage: {},
        });
      }
      return { status: "complete", exitCode: 0, stdout: "done", stderr: "" };
    },
  };

  const plannerPrompts: string[] = [];
  const reviseKeyword = (requirementChanges: unknown[]) => ({
    mode: "revision",
    rationale: "Ahrefs KD is unobtainable in this environment; judge the pick by a stated SERP-based estimate.",
    revisedTask: {
      title: "Pick a low-difficulty keyword",
      description: "Pick one keyword from five candidates by a SERP-based difficulty estimate, and state the method.",
      proofSchemaId: "research-report",
      requiredCapabilities: ["research"],
    },
    requirementChanges,
  });
  /** What the planner answers next; by default the full Revision of #1 and #2. */
  const plannerReplies: unknown[] = [];
  const planner: AgentAdapter = {
    id: "codex",
    name: "Codex",
    capabilities: ["code", "research", "writing"],
    detect: async () => true,
    run: async (request) => {
      plannerPrompts.push(request.prompt);
      const reply = plannerReplies.shift() ?? reviseKeyword([{ verifierTaskId: verifierId, requirements: [ESTIMATE_REQUIREMENT] }]);
      return { status: "complete", exitCode: 0, stderr: "", stdout: ["```json", JSON.stringify(reply), "```"].join("\n") };
    },
  };

  let tick = 0;
  return {
    repositories,
    projectRoot,
    keyword,
    verifier,
    workPrompts,
    plannerPrompts,
    plannerReplies,
    reviseKeyword,
    requestReplan: (request: { mode: "split" | "revision"; note: string; taskId?: string }) => createReplanProposalForTask({
      repositories, taskId: request.taskId ?? keywordId, mode: request.mode, note: request.note, projectRoot, plannerAgent: planner, playbook: aiSaasPlaybook,
    }),
    /** A failed verdict #2 recorded against the KD standard, with the rework it sent #1. */
    recordFailedKdVerdict: (options: { isCurrent?: boolean; targetArtifactId?: string | null } = {}): BusinessArtifact => {
      const artifact: BusinessArtifact = {
        id: `kd_verdict_${++tick}`, companyId: keyword().companyId, taskId: verifierId, sourceProofId: null,
        artifactKind: "deliverable", artifactRole: "validation", artifactSubtype: "validation_result", artifactType: "validation_result",
        taskType: "planned.validation", payload: {}, lineage: {}, validationStatus: "valid", validationErrors: [],
        reviewStatus: "not_reviewable", isCurrent: options.isCurrent ?? false, supersedesArtifactId: null, deliveryWorkspacePath: null,
        verification: {
          outcome: "failed", requirementsArtifactId: null, requirements: [KD_REQUIREMENT],
          requirementsFingerprint: fingerprintRequirements([KD_REQUIREMENT]),
          targets: options.targetArtifactId === null ? [] : [{ taskId: keywordId, artifactId: options.targetArtifactId ?? "estimate_delivery", revision: "r" }],
          checks: [{ requirementId: KD_REQUIREMENT.id, outcome: "failed", evidence: "No KD value." }], issues: [],
        },
        createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z",
      };
      repositories.createBusinessArtifact(artifact);
      repositories.recordVerificationRework({
        id: `kd_rework_${tick}`, companyId: artifact.companyId, verifierTaskId: verifierId, failedArtifactId: artifact.id, round: 1,
        decision: "rework_producers", producerTaskIds: [keywordId], redeliveredTaskIds: [],
        failedChecks: [{ requirementId: KD_REQUIREMENT.id, outcome: "failed", evidence: "No KD value.", description: KD_REQUIREMENT.description }],
        createdAt: "2026-10-12T00:00:00.000Z",
      });
      return artifact;
    },
    untilQuiet: async () => {
      let quiet = 0;
      for (let index = 0; index < 30 && quiet < 2; index += 1) {
        const result = await runSchedulerOnce({
          projectRoot, repositories, adapters: [worker], workerId: "worker_a", maxTasks: 1,
          approvalRequired: () => false, emit: () => undefined,
          proofCollector: ({ task }: { task: Task }) => [
            { id: `proof_${task.id}_${++tick}`, taskId: task.id, type: "file", uri: "keyword.md", summary: "delivery", verifiedAt: null },
          ],
        });
        quiet = [result.started, result.completed, result.blocked, result.failed].every((ids) => ids.length === 0) ? quiet + 1 : 0;
      }
    },
  };
}

function envelope(role: string, payload: Record<string, unknown>): unknown {
  return {
    artifact_kind: "deliverable",
    artifact_role: role,
    artifact_subtype: `${role}_result`,
    task_type: `planned.${role}`,
    payload: {
      ...payload,
      report_version: 2,
      execution_report: {
        work_summary: "Did the work.", evidence: "Recorded the output.", conclusion: "The work is done.",
        vision_impact: "It moves the vision forward.", remaining_gap: "Nothing blocking.", recommendation: "Proceed.",
      },
      outcome_summary: "The work is done and moves the vision forward.",
      actions: [],
    },
    lineage: {},
  };
}
