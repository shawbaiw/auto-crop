import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { aiSaasPlaybook } from "../playbooks/aiSaas";
import { writeCompanyBlueprintRecords } from "./createCompany";
import { applyTaskTransition } from "./taskTransition";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("a task serves one key result (ADR 0048)", () => {
  it("places every blueprint task under the key result it names, and announces the goals with the plan", () => {
    const { repositories, result } = writeBlueprint();
    const keyResultTitles = new Map(result.keyResults.map((keyResult) => [keyResult.id, keyResult.title]));

    expect(result.tasks.map((task) => [task.title, keyResultTitles.get(task.keyResultId!)])).toEqual([
      ["Write the first product brief", "Document the first revenue path"],
      ["Create competitor and customer pain research", "Document the first revenue path"],
      ["Draft early acquisition assets", "Document the first revenue path"],
      ["Create the first landing page prototype", "Ship a proof-backed landing page prototype"],
      ["Run local validation for the prototype", "Ship a proof-backed landing page prototype"],
    ]);

    const snapshot = repositories.listCompanyEventsForCompany("company_1").find((event) => event.planSnapshot)!.planSnapshot!;
    expect(snapshot.objectives).toEqual([
      expect.objectContaining({
        title: expect.objectContaining({ en: "Validate the first AI SaaS wedge" }),
        keyResults: [
          expect.objectContaining({ title: expect.objectContaining({ en: "Ship a proof-backed landing page prototype" }) }),
          expect.objectContaining({ title: expect.objectContaining({ en: "Document the first revenue path" }) }),
        ],
      }),
    ]);
    expect(snapshot.tasks.every((task) => task.keyResultId !== null)).toBe(true);
  });

  it("meets a key result only when every task serving it is complete, and reopens it when one is not", () => {
    const { repositories, result } = writeBlueprint();
    const prototype = result.keyResults.find((keyResult) => keyResult.title.startsWith("Ship"))!;
    const [build, validate] = result.tasks.filter((task) => task.keyResultId === prototype.id);
    const status = () => repositories.listKeyResults("company_1").find((keyResult) => keyResult.id === prototype.id)!;

    applyTaskTransition({ repositories, task: build!.id, status: "complete" });
    expect(status()).toMatchObject({ status: "active", currentValue: "not_started" });

    applyTaskTransition({ repositories, task: validate!.id, status: "complete" });
    expect(status()).toMatchObject({ status: "met", currentValue: "not_started" });

    // The other key result is untouched by tasks that do not serve it.
    expect(repositories.listKeyResults("company_1").find((keyResult) => keyResult.id !== prototype.id)?.status).toBe("active");

    applyTaskTransition({ repositories, task: validate!.id, status: "queued" });
    expect(status().status).toBe("active");
  });
});

function writeBlueprint() {
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-key-results-"));
  dirs.push(projectRoot);
  const blueprint = aiSaasPlaybook.createBlueprint({
    companyName: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    preferredEngineeringAgentId: "codex",
    preferredStrategyAgentId: "claude-code",
  });
  const company: Company = {
    id: "company_1", name: "Pricing Page Studio", founderVision: blueprint.company.founderVision, locale: "en",
    selectedCeoAgentId: "codex", playbookId: "ai-saas", permissionMode: "balanced", status: "active",
    createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z",
  };
  repositories.createCompany(company);
  let next = 0;
  const result = writeCompanyBlueprintRecords({
    projectRoot, company, blueprint, repositories, createdAt: "2026-10-13T00:00:00.000Z", createId: (prefix) => `${prefix}_${++next}`,
  });
  return { repositories, result };
}
