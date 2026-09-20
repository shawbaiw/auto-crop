import { projectCeoOfficeItems } from "@auto-crop/core";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest } from "../adapters/types";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { acceptTaskBusinessArtifact } from "./businessAcceptance";
import { isReviewableBusinessArtifact } from "./businessArtifact";
import { resolveDependencyReadiness } from "./dependencyReadiness";
import { runSchedulerOnce } from "./scheduler";
import { resolveTaskAffordanceState } from "./taskAffordances";
import { reconcileTaskHolds } from "./taskHoldReconciliation";
import { refreshTaskDependencyState } from "./taskRefresh";
import { evaluateVerificationReport, prepareVerificationInputs } from "./verificationContract";
import { applyVerificationRework, pendingReworkFeedback } from "./verificationRework";

/**
 * A department split runs as a declared chain: Define declares verification requirements, Execute
 * produces output, Validate verifies a runtime snapshot of that output against those requirements. The
 * scenario these tests pin came from a real run: Validate had no edge to Execute, ran in an empty
 * workspace, failed every check — and its well-formed report could still be accepted as a delivery.
 */

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

type Stage = "define" | "execute" | "validate";
type Check = { requirement_id: string; outcome: string; evidence: string };

type StageBehaviour = {
  requirements?: Array<{ id: string; description: string }> | null;
  validate?: (workspacePath: string, prompt: string) => Check[];
  /** The artifact kind the verifier files; a verifier may try any kind the runtime accepts. */
  validateKind?: string;
  /** Omit `payload.verification` entirely. */
  validateWithoutVerification?: boolean;
  /** Extra payload fields Define delivers, such as a genuine Founder Decision. */
  defineExtra?: Record<string, unknown>;
};

