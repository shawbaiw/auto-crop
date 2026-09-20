import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BlueprintTask, Locale, TaskDecomposition } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest } from "../adapters/types";
import { createMockAgentAdapter } from "../adapters/mockAgent";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { aiSaasPlaybook } from "../playbooks/aiSaas";
import { createCompany } from "./createCompany";
import { confirmReplanProposal } from "./replan";
import { runSchedulerOnce } from "./scheduler";
import { prepareVerificationInputs } from "./verificationContract";

/**
 * Verification a CEO plan declares, from the founder's input to a verdict. Each business starts at
 * `createCompany` with a company name and vision; the mock CEO returns a blueprint, and everything after —
 * parsing, task and dependency persistence, dispatch, snapshot handoff, capture — is production code.
 * No dependency is inserted by hand. The businesses differ in what they deliver (files in a workspace,
 * a data file, prose carried in the artifact itself) and none of them mentions Search Console.
 */

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

type Business = {
  name: string;
  companyName: string;
  vision: string;
  locale: Locale;
  producer: Omit<BlueprintTask, "verification" | "decomposition" | "assigneeAgentId" | "dependsOnTaskKeys">;
  verifier: Omit<BlueprintTask, "verification" | "decomposition" | "assigneeAgentId" | "dependsOnTaskKeys" | "proofSchemaId">;
  requirements: Array<{ id: string; description: string }>;
  /** What the producer's agent delivers; `defective` leaves out what one requirement checks. */
  produce: (workspacePath: string, defective: boolean) => Record<string, unknown>;
  /** Whether the producer is one a department splits into stages. */
  decomposition?: TaskDecomposition | null;
  /** A real check of the snapshot the runtime handed over, per requirement. */
  check: (snapshotPath: string) => Record<string, boolean>;
};

