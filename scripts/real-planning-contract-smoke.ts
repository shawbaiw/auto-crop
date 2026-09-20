// Real-agent smoke for the planning contract (ADR 0025): does a real CEO Agent declare
// `verification` on every blueprint task? Runs one planning per case in parallel, through the same
// `generateCompanyBlueprint` entry point company creation uses, and keeps the raw reply so a parse
// failure can be read rather than guessed at.
//
// Costs real agent runs, so it is manual: `pnpm smoke:real-planning`. Override the cases with
// SMOKE_CASES (a JSON array of {id, agent, companyName, founderVision}) and the output directory with
// SMOKE_OUT_DIR. It fails when any planning does not parse; whether a declared verification is the
// *right* one (a checking task declared `null`, say) still needs a person to read the summary.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeCodeAdapter, createCodexAdapter, generateCompanyBlueprint, type AgentAdapter } from "@auto-crop/server";

type Case = { id: string; agent: "codex" | "claude-code"; companyName: string; founderVision: string };

const seoVision =
  "发现一个海外英文关键词需求，做一个工具站或 AI 网站，通过 Google SEO 获得自然搜索流量，再用广告、订阅或联盟营销变现。第一个网站的重点是跑通上线和进入搜索结果的完整流程。";
const dataVision =
  "Build a small service that takes messy CSV exports from small-business bookkeeping tools, cleans and normalizes them (dates, currencies, duplicate rows, vendor names), and returns a reconciled file plus a short data-quality report. Validate that the cleaning is correct on real-looking sample files before offering it to paying customers.";
const defaultCases: Case[] = [
  { id: "codex-zh-seo", agent: "codex", companyName: "Keyword Site", founderVision: seoVision },
  { id: "claude-zh-seo", agent: "claude-code", companyName: "Keyword Site", founderVision: seoVision },
  { id: "codex-en-data", agent: "codex", companyName: "Ledger Tidy", founderVision: dataVision },
];

const outDir = process.env.SMOKE_OUT_DIR ?? mkdtempSync(join(tmpdir(), "auto-crop-real-planning-smoke-"));
const cases: Case[] = process.env.SMOKE_CASES ? JSON.parse(process.env.SMOKE_CASES) : defaultCases;
mkdirSync(outDir, { recursive: true });

const available = [createClaudeCodeAdapter(), createCodexAdapter()];

const results = await Promise.all(cases.map(runCase));
writeFileSync(join(outDir, "summary.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

const failed = results.filter((result) => !result.ok);
console.log(`\nPlanning contract smoke: ${results.length - failed.length}/${results.length} plans parsed. Output: ${outDir}`);
if (failed.length > 0) {
  console.error(`Failed: ${failed.map((result) => result.id).join(", ")}. Raw replies are in each case's ceo-stdout.txt.`);
  process.exitCode = 1;
}

async function runCase(smokeCase: Case) {
  const caseRoot = join(outDir, smokeCase.id);
  mkdirSync(caseRoot, { recursive: true });
  const base = available.find((agent) => agent.id === smokeCase.agent);
  if (!base) {
    return { id: smokeCase.id, ok: false, seconds: 0, error: `Unknown agent: ${smokeCase.agent}` };
  }
  const recording: AgentAdapter = {
    ...base,
    detect: () => base.detect(),
    run: async (request) => {
      const result = await base.run(request);
      writeFileSync(join(caseRoot, "ceo-stdout.txt"), result.stdout);
      writeFileSync(join(caseRoot, "ceo-stderr.txt"), result.stderr);
      return result;
    },
  };
  const startedAt = Date.now();
  try {
    // Parsing is the contract check: the blueprint schema requires `verification` (null or a target
    // with requirements) on every task and validates the targets, so a plan that parses has declared
    // verification duty for every task.
    const { blueprint } = await generateCompanyBlueprint({
      projectRoot: caseRoot,
      companyId: `company_smoke_${smokeCase.id}`,
      companyName: smokeCase.companyName,
      founderVision: smokeCase.founderVision,
      selectedCeoAgent: recording,
      availableAgents: available,
      permissionMode: "balanced",
      assets: [],
      agentSessionEnv: {},
    });
    writeFileSync(join(caseRoot, "blueprint.json"), JSON.stringify(blueprint, null, 2));
    return {
      id: smokeCase.id,
      ok: true,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      taskCount: blueprint.tasks.length,
      verifierCount: blueprint.tasks.filter((task) => task.verification).length,
      tasks: blueprint.tasks.map((task) => ({
        key: task.key,
        department: task.departmentName,
        title: task.title,
        proofSchemaId: task.proofSchemaId,
        dependsOn: task.dependsOnTaskKeys,
        verification: task.verification,
      })),
    };
  } catch (error) {
    return {
      id: smokeCase.id,
      ok: false,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      error: (error as Error).message.slice(0, 4000),
    };
  }
}