describe("department subtask verification", () => {
  it("chains subtasks through declared inputs and verifies a snapshot of the executed output", async () => {
    const harness = createHarness({
      validate: (workspacePath, prompt) => {
        const snapshot = snapshotFilesFor(workspacePath, prompt);
        return [
          {
            requirement_id: "home-page",
            outcome: existsSync(join(snapshot, "index.html")) ? "passed" : "failed",
            evidence: "Read files/index.html in the snapshot.",
          },
          {
            requirement_id: "app-script",
            outcome: existsSync(join(snapshot, "app.js")) ? "passed" : "failed",
            evidence: "Read files/app.js in the snapshot.",
          },
        ];
      },
    });

    await harness.runUntilIdle();

    const { define, execute, validate } = harness.subtasks();
    expect(harness.runOrder).toEqual(["define", "execute", "validate"]);
    expect(harness.repositories.listTaskDependencies(execute.id)).toContainEqual(
      expect.objectContaining({ dependsOnTaskId: define.id }),
    );
    expect(harness.repositories.listTaskDependencies(validate.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dependsOnTaskId: define.id, inputRole: "verification_requirements" }),
        expect.objectContaining({ dependsOnTaskId: execute.id, inputRole: "verification_target" }),
      ]),
    );

    const validatePrompt = harness.prompts.get("validate")!;
    expect(validatePrompt).toContain(`.auto-crop-inputs/${execute.id}`);
    expect(validatePrompt).toContain("`home-page`");
    expect(validatePrompt).not.toContain(`Artifact Workspace: ${execute.artifactWorkspacePath}`);

    const snapshotRoot = join(validate.workspacePath!, ".auto-crop-inputs", execute.id, "files");
    expect(existsSync(join(snapshotRoot, "index.html"))).toBe(true);
    expect(existsSync(join(snapshotRoot, "node_modules"))).toBe(false);
    expect(existsSync(join(snapshotRoot, ".env"))).toBe(false);

    const executeArtifact = harness.repositories.getCurrentBusinessArtifactForTask(execute.id)!;
    const validateArtifact = harness.repositories.getCurrentBusinessArtifactForTask(validate.id)!;
    expect(validateArtifact.verification).toMatchObject({
      outcome: "passed",
      targets: [{ taskId: execute.id, artifactId: executeArtifact.id, revision: expect.stringMatching(/^[0-9a-f]{64}$/) }],
    });
    // Internal deliveries: held for the parent's aggregation, never offered to CEO Office, never accepted,
    // and the key result untouched until the parent's own result is accepted.
    for (const subtask of [define, execute, validate]) {
      expect(harness.repositories.getTask(subtask.id)?.status).toBe("review");
      expect(harness.repositories.listOpenTaskHolds(subtask.id).map((hold) => hold.kind)).toEqual(["awaiting_parent_aggregation"]);
      expect(harness.repositories.listTaskHoldsForTask(subtask.id).some((hold) => hold.kind === "awaiting_ceo_review")).toBe(false);
      expect(harness.repositories.getCurrentBusinessArtifactForTask(subtask.id)?.reviewStatus).toBe("unreviewed");
    }
    expect(harness.repositories.listKeyResults("company_1")[0]).toMatchObject({ currentValue: "not_started", status: "active" });
    expect(harness.repositories.getTask(harness.parent.id)?.status).toBe("queued");
  });

  it("does not put a subtask delivery through the risk scan or CEO review", async () => {
    // "Search Console" in a delivered slice used to route every subtask of an SEO company to CEO review.
    const harness = createHarness({
      requirements: [
        { id: "home-page", description: "The prototype has an index.html entry page, ready for Google Search Console later." },
        { id: "app-script", description: "The prototype ships its app.js behaviour." },
      ],
      validate: () => [
        { requirement_id: "home-page", outcome: "passed", evidence: "index.html present; Search Console is not connected yet." },
        { requirement_id: "app-script", outcome: "passed", evidence: "app.js present." },
      ],
    });

    await harness.runUntilIdle();

    const holds = harness.repositories.listOpenTaskHoldsForCompany("company_1");
    expect(holds.filter((hold) => hold.kind === "awaiting_ceo_review")).toEqual([]);
    expect(harness.runOrder).toEqual(["define", "execute", "validate"]);
    expect(harness.repositories.getTask(harness.parent.id)?.status).toBe("queued");
  });

  it("keeps a verification that keeps failing out of every success path once its rounds are spent", async () => {
    const harness = createHarness({
      // The original report: structurally valid, every check failed, and prose naming Search Console.
      validate: () => [
        { requirement_id: "home-page", outcome: "failed", evidence: "No index.html; cannot submit to Google Search Console." },
        { requirement_id: "app-script", outcome: "failed", evidence: "No app.js in the snapshot." },
      ],
    });

    await harness.runUntilIdle();

    const { validate } = harness.subtasks();
    const validateTask = harness.repositories.getTask(validate.id)!;
    const artifact = harness.repositories.getCurrentBusinessArtifactForTask(validate.id)!;

    // Each failure sent Execute back for rework; the third failed round spends the budget.
    expect(harness.runOrder).toEqual(["define", "execute", "validate", "execute", "validate", "execute", "validate"]);
    expect(validateTask).toMatchObject({ status: "blocked", latestFailureReason: "verification_failed" });
    expect(validateTask.latestFailureMessage).toContain("3 of 3 rounds");
    expect(artifact).toMatchObject({ validationStatus: "valid", reviewStatus: "unreviewed" });
    expect(artifact.verification?.outcome).toBe("failed");
    expect(harness.agentRunStatuses(validate.id)).toEqual(["complete", "complete", "complete"]);
    expect(harness.repositories.listOpenTaskHolds(validate.id).map((hold) => hold.kind)).toEqual(["recovery_exhausted"]);
    // Only a replan starts a new budget; nothing offers re-running the same verification again.
    expect(resolveTaskAffordanceState(harness.repositories, validateTask).affordances.map((affordance) => affordance.kind))
      .toEqual(["request_replan", "cancel_task"]);
    expect(harness.repositories.listVerificationReworksForVerifier(validate.id).map((rework) => rework.decision))
      .toEqual(["rework_producers", "rework_producers", "exhausted"]);

    // Not offered to CEO Office, not acceptable through the shared seam, and the parent does not summarize it.
    const officeItems = projectCeoOfficeItems({
      company: harness.repositories.getCompany("company_1")!,
      tasks: harness.repositories.listTasksForCompany("company_1"),
      taskCompletionEvents: harness.repositories.listTaskCompletionEventsForCompany("company_1"),
      businessArtifacts: harness.repositories.listBusinessArtifactsForCompany("company_1"),
      taskHolds: harness.repositories.listOpenTaskHoldsForCompany("company_1"),
    });
    expect(officeItems.filter((item) => item.type === "approval_request" && item.taskId === validate.id)).toEqual([]);
    expect(() =>
      acceptTaskBusinessArtifact({
        repositories: harness.repositories,
        task: validateTask,
        artifact,
        acceptanceProvenance: "manual_ceo_review",
        eventType: "ceo_review_decision",
        eventMessage: "CEO Office approved task.",
      }),
    ).toThrow(/verification is failed/);
    expect(harness.repositories.getTask(harness.parent.id)).toMatchObject({
      status: "blocked",
      latestFailureReason: "dependency_failed",
    });
  });

  it("treats a check the verifier could not run as inconclusive, never passed", async () => {
    const harness = createHarness({
      validate: () => [
        { requirement_id: "home-page", outcome: "passed", evidence: "index.html present." },
        { requirement_id: "app-script", outcome: "not_run", evidence: "No JavaScript runtime was available." },
      ],
    });

    await harness.runUntilIdle();

    const { validate } = harness.subtasks();
    expect(harness.repositories.getCurrentBusinessArtifactForTask(validate.id)?.verification?.outcome).toBe("inconclusive");
    expect(harness.repositories.getTask(validate.id)?.status).toBe("blocked");
  });

  it("rejects a report that silently drops a requirement", async () => {
    const harness = createHarness({
      validate: () => [{ requirement_id: "home-page", outcome: "passed", evidence: "index.html present." }],
    });

    await harness.runUntilIdle();

    const { validate } = harness.subtasks();
    const artifact = harness.repositories.getCurrentBusinessArtifactForTask(validate.id)!;
    expect(artifact.validationStatus).toBe("invalid_schema");
    expect(artifact.validationErrors).toContain("payload.verification.checks: Missing a check for requirement app-script.");
    expect(harness.repositories.getTask(validate.id)?.status).not.toBe("complete");
  });

  it("rejects a requirements producer that declares no requirements", async () => {
    const harness = createHarness({ requirements: null, validate: () => [] });

    await harness.runUntilIdle();

    const { define, validate } = harness.subtasks();
    expect(harness.repositories.getCurrentBusinessArtifactForTask(define.id)?.validationStatus).toBe("invalid_schema");
    expect(harness.runOrder).not.toContain("validate");
    expect(harness.repositories.getTask(validate.id)?.status).not.toBe("complete");
  });

  it("lets dispatch and aggregation agree, then archives the subtasks once the parent is accepted", async () => {
    const harness = createHarness({
      validate: () => [
        { requirement_id: "home-page", outcome: "passed", evidence: "index.html present." },
        { requirement_id: "app-script", outcome: "passed", evidence: "app.js present." },
      ],
    });
    await harness.runUntilIdle();
    const { repositories, parent } = harness;
    const subtasks = Object.values(harness.subtasks());

    // Aggregation queued the parent; dispatch's own readiness check reaches the same answer, so the
    // parent does not flip back to waiting on the next tick.
    expect(repositories.getTask(parent.id)?.status).toBe("queued");
    expect(resolveDependencyReadiness(repositories, repositories.getTask(parent.id)!).kind).toBe("ready");

    repositories.appendProof({ id: "proof_parent", taskId: parent.id, type: "file", uri: "summary.md", summary: "summary", verifiedAt: null });
    repositories.createBusinessArtifact(artifactRecord("artifact_parent", parent.id, {}));
    acceptTaskBusinessArtifact({
      repositories,
      task: repositories.getTask(parent.id)!,
      artifact: { ...repositories.getCurrentBusinessArtifactForTask(parent.id)!, reviewStatus: "unreviewed" },
      acceptanceProvenance: "manual_ceo_review",
      eventType: "ceo_review_decision",
      eventMessage: "CEO Office approved task.",
      keyResultProgress: { currentValue: "verified", status: "met" },
    });

    for (const subtask of subtasks) {
      expect(repositories.getTask(subtask.id)?.status).toBe("complete");
      expect(repositories.listOpenTaskHolds(subtask.id)).toEqual([]);
      expect(repositories.getCurrentBusinessArtifactForTask(subtask.id)?.reviewStatus).toBe("unreviewed");
    }
    expect(repositories.listKeyResults("company_1")[0]).toMatchObject({ currentValue: "verified", status: "met" });
  });

  it("keeps a genuine Founder Decision in a subtask blocking the siblings that consume it", async () => {
    const harness = createHarness({
      defineExtra: {
        open_decisions: [{
          decisionKind: "pricing_model",
          options: [
            { label: "Flat fee", tradeoffs: "Predictable." },
            { label: "Usage based", tradeoffs: "Scales with value." },
          ],
          recommended_option_index: 0,
          rationale: "Buyers want a predictable bill.",
          briefing: "Two pricing shapes fit the prototype; the founder picks.",
        }],
      },
      validate: () => [],
    });

    await harness.runUntilIdle();

    const { define, execute } = harness.subtasks();
    expect(harness.runOrder).toEqual(["define"]);
    expect(harness.repositories.listOpenTaskHolds(define.id).map((hold) => hold.kind)).toEqual(["awaiting_founder_decision"]);
    expect(harness.repositories.getTask(execute.id)?.status).not.toBe("running");
    expect(resolveDependencyReadiness(harness.repositories, harness.repositories.getTask(execute.id)!)).toMatchObject({
      kind: "waiting",
      waitingOnDecision: true,
    });
  });

  it("never re-derives a CEO review for a subtask parked in review, and keeps internal output from outside consumers", async () => {
    const harness = createHarness({
      validate: () => [
        { requirement_id: "home-page", outcome: "passed", evidence: "index.html present." },
        { requirement_id: "app-script", outcome: "passed", evidence: "app.js present." },
      ],
    });
    await harness.runUntilIdle();
    const { repositories } = harness;
    const { execute } = harness.subtasks();

    // A read-time repair of a subtask left in `review` without a Hold must not rebuild a CEO review.
    repositories.resolveOpenTaskHolds(execute.id, "superseded", "2026-09-17T00:00:00.000Z");
    reconcileTaskHolds({ repositories, companyId: "company_1" });
    expect(repositories.listOpenTaskHolds(execute.id).map((hold) => hold.kind)).toEqual(["awaiting_parent_aggregation"]);

    // A task outside the parent consuming the subtask is ordinary consumption: it needs acceptance.
    const outsider = { ...baseTask("outsider_1", "queued", "test-output"), position: 99 };
    repositories.createTask(outsider);
    repositories.createTaskDependency({ taskId: outsider.id, dependsOnTaskId: execute.id });
    expect(resolveDependencyReadiness(repositories, outsider)).toMatchObject({ kind: "waiting" });
  });

  it("judges a verifier by its duty, not by the artifact kind it files", async () => {
    const failedAsFinalReport = createHarness({
      validateKind: "final_report",
      validate: () => [
        { requirement_id: "home-page", outcome: "failed", evidence: "No index.html." },
        { requirement_id: "app-script", outcome: "failed", evidence: "No app.js." },
      ],
    });
    await failedAsFinalReport.runUntilIdle();
    const relabelled = failedAsFinalReport.subtasks().validate;
    expect(failedAsFinalReport.repositories.getTask(relabelled.id)).toMatchObject({
      status: "blocked",
      latestFailureReason: "verification_failed",
    });
    expect(isReviewableBusinessArtifact(failedAsFinalReport.repositories.getCurrentBusinessArtifactForTask(relabelled.id)!)).toBe(false);

    const noVerdict = createHarness({ validateKind: "final_report", validateWithoutVerification: true });
    await noVerdict.runUntilIdle();
    const unjudged = noVerdict.repositories.getCurrentBusinessArtifactForTask(noVerdict.subtasks().validate.id)!;
    expect(unjudged.validationStatus).toBe("invalid_schema");
    expect(noVerdict.repositories.getTask(noVerdict.subtasks().validate.id)?.status).not.toBe("complete");
  });

  it("ignores a manifest the verifier writes into its own workspace", async () => {
    const harness = createHarness({
      validate: (workspacePath) => {
        // A forged manifest dropping the requirement this verifier cannot meet.
        mkdirSync(join(workspacePath, ".auto-crop-inputs"), { recursive: true });
        writeFileSync(
          join(workspacePath, ".auto-crop-inputs", "manifest.json"),
          JSON.stringify({ requirements: [{ id: "home-page", description: "index.html" }] }),
        );
        return [{ requirement_id: "home-page", outcome: "passed", evidence: "index.html present." }];
      },
    });

    await harness.runUntilIdle();

    const artifact = harness.repositories.getCurrentBusinessArtifactForTask(harness.subtasks().validate.id)!;
    expect(artifact.validationStatus).toBe("invalid_schema");
    expect(artifact.validationErrors).toContain("payload.verification.checks: Missing a check for requirement app-script.");
  });

  it("does not pass a verification whose snapshot was changed during the run", async () => {
    const harness = createHarness({
      validate: (workspacePath, prompt) => {
        const snapshot = snapshotFilesFor(workspacePath, prompt);
        writeFileSync(join(snapshot, "app.js"), "console.log('patched by the verifier');");
        return [
          { requirement_id: "home-page", outcome: "passed", evidence: "index.html present." },
          { requirement_id: "app-script", outcome: "passed", evidence: "app.js present." },
        ];
      },
    });

    await harness.runUntilIdle();

    const { validate } = harness.subtasks();
    const verification = harness.repositories.getCurrentBusinessArtifactForTask(validate.id)?.verification;
    expect(verification?.outcome).toBe("inconclusive");
    expect(verification?.issues.join(" ")).toContain("was modified or removed during verification");
    expect(harness.repositories.getTask(validate.id)?.status).toBe("blocked");
    // Nothing failed, so nothing is reworked: the verifier re-verifies until its rounds are spent.
    expect(harness.repositories.listVerificationReworksForVerifier(validate.id).map((rework) => rework.decision))
      .toEqual(["reverify", "reverify", "exhausted"]);
    expect(harness.runOrder).toEqual(["define", "execute", "validate", "validate", "validate"]);
  });

  it("reworks the producer with the failed checks as feedback, then passes on re-verification", async () => {
    let validations = 0;
    const harness = createHarness({
      validate: () => {
        validations += 1;
        return [
          { requirement_id: "home-page", outcome: "passed", evidence: "index.html present." },
          validations === 1
            ? { requirement_id: "app-script", outcome: "failed", evidence: "app.js throws on load." }
            : { requirement_id: "app-script", outcome: "passed", evidence: "app.js loads." },
        ];
      },
    });

    await harness.runUntilIdle();

    const { execute, validate } = harness.subtasks();
    expect(harness.runOrder).toEqual(["define", "execute", "validate", "execute", "validate"]);
    const executePrompts = harness.promptHistory.filter((entry) => entry.stage === "execute").map((entry) => entry.prompt);
    expect(executePrompts[0]).not.toContain("## Rework Requested");
    expect(executePrompts[1]).toContain("## Rework Requested");
    expect(executePrompts[1]).toContain("`app-script` (failed)");
    expect(executePrompts[1]).toContain("app.js throws on load.");
    expect(executePrompts[1]).not.toContain("`home-page`");

    expect(harness.repositories.getCurrentBusinessArtifactForTask(validate.id)?.verification?.outcome).toBe("passed");
    expect(harness.repositories.listVerificationReworksForVerifier(validate.id)).toEqual([
      expect.objectContaining({ round: 1, decision: "rework_producers", producerTaskIds: [execute.id], redeliveredTaskIds: [execute.id] }),
    ]);
    expect(harness.repositories.getTask(harness.parent.id)?.status).toBe("queued");

    // The budget lives in the database, so a restarted runtime reads the same rounds.
    const restarted = createRepositories(harness.client);
    expect(restarted.listVerificationReworksForVerifier(validate.id)).toHaveLength(1);
  });

  it("escalates a check that could not be run instead of reworking the producer", async () => {
    const harness = createHarness({
      validate: () => [
        { requirement_id: "home-page", outcome: "passed", evidence: "index.html present." },
        { requirement_id: "app-script", outcome: "not_run", evidence: "No JavaScript runtime was available." },
      ],
    });

    await harness.runUntilIdle();

    const { validate } = harness.subtasks();
    expect(harness.runOrder).toEqual(["define", "execute", "validate"]);
    expect(harness.repositories.listVerificationReworksForVerifier(validate.id).map((rework) => rework.decision)).toEqual(["escalated"]);
    expect(harness.repositories.listOpenTaskHolds(validate.id).map((hold) => hold.kind)).toEqual(["verification_failed"]);
  });

  it("refuses to accept a verifier's artifact that records no verdict, or a verdict on a superseded output", async () => {
    const harness = createHarness({
      validate: () => [
        { requirement_id: "home-page", outcome: "passed", evidence: "index.html present." },
        { requirement_id: "app-script", outcome: "passed", evidence: "app.js present." },
      ],
    });
    await harness.runUntilIdle();
    const { execute, validate } = harness.subtasks();
    const { repositories } = harness;
    const passed = repositories.getCurrentBusinessArtifactForTask(validate.id)!;
    expect(passed.verification?.outcome).toBe("passed");
    const accept = (artifact: typeof passed) => () =>
      acceptTaskBusinessArtifact({
        repositories,
        task: repositories.getTask(validate.id)!,
        artifact: { ...artifact, reviewStatus: "unreviewed" },
        acceptanceProvenance: "manual_ceo_review",
        eventType: "ceo_review_decision",
        eventMessage: "CEO Office approved task.",
      });

    const { verification: _dropped, ...withoutVerdict } = passed;
    expect(accept(withoutVerdict)).toThrow(/recorded no verdict/);

    // Execute delivers again: the passed verdict now covers an output nobody consumes.
    repositories.createBusinessArtifact({
      ...repositories.getCurrentBusinessArtifactForTask(execute.id)!,
      id: "execute_artifact_v2",
    });
    expect(accept(passed)).toThrow(/has since been superseded/);

    // The parent's readiness asks the same question: the verdict no longer covers Execute's current output.
    expect(resolveDependencyReadiness(repositories, repositories.getTask(harness.parent.id)!)).toMatchObject({
      kind: "missing_deliverable",
      note: `Department subtask verification does not cover the current output: ${validate.title}.`,
    });
  });

  it("stops a verifier before its run when the target output cannot be handed over", async () => {
    const harness = createHarness({ validate: () => [] });
    await harness.runUntilIdle({
      until: () => harness.repositories.listTasksForCompany("company_1").some(
        (task) => task.title.startsWith("Execute") && task.status === "review",
      ),
    });

    const { execute, validate } = harness.subtasks();
    rmSync(execute.artifactWorkspacePath!, { recursive: true, force: true });
    await harness.runUntilIdle();

    expect(harness.runOrder).not.toContain("validate");
    expect(harness.repositories.getTask(validate.id)).toMatchObject({
      status: "blocked",
      latestFailureReason: "missing_deliverable",
      dependencyNote: expect.stringContaining("Handoff failed"),
    });
  });
});