const BUSINESSES: Business[] = [
  {
    name: "a website",
    companyName: "Tide Tables",
    vision: "Publish a simple tide-times site for coastal walkers.",
    locale: "en",
    producer: {
      key: "build_site",
      departmentName: "Engineering",
      title: "Build the tide-times site",
      description: "Build the static site with a home page and a tide table page.",
      requiredCapabilities: ["code", "frontend"],
      proofSchemaId: "landing-page-file",
      riskLevel: "low",
      handoffContract: "Static site files.",
    },
    verifier: {
      key: "check_site",
      departmentName: "Engineering",
      title: "Check the tide-times site",
      description: "Check the built site against its requirements.",
      requiredCapabilities: ["code", "test"],
      riskLevel: "low",
      handoffContract: "A verdict per requirement.",
    },
    requirements: [
      { id: "home-page", description: "The site has an index.html home page." },
      { id: "tide-table", description: "The site has a tides.html page with a table." },
    ],
    produce: (workspacePath, defective) => {
      writeFileSync(join(workspacePath, "index.html"), "<h1>Tide Tables</h1>");
      if (!defective) {
        writeFileSync(join(workspacePath, "tides.html"), "<table><tr><td>06:12</td></tr></table>");
      }
      return {};
    },
    check: (snapshotPath) => ({
      "home-page": existsSync(join(snapshotPath, "files", "index.html")),
      "tide-table": existsSync(join(snapshotPath, "files", "tides.html"))
        && readFileSync(join(snapshotPath, "files", "tides.html"), "utf8").includes("<table>"),
    }),
  },
  {
    name: "a data-cleaning job",
    companyName: "Clean Rolls",
    vision: "Clean our member sign-up list so the newsletter reaches real people.",
    locale: "en",
    producer: {
      key: "clean_members",
      departmentName: "Engineering",
      title: "Clean the member sign-up list",
      description: "Remove rows without an email and deduplicate members.",
      requiredCapabilities: ["code"],
      proofSchemaId: "repo-diff",
      riskLevel: "low",
      handoffContract: "The cleaned members CSV.",
    },
    verifier: {
      key: "audit_members",
      departmentName: "Research",
      title: "Audit the cleaned member list",
      description: "Audit the cleaned list against its data-quality requirements.",
      requiredCapabilities: ["research"],
      riskLevel: "low",
      handoffContract: "A verdict per data-quality requirement.",
    },
    requirements: [
      { id: "no-missing-email", description: "Every row has an email address." },
      { id: "no-duplicates", description: "No email address appears twice." },
    ],
    produce: (workspacePath, defective) => {
      const rows = defective ? ["a@x.test", "a@x.test", "b@x.test"] : ["a@x.test", "b@x.test"];
      writeFileSync(join(workspacePath, "members.csv"), `email\n${rows.join("\n")}\n`);
      writeFileSync(join(workspacePath, "cleaning.diff"), "diff --git a/members.csv b/members.csv\n");
      return {};
    },
    check: (snapshotPath) => {
      const csv = join(snapshotPath, "files", "members.csv");
      const rows = existsSync(csv) ? readFileSync(csv, "utf8").trim().split("\n").slice(1) : [];
      return {
        "no-missing-email": rows.length > 0 && rows.every((row) => row.includes("@")),
        "no-duplicates": rows.length > 0 && new Set(rows).size === rows.length,
      };
    },
  },
  {
    name: "written content",
    companyName: "茶山札记",
    vision: "为茶园访客写一篇带引用来源的采茶指南。",
    locale: "zh",
    producer: {
      key: "write_guide",
      departmentName: "Growth",
      title: "撰写采茶指南",
      description: "撰写采茶指南，并为每个事实列出来源。",
      requiredCapabilities: ["writing"],
      proofSchemaId: "product-brief",
      riskLevel: "low",
      handoffContract: "带来源的采茶指南正文。",
    },
    verifier: {
      key: "review_guide",
      departmentName: "Product",
      title: "审核采茶指南",
      description: "按要求审核指南。",
      requiredCapabilities: ["writing"],
      riskLevel: "low",
      handoffContract: "逐项审核结论。",
    },
    requirements: [
      { id: "has-body", description: "指南有正文。" },
      { id: "has-sources", description: "指南至少列出一个来源。" },
    ],
    produce: (_workspacePath, defective) => ({
      guide: { body: "清晨采摘一芽一叶。", sources: defective ? [] : ["《茶经》"] },
    }),
    check: (snapshotPath) => {
      const record = JSON.parse(readFileSync(join(snapshotPath, "business-artifact.json"), "utf8")) as {
        payload: { guide?: { body?: string; sources?: string[] } };
      };
      return {
        "has-body": Boolean(record.payload.guide?.body),
        "has-sources": (record.payload.guide?.sources?.length ?? 0) > 0,
      };
    },
  },
];

