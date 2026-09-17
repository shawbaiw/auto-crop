import { projectCeoOfficeItems } from "@auto-crop/core";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  it("keeps a well-formed failed verification out of every success path", async () => {
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

    expect(validateTask).toMatchObject({ status: "blocked", latestFailureReason: "verification_failed" });
    expect(artifact).toMatchObject({ validationStatus: "valid", reviewStatus: "unreviewed" });
    expect(artifact.verification?.outcome).toBe("failed");
    expect(harness.agentRunStatuses(validate.id)).toEqual(["complete"]);
    expect(harness.repositories.listOpenTaskHolds(validate.id).map((hold) => hold.kind)).toEqual(["verification_failed"]);
    expect(resolveTaskAffordanceState(harness.repositories, validateTask).affordances.map((affordance) => affordance.kind))
      .toEqual(expect.arrayContaining(["recover_task", "request_replan"]));

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

  it("routes a failed verification recovered from a workspace to a verification Hold, not CEO review", () => {
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
    repositories.createBusinessArtifact(artifactRecord("artifact_execute", producer.id, {}));
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

    expect(result.task).toMatchObject({ status: "blocked", latestFailureReason: "verification_failed" });
    expect(repositories.listOpenTaskHolds(verifier.id).map((hold) => hold.kind)).toEqual(["verification_failed"]);
    const artifact = repositories.getCurrentBusinessArtifactForTask(verifier.id)!;
    expect(artifact.verification?.outcome).toBe("failed");
    expect(isReviewableBusinessArtifact(artifact)).toBe(false);
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
    repositories.createBusinessArtifact(artifactRecord("artifact_execute", producer.id, {}));
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
  };
  repositories.createTask(parent);

  const runOrder: Stage[] = [];
  const prompts = new Map<Stage, string>();

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

function artifactRecord(id: string, taskId: string, payload: Record<string, unknown>) {
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