describe("verification contract", () => {
  it("does not pass a report whose target changed after the snapshot", () => {
    const result = evaluateVerificationReport({
      payload: { verification: { checks: [{ requirement_id: "r1", outcome: "passed", evidence: "ok" }] } },
      context: {
        inputs: {
          requirementsTaskId: "define",
          requirementsArtifactId: "requirements_1",
          requirements: [{ id: "r1", description: "works" }],
          targets: [{ taskId: "execute", artifactId: "artifact_old", revision: "abc", path: ".auto-crop-inputs/execute" }],
        },
        currentArtifactIds: new Map([
          ["execute", "artifact_new"],
          ["define", "requirements_1"],
        ]),
        snapshotRevisions: new Map([["execute", "abc"]]),
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.verification?.outcome).toBe("inconclusive");
    expect(result.verification?.issues[0]).toContain("changed since it was snapshotted");
  });

  it("sends a failed verification recovered from a workspace to rework, not CEO review", () => {
    const harness = createHarness({ validate: () => [] });
    const { repositories } = harness;
    const producerWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-producer-"));
    const verifierWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-verifier-"));
    createdDirs.push(producerWorkspace, verifierWorkspace);
    writeFileSync(join(producerWorkspace, "index.html"), "<h1>ok</h1>");
    const define = baseTask("define_1", "complete", "product-brief");
    const producer = { ...baseTask("execute_1", "complete", "landing-page-file"), artifactWorkspacePath: producerWorkspace };
    const verifier = { ...baseTask("validate_1", "failed", "repo-diff"), workspacePath: verifierWorkspace };
    for (const task of [define, producer, verifier]) {
      repositories.createTask(task);
    }
    repositories.createBusinessArtifact(artifactRecord("artifact_define", define.id, {
      verification_requirements: [{ id: "r1", description: "works" }],
    }));
    repositories.createBusinessArtifact(artifactRecord("artifact_execute", producer.id, {}, producerWorkspace));
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: define.id, inputRole: "verification_requirements" });
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: producer.id, inputRole: "verification_target" });
    expect(prepareVerificationInputs({ repositories, task: verifier, workspacePath: verifierWorkspace }).kind).toBe("ready");
    repositories.updateTaskExecutionSummary(verifier.id, { latestFailureReason: "no_proof", latestFailureMessage: "no proof" });
    writeFileSync(join(verifierWorkspace, "validation.patch"), "diff --git a/index.html b/index.html\n", "utf8");
    writeArtifact(verifierWorkspace, "validation", {
      verification: { checks: [{ requirement_id: "r1", outcome: "failed", evidence: "index.html does not render." }] },
    });

    const result = refreshTaskDependencyState({
      repositories,
      taskId: verifier.id,
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
    });

    // A recovered failed verdict gets the same rework policy as a finished run's.
    expect(result.task).toMatchObject({ status: "waiting_dependency" });
    expect(repositories.getTask(producer.id)?.status).toBe("queued");
    expect(repositories.getCurrentBusinessArtifactForTask(producer.id)?.reviewStatus).toBe("returned");
    expect(repositories.listVerificationReworksForVerifier(verifier.id)).toEqual([
      expect.objectContaining({ decision: "rework_producers", round: 1, producerTaskIds: [producer.id] }),
    ]);
    const artifact = repositories.getCurrentBusinessArtifactForTask(verifier.id)!;
    expect(artifact.verification?.outcome).toBe("failed");
    expect(isReviewableBusinessArtifact(artifact)).toBe(false);
  });

  it("counts one failed report once, reworks only the faulted target, and escalates a producer held by a decision", () => {
    const harness = createHarness({ validate: () => [] });
    const { repositories } = harness;
    const faulted = { ...baseTask("producer_a", "complete", "landing-page-file") };
    const sound = { ...baseTask("producer_b", "complete", "landing-page-file") };
    const verifier = { ...baseTask("verifier_1", "running", "test-output") };
    for (const task of [faulted, sound, verifier]) {
      repositories.createTask(task);
    }
    repositories.createBusinessArtifact(artifactRecord("artifact_a", faulted.id, {}));
    repositories.createBusinessArtifact(artifactRecord("artifact_b", sound.id, {}));
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: faulted.id, inputRole: "verification_target" });
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: sound.id, inputRole: "verification_target" });
    const report = {
      ...artifactRecord("report_1", verifier.id, {}),
      reviewStatus: "unreviewed" as const,
      verification: {
        outcome: "failed" as const,
        requirementsArtifactId: null,
        requirements: [{ id: "r1", description: "works" }, { id: "r2", description: "styled" }],
        targets: [
          { taskId: faulted.id, artifactId: "artifact_a", revision: "a" },
          { taskId: sound.id, artifactId: "artifact_b", revision: "b" },
        ],
        checks: [
          { requirementId: "r1", outcome: "failed" as const, evidence: "broken", targetTaskId: faulted.id },
          { requirementId: "r2", outcome: "passed" as const, evidence: "fine", targetTaskId: sound.id },
        ],
        issues: [],
      },
    };
    repositories.createBusinessArtifact(report);

    let sequence = 0;
    const createId = (prefix: string) => `${prefix}_rework_${++sequence}`;
    const results = [0, 1].map(() =>
      applyVerificationRework({ repositories, verifier: repositories.getTask(verifier.id)!, artifact: report, now: () => new Date(), createId }),
    );
    // Finalizing the same failed report again answers with the recorded decision, not a new round.
    expect(results.map((result) => [result.rework.round, result.rework.decision])).toEqual([
      [1, "rework_producers"],
      [1, "rework_producers"],
    ]);

    expect(repositories.listVerificationReworksForVerifier(verifier.id)).toEqual([
      expect.objectContaining({ round: 1, decision: "rework_producers", producerTaskIds: [faulted.id] }),
    ]);
    expect(repositories.getTask(faulted.id)?.status).toBe("queued");
    expect(repositories.getTask(sound.id)?.status).toBe("complete");
    expect(pendingReworkFeedback(repositories, repositories.getTask(faulted.id)!)[0]?.failedChecks.map((check) => check.requirementId)).toEqual(["r1"]);

    // A producer parked on a Founder Decision is not the verifier's to send back.
    const decided = { ...baseTask("producer_c", "review", "landing-page-file") };
    const secondVerifier = { ...baseTask("verifier_2", "running", "test-output") };
    repositories.createTask(decided);
    repositories.createTask(secondVerifier);
    repositories.openTaskHold({
      id: "hold_decision", companyId: "company_1", taskId: decided.id, kind: "awaiting_founder_decision", resolver: "founder",
      subjectKind: null, subjectId: null, reason: "decision", reasonText: null, openedAt: "2026-09-17T00:00:00.000Z", resolvedAt: null, resolution: null,
    });
    // Its current delivery is the one the verdict judged, so this is a genuine escalation, not staleness.
    repositories.createBusinessArtifact(artifactRecord("artifact_c", decided.id, {}));
    const secondReport = {
      ...report,
      id: "report_2",
      taskId: secondVerifier.id,
      verification: { ...report.verification, targets: [{ taskId: decided.id, artifactId: "artifact_c", revision: "c" }], checks: [{ requirementId: "r1", outcome: "failed" as const, evidence: "broken" }] },
    };
    const escalated = applyVerificationRework({ repositories, verifier: secondVerifier, artifact: secondReport, now: () => new Date(), createId });
    expect(escalated.rework.decision).toBe("escalated");
    expect(repositories.getTask(decided.id)?.status).toBe("review");
  });

  it("re-verifies instead of reworking when the verdict judged a superseded version", () => {
    const harness = createHarness({ validate: () => [] });
    const { repositories } = harness;
    const producer = { ...baseTask("producer_v1", "complete", "landing-page-file") };
    const verifier = { ...baseTask("verifier_v1", "running", "test-output") };
    repositories.createTask(producer);
    repositories.createTask(verifier);
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: producer.id, inputRole: "verification_target" });
    repositories.createBusinessArtifact(artifactRecord("artifact_old", producer.id, {}));
    const report = {
      ...artifactRecord("report_stale", verifier.id, {}),
      reviewStatus: "unreviewed" as const,
      verification: {
        outcome: "failed" as const,
        requirementsArtifactId: null,
        requirements: [{ id: "r1", description: "works" }],
        targets: [{ taskId: producer.id, artifactId: "artifact_old", revision: "a" }],
        checks: [{ requirementId: "r1", outcome: "failed" as const, evidence: "broken" }],
        issues: [],
      },
    };
    repositories.createBusinessArtifact(report);
    // The producer has delivered again since the verdict was reached.
    repositories.createBusinessArtifact(artifactRecord("artifact_new", producer.id, {}));

    const result = applyVerificationRework({
      repositories,
      verifier: repositories.getTask(verifier.id)!,
      artifact: report,
      now: () => new Date(),
      createId: sequentialIds("stale"),
    });

    expect(result.rework.decision).toBe("reverify");
    expect(repositories.getTask(producer.id)?.status).toBe("complete");
    expect(repositories.getCurrentBusinessArtifactForTask(producer.id)).toMatchObject({ id: "artifact_new", reviewStatus: "accepted" });
    expect(repositories.getTask(verifier.id)?.status).toBe("queued");
  });

  it("applies a rework as one unit, and finishes it when a failed attempt is retried", () => {
    const harness = createHarness({ validate: () => [] });
    const { repositories } = harness;
    const producer = { ...baseTask("producer_tx", "complete", "landing-page-file") };
    const verifier = { ...baseTask("verifier_tx", "running", "test-output") };
    repositories.createTask(producer);
    repositories.createTask(verifier);
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: producer.id, inputRole: "verification_target" });
    repositories.createBusinessArtifact(artifactRecord("artifact_tx", producer.id, {}));
    const report = {
      ...artifactRecord("report_tx", verifier.id, {}),
      reviewStatus: "unreviewed" as const,
      verification: {
        outcome: "failed" as const,
        requirementsArtifactId: null,
        requirements: [{ id: "r1", description: "works" }],
        targets: [{ taskId: producer.id, artifactId: "artifact_tx", revision: "a" }],
        checks: [{ requirementId: "r1", outcome: "failed" as const, evidence: "broken" }],
        issues: [],
      },
    };
    repositories.createBusinessArtifact(report);

    // Fail after the rework record is written but before the producer is sent back.
    let failNextReturn = true;
    const flaky = {
      ...repositories,
      updateBusinessArtifactReviewStatus: (...args: Parameters<typeof repositories.updateBusinessArtifactReviewStatus>) => {
        if (failNextReturn) {
          failNextReturn = false;
          throw new Error("interrupted mid-rework");
        }
        repositories.updateBusinessArtifactReviewStatus(...args);
      },
    } as typeof repositories;

    expect(() =>
      applyVerificationRework({ repositories: flaky, verifier: repositories.getTask(verifier.id)!, artifact: report, now: () => new Date(), createId: sequentialIds("tx1") }),
    ).toThrow(/interrupted mid-rework/);

    // Nothing was applied: no round was spent, and the delivery is untouched.
    expect(repositories.listVerificationReworksForVerifier(verifier.id)).toEqual([]);
    expect(repositories.getTask(producer.id)?.status).toBe("complete");
    expect(repositories.getCurrentBusinessArtifactForTask(producer.id)?.reviewStatus).toBe("accepted");
    expect(repositories.getTask(verifier.id)?.status).toBe("running");

    const retried = applyVerificationRework({
      repositories,
      verifier: repositories.getTask(verifier.id)!,
      artifact: report,
      now: () => new Date(),
      createId: sequentialIds("tx2"),
    });

    expect(retried.rework).toMatchObject({ round: 1, decision: "rework_producers", producerTaskIds: [producer.id] });
    expect(repositories.getTask(producer.id)?.status).toBe("queued");
    expect(repositories.getCurrentBusinessArtifactForTask(producer.id)?.reviewStatus).toBe("returned");
    expect(repositories.getTask(verifier.id)?.status).toBe("waiting_dependency");
  });

  it("reworks a split producer through its own stages, not by re-running the parent", async () => {
    const harness = createHarness({
      validate: () => [
        { requirement_id: "home-page", outcome: "passed", evidence: "index.html present." },
        { requirement_id: "app-script", outcome: "passed", evidence: "app.js present." },
      ],
    });
    await harness.runUntilIdle();
    const { repositories, parent } = harness;
    const { execute, validate } = harness.subtasks();
    repositories.appendProof({ id: "proof_parent_rw", taskId: parent.id, type: "file", uri: "summary.md", summary: "summary", verifiedAt: null });
    repositories.createBusinessArtifact(artifactRecord("artifact_parent_rw", parent.id, {}));

    const outerVerifier = { ...baseTask("outer_verifier", "running", "test-output"), position: 98 };
    repositories.createTask(outerVerifier);
    repositories.createTaskDependency({ taskId: outerVerifier.id, dependsOnTaskId: parent.id, inputRole: "verification_target" });
    const report = {
      ...artifactRecord("outer_report", outerVerifier.id, {}),
      reviewStatus: "unreviewed" as const,
      verification: {
        outcome: "failed" as const,
        requirementsArtifactId: null,
        requirements: [{ id: "accessible", description: "The page is reachable." }],
        targets: [{ taskId: parent.id, artifactId: "artifact_parent_rw", revision: "a" }],
        checks: [{ requirementId: "accessible", outcome: "failed" as const, evidence: "404 on load." }],
        issues: [],
      },
    };
    repositories.createBusinessArtifact(report);

    const result = applyVerificationRework({
      repositories,
      verifier: repositories.getTask(outerVerifier.id)!,
      artifact: report,
      now: () => new Date(),
      createId: sequentialIds("chain"),
    });

    // The execute stage redoes the work; its own verifier re-verifies the new output; the parent waits to
    // aggregate again — so no verdict keeps describing output it did not check.
    expect(result.rework.producerTaskIds).toEqual([execute.id]);
    expect(repositories.getTask(execute.id)?.status).toBe("queued");
    expect(repositories.getTask(validate.id)?.status).toBe("waiting_dependency");
    expect(repositories.getTask(parent.id)).toMatchObject({ status: "waiting_dependency" });
    expect(repositories.getCurrentBusinessArtifactForTask(parent.id)?.reviewStatus).toBe("returned");
    expect(pendingReworkFeedback(repositories, repositories.getTask(execute.id)!)[0]?.failedChecks.map((check) => check.requirementId)).toEqual(["accessible"]);
  });

  /**
   * The reported failure, pinned. The snapshot used to take its files from the producer *task*'s
   * artifact workspace, which only a department's split subtasks ever carry. A CEO-planned task that
   * was never split handed over its artifact record alone, so a verifier asked to check a report or a
   * brief could not read one — in a real smoke every check came back `not_run`.
   */
  it("hands over the files of a producer the department never split", () => {
    const harness = createHarness({ validate: () => [] });
    const producerWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-producer-"));
    const verifierWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-verifier-"));
    createdDirs.push(producerWorkspace, verifierWorkspace);
    writeFileSync(join(producerWorkspace, "research-report.md"), "# Findings\n");

    const { repositories } = harness;
    const define = baseTask("define_1", "complete", "product-brief");
    // No artifactWorkspacePath: this is a task the CEO planned, not a subtask a department split out.
    const producer = baseTask("research_1", "complete", "research-report");
    const verifier = { ...baseTask("verify_1", "queued", "research-report"), workspacePath: verifierWorkspace };
    for (const task of [define, producer, verifier]) {
      repositories.createTask(task);
    }
    repositories.createBusinessArtifact(artifactRecord("artifact_define_ns", define.id, {
      verification_requirements: [{ id: "r1", description: "The report has findings." }],
    }));
    repositories.createBusinessArtifact(artifactRecord("artifact_research", producer.id, {}, producerWorkspace));
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: define.id, inputRole: "verification_requirements" });
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: producer.id, inputRole: "verification_target" });

    const result = prepareVerificationInputs({ repositories, task: verifier, workspacePath: verifierWorkspace });

    expect(result.kind).toBe("ready");
    expect(repositories.getTask(producer.id)?.artifactWorkspacePath ?? null).toBeNull();
    expect(readFileSync(join(verifierWorkspace, ".auto-crop-inputs", producer.id, "files", "research-report.md"), "utf8")).toBe("# Findings\n");
  });

  it("hands over the workspace of the version being verified, not an earlier one", () => {
    const harness = createHarness({ validate: () => [] });
    const firstWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-producer-v1-"));
    const reworkWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-producer-v2-"));
    const verifierWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-verifier-"));
    createdDirs.push(firstWorkspace, reworkWorkspace, verifierWorkspace);
    writeFileSync(join(firstWorkspace, "report.md"), "first");
    writeFileSync(join(reworkWorkspace, "report.md"), "reworked");

    const { repositories } = harness;
    const define = baseTask("define_2", "complete", "product-brief");
    const producer = baseTask("research_2", "complete", "research-report");
    const verifier = { ...baseTask("verify_2", "queued", "research-report"), workspacePath: verifierWorkspace };
    for (const task of [define, producer, verifier]) {
      repositories.createTask(task);
    }
    repositories.createBusinessArtifact(artifactRecord("artifact_define_v", define.id, {
      verification_requirements: [{ id: "r1", description: "The report has findings." }],
    }));
    repositories.createBusinessArtifact(artifactRecord("artifact_v1", producer.id, {}, firstWorkspace));
    repositories.createBusinessArtifact(artifactRecord("artifact_v2", producer.id, {}, reworkWorkspace));
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: define.id, inputRole: "verification_requirements" });
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: producer.id, inputRole: "verification_target" });

    expect(prepareVerificationInputs({ repositories, task: verifier, workspacePath: verifierWorkspace }).kind).toBe("ready");
    expect(readFileSync(join(verifierWorkspace, ".auto-crop-inputs", producer.id, "files", "report.md"), "utf8")).toBe("reworked");
  });

  it("refuses to dispatch a verifier when the delivery records no workspace to hand over", () => {
    const harness = createHarness({ validate: () => [] });
    const verifierWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-verifier-"));
    createdDirs.push(verifierWorkspace);

    const { repositories } = harness;
    const define = baseTask("define_3", "complete", "product-brief");
    const producer = baseTask("research_3", "complete", "research-report");
    const verifier = { ...baseTask("verify_3", "queued", "research-report"), workspacePath: verifierWorkspace };
    for (const task of [define, producer, verifier]) {
      repositories.createTask(task);
    }
    repositories.createBusinessArtifact(artifactRecord("artifact_define_fc", define.id, {
      verification_requirements: [{ id: "r1", description: "The report has findings." }],
    }));
    // A delivery captured before the runtime recorded where it came from.
    repositories.createBusinessArtifact(artifactRecord("artifact_no_source", producer.id, {}));
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: define.id, inputRole: "verification_requirements" });
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: producer.id, inputRole: "verification_target" });

    const result = prepareVerificationInputs({ repositories, task: verifier, workspacePath: verifierWorkspace });

    // Named and stopped, rather than a snapshot of nothing the verifier would report on.
    expect(result).toMatchObject({ kind: "handoff_failed", producer: { id: producer.id } });
    expect(result.kind === "handoff_failed" && result.message).toContain("records no workspace to hand over");
    expect(existsSync(join(verifierWorkspace, ".auto-crop-inputs", producer.id, "files"))).toBe(false);
  });

  it("refuses to hand over a symbolic link out of the producer workspace", () => {
    const harness = createHarness({ validate: () => [] });
    const producerWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-producer-"));
    const verifierWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-verifier-"));
    createdDirs.push(producerWorkspace, verifierWorkspace);
    writeFileSync(join(producerWorkspace, "index.html"), "<h1>ok</h1>");
    symlinkSync("/etc/hosts", join(producerWorkspace, "hosts"));

    const { repositories } = harness;
    const define = { ...baseTask("define_1", "complete", "product-brief") };
    const producer = { ...baseTask("execute_1", "complete", "landing-page-file"), artifactWorkspacePath: producerWorkspace };
    const verifier = { ...baseTask("validate_1", "queued", "test-output"), workspacePath: verifierWorkspace };
    for (const task of [define, producer, verifier]) {
      repositories.createTask(task);
    }
    repositories.createBusinessArtifact(artifactRecord("artifact_define", define.id, {
      verification_requirements: [{ id: "r1", description: "works" }],
    }));
    repositories.createBusinessArtifact(artifactRecord("artifact_execute", producer.id, {}, producerWorkspace));
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: define.id, inputRole: "verification_requirements" });
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: producer.id, inputRole: "verification_target" });

    const result = prepareVerificationInputs({ repositories, task: verifier, workspacePath: verifierWorkspace });

    expect(result).toMatchObject({ kind: "handoff_failed", message: expect.stringContaining("symbolic link hosts") });
  });
});