describe("verification planned by the CEO blueprint", () => {
  for (const business of BUSINESSES) {
    for (const defective of [false, true]) {
      it(`${business.name}: a verifier planned at company creation ${defective ? "blocks a defective" : "accepts a sound"} delivery`, async () => {
        const run = await runBusiness(business, defective);

        const verifier = run.taskByKey(business.verifier.key);
        const producer = run.taskByKey(business.producer.key);
        expect(run.repositories.listTaskDependencies(verifier.id)).toContainEqual(
          expect.objectContaining({ dependsOnTaskId: producer.id, inputRole: "verification_target" }),
        );
        expect(run.repositories.getTask(verifier.id)?.verificationRequirements).toEqual(business.requirements);

        if (defective) {
          // A defect is stopped by a verification — the planned verifier's, or, when the producer was
          // split by its department, the department's own Validate stage first — and the planned
          // verifier never completes.
          expect(run.repositories.getTask(verifier.id)?.status).not.toBe("complete");
          const failedVerifications = run.repositories
            .listTasksForCompany(verifier.companyId)
            .filter((task) => task.latestFailureReason === "verification_failed");
          expect(failedVerifications.length).toBeGreaterThan(0);
          for (const task of failedVerifications) {
            expect(run.repositories.getCurrentBusinessArtifactForTask(task.id)?.verification?.outcome).toBe("failed");
          }
        } else {
          const artifact = run.repositories.getCurrentBusinessArtifactForTask(verifier.id)!;
          expect(artifact.verification).toMatchObject({
            outcome: "passed",
            targets: [{ taskId: producer.id, artifactId: run.repositories.getCurrentBusinessArtifactForTask(producer.id)!.id }],
          });
          expect(run.repositories.getTask(verifier.id)?.status).toBe("complete");
        }
      });
    }

    it(`${business.name}: a defect the producer fixes on rework passes re-verification`, async () => {
      const run = await runBusiness(business, "until_rework");

      const verifier = run.taskByKey(business.verifier.key);
      const producer = run.taskByKey(business.producer.key);
      expect(run.repositories.getTask(verifier.id)?.status).toBe("complete");
      expect(run.repositories.getCurrentBusinessArtifactForTask(verifier.id)?.verification).toMatchObject({
        outcome: "passed",
        targets: [{ taskId: producer.id, artifactId: run.repositories.getCurrentBusinessArtifactForTask(producer.id)!.id }],
      });
      // Some verifier in the plan — the planned one, or a department's Validate stage — sent work back once.
      const reworks = run.repositories
        .listTasksForCompany(verifier.companyId)
        .flatMap((task) => run.repositories.listVerificationReworksForVerifier(task.id));
      expect(reworks.map((rework) => rework.decision)).toEqual(["rework_producers"]);
      expect(reworks[0]!.redeliveredTaskIds).toEqual(reworks[0]!.producerTaskIds);
    });
  }

  it("keeps verification duty when a planned verifier is replaced through a replan", async () => {
    const business = BUSINESSES[1]!;
    const { repositories, projectRoot, created } = await createOnly(business);
    const verifier = created.tasks.find((task) => task.title === business.verifier.title)!;
    const producer = created.tasks.find((task) => task.title === business.producer.title)!;
    repositories.createReplanProposal({
      id: "replan_1",
      companyId: verifier.companyId,
      sourceTaskId: verifier.id,
      status: "proposed",
      proposalSource: "deterministic_template",
      plannerAgentId: null,
      plannerPromptPath: null,
      plannerFailureReason: null,
      plannerFailureMessage: null,
      rationale: "Split the audit.",
      replacementTasks: [
        { title: "Prepare the audit", description: "Prepare.", requiredCapabilities: ["research"], proofSchemaId: "research-report", riskLevel: "low" },
        { title: "Run the audit", description: "Run.", requiredCapabilities: ["research"], proofSchemaId: "test-output", riskLevel: "low" },
      ],
      createdAt: "2026-09-17T00:00:00.000Z",
      confirmedAt: null,
    });

    const confirmed = confirmReplanProposal({ projectRoot, repositories, proposalId: "replan_1" });

    const finalReplacement = confirmed.createdTasks.at(-1)!;
    expect(repositories.listTaskDependencies(finalReplacement.id)).toContainEqual(
      expect.objectContaining({ dependsOnTaskId: producer.id, inputRole: "verification_target" }),
    );
    expect(repositories.getTask(finalReplacement.id)?.verificationRequirements).toEqual(business.requirements);
    expect(repositories.getTask(confirmed.createdTasks[0]!.id)?.verificationRequirements ?? null).toBeNull();
  });

  it("never splits a verifying task, and refuses a verifier with two requirement sources", async () => {
    const business = BUSINESSES[1]!;
    const { repositories, projectRoot, created } = await createOnly(business);
    const verifier = created.tasks.find((task) => task.title === business.verifier.title)!;
    const producer = created.tasks.find((task) => task.title === business.producer.title)!;

    // Shaped like a task the split template would take — it still stays one verifier.
    client(repositories).prepare("UPDATE tasks SET proof_schema_id = 'landing-page-file', description = ? WHERE id = ?")
      .run("Validate the prototype build before deployment.", verifier.id);
    // The producer has delivered and been accepted, so the verifier is ready and reaches assessment.
    client(repositories).prepare("UPDATE tasks SET status = 'complete' WHERE id = ?").run(producer.id);
    repositories.createBusinessArtifact({
      id: "producer_artifact",
      companyId: producer.companyId,
      taskId: producer.id,
      sourceProofId: null,
      artifactKind: "deliverable",
      artifactRole: "implementation",
      artifactSubtype: "cleaned_list",
      artifactType: "implementation_summary",
      taskType: "data.cleaning",
      payload: {},
      lineage: {},
      validationStatus: "valid",
      validationErrors: [],
      reviewStatus: "accepted",
      isCurrent: true,
      supersedesArtifactId: null,
      deliveryWorkspacePath: null,
      createdAt: "2026-09-17T00:00:00.000Z",
      updatedAt: "2026-09-17T00:00:00.000Z",
    });
    const idle = createMockAgentAdapter({ id: "worker", name: "Worker", capabilities: ["code", "research"], status: "failed" });
    await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [idle],
      workerId: "worker_a",
      maxTasks: 1,
      approvalRequired: () => false,
      proofCollector: () => [],
      emit: () => undefined,
    });
    expect(repositories.listTaskProgressEventsForParentTask(verifier.id).map((event) => event.step)).toContain("no_split_needed");
    expect(repositories.listTasksForCompany(verifier.companyId).filter((task) => task.parentTaskId === verifier.id)).toEqual([]);

    const define = { ...producer, id: "extra_requirements_source", title: "Extra requirements", position: 99 };
    repositories.createTask(define);
    repositories.createTaskDependency({ taskId: verifier.id, dependsOnTaskId: define.id, inputRole: "verification_requirements" });
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-planned-ws-"));
    createdDirs.push(workspacePath);
    expect(prepareVerificationInputs({ repositories, task: repositories.getTask(verifier.id)!, workspacePath })).toMatchObject({
      kind: "handoff_failed",
      message: expect.stringContaining("both planned verification requirements and an upstream requirements source"),
    });
  });

  it("refuses a plan whose verifier targets a later task, before creating any company", async () => {
    const business = BUSINESSES[0]!;
    const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-planned-"));
    createdDirs.push(projectRoot);
    const client = createDatabaseClient(":memory:");
    migrate(client);
    const repositories = createRepositories(client);
    const blueprint = blueprintFor(business);
    blueprint.tasks = [blueprint.tasks[1]!, blueprint.tasks[0]!];

    await expect(createCompany({
      projectRoot,
      companyName: business.companyName,
      founderVision: business.vision,
      selectedCeoAgent: ceoReturning(blueprint),
      availableAgents: [],
      repositories,
      permissionMode: "balanced",
      assets: [],
    })).rejects.toThrow();
    expect(repositories.listCompanies()).toEqual([]);
  });
});

