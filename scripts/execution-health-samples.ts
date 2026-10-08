import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexAdapter, noToolGrant } from "@auto-crop/server";

// Explicit invocation is required; no paid calls are made by the test suite.
if (process.env.AUTO_CROP_ALLOW_REAL_SAMPLES !== "codex") throw new Error("Set AUTO_CROP_ALLOW_REAL_SAMPLES=codex after authorizing up to 10 CLI invocations");
const root = mkdtempSync(join(tmpdir(), "auto-crop-p5-codex-"));
chmodSync(root, 0o700);
const adapter = createCodexAdapter();
const support = await adapter.launchPlan!();
if (support.support.isolationLevel !== "strong") throw new Error("Real samples require strong config isolation");
const summaries: unknown[] = [];
console.log(`Private sample directory: ${root}`);
const cases = ["brief", "execute", "repair", "brief", "execute", "repair", "brief", "execute", "cancel"] as const;
for (const [index, phase] of cases.entries()) {
  const workspace = join(root, `sample-${index + 1}`);
  mkdirSync(workspace);
  const file = join(workspace, "sample.json");
  if (phase === "repair") writeFileSync(file, '{"ok":true,}', "utf8");
  const prompt = phase === "brief" ? 'Return exactly {"purpose":"check","approach":"write one JSON file","expectedOutcome":"valid JSON"}. Do not use tools.'
    : phase === "repair" ? 'Fix the trailing comma in sample.json. It must contain exactly {"ok":true}. Edit no other files. Reply done.'
      : phase === "cancel" ? "Explain briefly why a JSON trailing comma is invalid. Do not use tools."
        : 'Create sample.json containing exactly {"ok":true}. Edit no other files. Reply done.';
  const controller = new AbortController();
  const started = performance.now();
  const output: Array<{ atMs: number; channel: string; bytes: number }> = [];
  const timer = phase === "cancel" ? setTimeout(() => controller.abort(), 1500) : undefined;
  try {
    const result = await adapter.run({ taskId: `p5_sample_${index + 1}`, prompt, promptPath: "", workspacePath: workspace,
      metadata: { phase }, timeoutMs: 60_000, graceMs: 2000, confirmMs: 2000, signal: controller.signal,
      grant: phase === "brief" || phase === "cancel" ? noToolGrant : { granted: ["workspace_read", "workspace_write"], withheld: [], id: "workspace_read+workspace_write" },
      ...(phase === "brief" ? { outputSchema: { type: "object", properties: { purpose: { type: "string" }, approach: { type: "string" }, expectedOutcome: { type: "string" } }, required: ["purpose", "approach", "expectedOutcome"], additionalProperties: false } } : {}),
      observe: { output: (channel, bytes) => output.push({ atMs: Math.round(performance.now() - started), channel, bytes }) },
    });
    const elapsedMs = Math.round(performance.now() - started);
    writeFileSync(join(workspace, "raw.log"), `${result.stdout}\n${result.stderr}`, { mode: 0o600 });
    let verified = false;
    try { verified = phase === "execute" || phase === "repair" ? JSON.parse(readFileSync(file, "utf8")).ok === true
      : phase === "brief" ? JSON.parse(result.stdout).purpose === "check" : result.failureReason === "cancelled" && result.terminationConfirmed === true; } catch { /* Recorded as unverified. */ }
    const times = [0, ...output.map(o => o.atMs), elapsedMs];
    const summary = { sample: index + 1, phase, status: result.status, failureReason: result.failureReason ?? null,
      terminationConfirmed: result.terminationConfirmed ?? null, elapsedMs, verified,
      censored: result.failureReason === "timeout" || result.failureReason === "cancelled",
      firstActivityMs: output[0]?.atMs ?? null, longestObservedSilenceMs: output.length ? Math.max(...times.slice(1).map((t, i) => t - times[i])) : null,
      bytes: output.reduce((sum, o) => sum + o.bytes, 0),
      completedBeyondScaledOldBudget: result.status === "complete" && elapsedMs > 1000 };
    summaries.push(summary);
    console.log(JSON.stringify(summary));
    writeFileSync(join(root, "summary.json"), JSON.stringify({ adapter: "codex", model: process.env.AUTO_CROP_CODEX_MODEL ?? "gpt-5.5", scaledOldBudgetMs: 1000, summaries }, null, 2), { mode: 0o600 });
    // An unavailable account/model is not improved by spending the remaining allowance on repeats.
    if (result.status === "failed" && phase !== "cancel") break;
  } finally { if (timer) clearTimeout(timer); }
}
console.log(`Retained private logs and summary: ${root}; remove within 7 days after review.`);