function createHarness(behaviour: StageBehaviour) {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-verification-"));
  createdDirs.push(projectRoot);
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
  repositories.createCompany(companyRecord());
  repositories.createDepartment(departmentRecord());
  repositories.createObjective(objectiveRecord());
  repositories.createKeyResult(keyResultRecord());

  const parent: Task = {
    ...baseTask("task_1", "queued", "landing-page-file"),
    title: "Build the playable web prototype",
    description: "Build the playable web prototype, validate it locally, and capture proof.",
    decomposition: { template: "define_execute_validate" },
  };
  repositories.createTask(parent);

  const runOrder: Stage[] = [];
  const prompts = new Map<Stage, string>();
  const promptHistory: Array<{ stage: Stage; prompt: string }> = [];

  const stageOf = (taskId: string): Stage | null => {
    const title = repositories.getTask(taskId)?.title ?? "";
    if (title.startsWith("Define")) return "define";
    if (title.startsWith("Execute")) return "execute";
    if (title.startsWith("Validate")) return "validate";
    return null;
  };

  const adapter: AgentAdapter = {
    id: "mock-worker",
    name: "Mock Worker",
    capabilities: ["code"],
    detect: async () => true,
    run: async (request: AgentRunRequest) => {
      if (request.metadata.phase === "execution_brief") {
        return {
          status: "complete",
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ purpose: "Do the stage", approach: "Follow the contract", expectedOutcome: "A deliverable" }),
        };
      }
      const stage = stageOf(request.taskId)!;
      runOrder.push(stage);
      prompts.set(stage, request.prompt);
      promptHistory.push({ stage, prompt: request.prompt });
      const workspace = request.workspacePath;
      if (stage === "define") {
        writeArtifact(workspace, "plan", behaviour.requirements === null ? {} : {
          ...behaviour.defineExtra,
          verification_requirements: behaviour.requirements ?? [
            { id: "home-page", description: "The prototype has an index.html entry page." },
            { id: "app-script", description: "The prototype ships its app.js behaviour." },
          ],
        });
      } else if (stage === "execute") {
        writeFileSync(join(workspace, "index.html"), "<h1>Prototype</h1>");
        writeFileSync(join(workspace, "app.js"), "console.log('prototype');");
        writeFileSync(join(workspace, ".env"), "SECRET=1");
        mkdirSync(join(workspace, "node_modules"), { recursive: true });
        writeFileSync(join(workspace, "node_modules", "dep.js"), "");
        writeArtifact(workspace, "implementation", {});
      } else {
        const checks = behaviour.validate?.(workspace, request.prompt) ?? [];
        writeArtifact(
          workspace,
          "validation",
          behaviour.validateWithoutVerification ? {} : { verification: { checks } },
          behaviour.validateKind,
        );
      }
      return { status: "complete", exitCode: 0, stdout: `ran ${stage}`, stderr: "" };
    },
  };

  /**
   * Tick the scheduler until nothing moves, the parent is released for summarization (its own run is
   * outside these tests), or `until` holds.
   */
  const runUntilIdle = async (options: { until?: () => boolean } = {}) => {
    for (let tick = 0; tick < 12; tick += 1) {
      const split = repositories.listTasksForCompany("company_1").some((task) => task.parentTaskId === parent.id);
      if (options.until?.() || (split && repositories.getTask(parent.id)?.status === "queued")) {
        return;
      }
      const result = await runSchedulerOnce({
        projectRoot,
        repositories,
        adapters: [adapter],
        workerId: "worker_a",
        maxTasks: 1,
        now: () => new Date("2026-09-17T00:00:00.000Z"),
        approvalRequired: () => false,
        proofCollector: ({ task }) => [
          { id: `proof_${task.id}_${tick}`, taskId: task.id, type: "command_output", uri: "agent.log", summary: "ran", verifiedAt: null },
        ],
        emit: () => undefined,
      });
      if (split && [result.started, result.completed, result.blocked, result.failed].every((ids) => ids.length === 0)) {
        return;
      }
    }
  };

  return {
    repositories,
    parent,
    runOrder,
    prompts,
    promptHistory,
    client,
    runUntilIdle,
    subtasks: () => {
      const subtasks = repositories.listTasksForCompany("company_1").filter((task) => task.parentTaskId === parent.id);
      const find = (stage: Stage) => subtasks.find((task) => stageOf(task.id) === stage)!;
      return { define: find("define"), execute: find("execute"), validate: find("validate") };
    },
    agentRunStatuses: (taskId: string) =>
      (client.prepare("SELECT status FROM agent_runs WHERE task_id = ?").all(taskId) as Array<{ status: string }>).map((row) => row.status),
  };
}