const clients = new WeakMap<object, ReturnType<typeof createDatabaseClient>>();

function client(repositories: ReturnType<typeof createRepositories>) {
  return clients.get(repositories)!;
}

async function createOnly(business: Business) {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-planned-"));
  createdDirs.push(projectRoot);
  const database = createDatabaseClient(":memory:");
  migrate(database);
  const repositories = createRepositories(database);
  clients.set(repositories, database);
  const created = await createCompany({
    projectRoot,
    companyName: business.companyName,
    founderVision: business.vision,
    locale: business.locale,
    selectedCeoAgent: ceoReturning(blueprintFor(business)),
    availableAgents: [],
    repositories,
    permissionMode: "balanced",
    assets: [],
  });
  return { repositories, projectRoot, created };
}

async function runBusiness(business: Business, defective: boolean | "until_rework") {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-planned-"));
  createdDirs.push(projectRoot);
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);

  const created = await createCompany({
    projectRoot,
    companyName: business.companyName,
    founderVision: business.vision,
    locale: business.locale,
    selectedCeoAgent: ceoReturning(blueprintFor(business)),
    availableAgents: [],
    repositories,
    permissionMode: "balanced",
    assets: [],
  });
  const taskByKey = (key: string) => {
    const title = [business.producer, business.verifier].find((task) => task.key === key)!.title;
    return created.tasks.find((task) => task.title === title)!;
  };

  const worker: AgentAdapter = {
    id: "worker",
    name: "Worker",
    capabilities: ["code", "frontend", "test", "research", "writing"],
    detect: async () => true,
    run: async (request: AgentRunRequest) => {
      if (request.metadata.phase === "execution_brief") {
        return { status: "complete", exitCode: 0, stderr: "", stdout: JSON.stringify({ purpose: "p", approach: "a", expectedOutcome: "e" }) };
      }
      // The worker acts on the contract sections the runtime put in its prompt, not on which task it is:
      // the planned verifier and a department's Validate stage are both verifiers.
      if (request.prompt.includes("## Verification Contract")) {
        const snapshotPath = request.prompt.match(/`(\.auto-crop-inputs\/[^`]+)`/)?.[1];
        const results = snapshotPath ? business.check(join(request.workspacePath, snapshotPath)) : {};
        writeArtifact(request.workspacePath, "validation", {
          verification: {
            checks: business.requirements.map((requirement) => ({
              requirement_id: requirement.id,
              outcome: results[requirement.id] ? "passed" : "failed",
              evidence: `Checked ${requirement.id} in the handed-over snapshot.`,
            })),
          },
        });
      } else {
        // "until_rework": defective until a verifier's feedback reaches this producer, then fixed.
        const isDefective = defective === "until_rework" ? !request.prompt.includes("## Rework Requested") : defective;
        const delivered = business.produce(request.workspacePath, isDefective);
        writeArtifact(request.workspacePath, "implementation", {
          ...delivered,
          ...(request.prompt.includes("## Verification Requirements") ? { verification_requirements: business.requirements } : {}),
        });
      }
      return { status: "complete", exitCode: 0, stdout: "done", stderr: "" };
    },
  };

  // A tick that only assesses or splits a task reports nothing, so stop after two quiet ticks in a row.
  let quietTicks = 0;
  for (let tick = 0; tick < 40 && quietTicks < 2; tick += 1) {
    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [worker],
      workerId: "worker_a",
      maxTasks: 1,
      approvalRequired: () => false,
      proofCollector: ({ task }) => [
        { id: `proof_${task.id}_${tick}`, taskId: task.id, type: "file", uri: "delivery", summary: "delivery", verifiedAt: null },
      ],
      emit: () => undefined,
    });
    quietTicks = [result.started, result.completed, result.blocked, result.failed].every((ids) => ids.length === 0)
      ? quietTicks + 1
      : 0;
  }

  return { repositories, taskByKey };
}

function blueprintFor(business: Business) {
  const base = aiSaasPlaybook.createBlueprint({
    companyName: business.companyName,
    founderVision: business.vision,
    preferredEngineeringAgentId: "worker",
    preferredStrategyAgentId: "worker",
  });
  return {
    ...base,
    tasks: [
      { ...business.producer, assigneeAgentId: "worker", dependsOnTaskKeys: [], verification: null, decomposition: business.decomposition ?? null },
      {
        ...business.verifier,
        assigneeAgentId: "worker",
        proofSchemaId: "test-output",
        dependsOnTaskKeys: [business.producer.key],
        verification: { targetTaskKeys: [business.producer.key], requirements: business.requirements },
        decomposition: null,
      },
    ],
  };
}

function ceoReturning(blueprint: unknown): AgentAdapter {
  return createMockAgentAdapter({
    id: "codex",
    name: "Codex",
    capabilities: ["code"],
    output: ["## Human CEO Brief", "Plan.", "```json", JSON.stringify({ brief: "Plan.", blueprint }), "```"].join("\n"),
  });
}

function writeArtifact(workspacePath: string, role: string, payload: Record<string, unknown>) {
  mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
  writeFileSync(
    join(workspacePath, ".auto-crop", "business-artifact.json"),
    JSON.stringify({
      artifact_kind: "deliverable",
      artifact_role: role,
      artifact_subtype: `${role}_result`,
      task_type: `planned.${role}`,
      payload: {
        ...payload,
        report_version: 2,
        execution_report: {
          work_summary: "Did the work.",
          evidence: "Recorded the output.",
          conclusion: "The work is done.",
          vision_impact: "It moves the vision forward.",
          remaining_gap: "Nothing further in this task.",
          recommendation: "Continue.",
        },
        outcome_summary: "The work is done.",
      },
      lineage: {},
    }),
    "utf8",
  );
}
