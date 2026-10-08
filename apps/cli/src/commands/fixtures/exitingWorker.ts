// Local process fixture: the scheduler really claims a run and spawns a detached writer.
// The writer's PID is sent only to the test for cleanup, never to the runtime database.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createDatabaseClient, createRepositories, migrate, runSchedulerOnce } from "@auto-crop/server";

const [projectRoot, ownerId, budgetMode] = process.argv.slice(2);
const database = createDatabaseClient(join(projectRoot, ".auto-crop", "state.sqlite"));
migrate(database);
process.on("message", (message) => { if (message === "crash") process.exit(1); });
await runSchedulerOnce({
  projectRoot, repositories: createRepositories(database), workerId: ownerId, maxTasks: 1,
  executionBudget: budgetMode === "budget" || budgetMode === "wedged" ? { runHardMs: 10_000, taskTotalMs: 15_000, persistMs: 20,
    ...(budgetMode === "wedged" ? { suspectAfterMs: 100, lostAfterMs: 250, resumeGraceMs: 50 } : {}) } : undefined,
  approvalRequired: () => false, heartbeatIntervalMs: 20, executionLeaseMs: 90_000,
  proofCollector: () => [], emit: () => undefined,
  adapters: [{
    id: "codex", name: "Local fixture", capabilities: ["code"], detect: async () => true,
    run: async (request) => {
      if (request.metadata.phase === "execution_brief") {
        return { status: "complete", exitCode: 0, stdout: JSON.stringify({ purpose: "Write", approach: "Write", expectedOutcome: "File" }), stderr: "" };
      }
      mkdirSync(request.workspacePath, { recursive: true });
      const writer = spawn(process.execPath, ["-e", `const fs = require('node:fs'); setInterval(() => fs.appendFileSync(process.argv[1], 'x'), 20)`, join(request.workspacePath, "still-writing.txt")], {
        detached: true, stdio: "ignore",
      });
      writer.unref();
      process.send?.({ type: "writer-started", pid: writer.pid, path: request.workspacePath });
      return new Promise(() => undefined);
    },
  }],
});