function sequentialIds(tag: string): (prefix: string) => string {
  let sequence = 0;
  return (prefix) => `${prefix}_${tag}_${++sequence}`;
}

function snapshotFilesFor(workspacePath: string, prompt: string): string {
  const snapshotPath = prompt.match(/`(\.auto-crop-inputs\/[^`]+)`/)?.[1];
  return join(workspacePath, snapshotPath ?? ".auto-crop-inputs/missing", "files");
}

function writeArtifact(workspacePath: string, role: string, payload: Record<string, unknown>, kind = "deliverable"): void {
  mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
  writeFileSync(
    join(workspacePath, ".auto-crop", "business-artifact.json"),
    JSON.stringify({
      artifact_kind: kind,
      artifact_role: role,
      artifact_subtype: `prototype_${role}`,
      task_type: `engineering.prototype_${role}`,
      payload: {
        ...payload,
        report_version: 2,
        execution_report: {
          work_summary: "Performed the stage.",
          evidence: "Recorded the stage output.",
          conclusion: "The stage finished.",
          vision_impact: "It moves the prototype forward.",
          remaining_gap: "Later stages remain.",
          recommendation: "Continue.",
        },
        outcome_summary: "The stage finished and later stages remain.",
      },
      lineage: {},
    }),
    "utf8",
  );
}

function artifactRecord(id: string, taskId: string, payload: Record<string, unknown>, deliveryWorkspacePath: string | null = null) {
  return {
    id,
    companyId: "company_1",
    taskId,
    sourceProofId: null,
    artifactKind: "deliverable" as const,
    artifactRole: "implementation" as const,
    artifactSubtype: "prototype",
    artifactType: "implementation_summary" as const,
    taskType: "engineering.prototype",
    payload,
    lineage: {},
    validationStatus: "valid" as const,
    validationErrors: [],
    reviewStatus: "accepted" as const,
    isCurrent: true,
    supersedesArtifactId: null,
    deliveryWorkspacePath,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
  };
}

function baseTask(id: string, status: Task["status"], proofSchemaId: string): Task {
  return {
    id,
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    title: `Task ${id}`,
    description: "Run mock work.",
    assigneeAgentId: "mock-worker",
    requiredCapabilities: ["code"],
    proofSchemaId,
    workspacePath: null,
    status,
    riskLevel: "low",
    position: 0,
  };
}

function companyRecord(): Company {
  return {
    id: "company_1",
    name: "Verification Test Co",
    founderVision: "Ship a small prototype.",
    locale: "en",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    status: "active",
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
  };
}

function departmentRecord(): Department {
  return {
    id: "department_1",
    companyId: "company_1",
    name: "Engineering",
    responsibility: "Build and validate the product.",
    leadAgentId: "codex",
    memoryPath: ".auto-crop/companies/company_1/departments/engineering/Memory.md",
  };
}

function objectiveRecord(): Objective {
  return { id: "objective_1", companyId: "company_1", title: "Ship", status: "active", priority: 1 };
}

function keyResultRecord(): KeyResult {
  return {
    id: "key_result_1",
    objectiveId: "objective_1",
    title: "Prototype verified",
    metricName: "prototype_status",
    targetValue: "verified",
    currentValue: "not_started",
    status: "active",
  };
}

