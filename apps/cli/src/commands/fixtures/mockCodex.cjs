// Installed only on the isolated smoke PATH. The production adapter launches this local process.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);

/**
 * Delivers as Codex does: start the MCP server the launch named in its `-c mcp_servers.*` overrides
 * and call its `submit_artifact_envelope` tool. Values are TOML; the adapter writes JSON-compatible ones.
 */
function submitArtifactEnvelope(envelope) {
  const server = {};
  args.forEach((arg, index) => {
    const match = args[index - 1] === "-c" && /^mcp_servers\.auto-crop-runtime-actions\.(command|args|env)=(.*)$/s.exec(arg);
    if (!match) return;
    const [, key, value] = match;
    server[key] = key === "env"
      ? Object.fromEntries([...value.matchAll(/(\w+)=("(?:[^"\\]|\\.)*")/g)].map(([, name, quoted]) => [name, JSON.parse(quoted)]))
      : JSON.parse(value);
  });
  if (!server.command) throw new Error("The launch named no runtime action server");
  const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "submit_artifact_envelope", arguments: envelope } };
  const result = spawnSync(server.command, server.args, { env: { ...process.env, ...server.env }, input: `${JSON.stringify(call)}\n`, encoding: "utf8" });
  if (!JSON.parse(result.stdout).result?.structuredContent?.ok) throw new Error(`Delivery rejected: ${result.stdout}${result.stderr}`);
}
if (args.includes("--help")) {
  console.log(["-m", "-C", "-c", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--sandbox", "--ephemeral"].join("\n"));
} else {
  const schemaIndex = args.indexOf("--output-schema");
  const schema = schemaIndex < 0 ? null : JSON.parse(fs.readFileSync(args[schemaIndex + 1], "utf8"));
  if (schema?.properties?.purpose) {
    console.log(JSON.stringify({ purpose: "Write a local fixture", approach: "Append bytes", expectedOutcome: "A growing file" }));
  } else if (args.at(-1)?.startsWith("# Final Founder Report")) {
    console.log(JSON.stringify({ classification: "stalled", sections: { vision: "Fixture", actualResult: "Interrupted", departmentContributions: ["Engineering interrupted"], goalFit: "Pending", remainingGaps: "Unfinished", recommendedNextStep: "Confirm termination" } }));
  } else {
    if (path.basename(process.cwd()) !== "task_1") throw new Error("Unexpected smoke invocation");
    const root = process.env.AUTO_CROP_SMOKE_ROOT;
    if (!root) throw new Error("This fixture requires an isolated smoke root");
    const writer = path.join(process.cwd(), "still-writing.txt");
    const receipt = path.join(root, "writer.json");
    fs.writeFileSync(`${receipt}.tmp`, JSON.stringify({ pid: process.pid, workspace: process.cwd(), writer }));
    fs.renameSync(`${receipt}.tmp`, receipt);
    if (process.env.AUTO_CROP_SMOKE_SCENARIO === "budget-success") {
      setTimeout(() => {
        submitArtifactEnvelope({
          artifact_kind: "deliverable", artifact_role: "implementation", artifact_subtype: "prototype_implementation", task_type: "engineering.prototype_implementation",
          payload: { summary: "Local prototype validated.", execution_report: { work_summary: "Implemented local fixture.", evidence: "Local test passed.", conclusion: "Prototype ready.", vision_impact: "Advances build milestone.", remaining_gap: "Real user validation.", recommendation: "Review the proof." },
            outcome_summary: "Prototype ready, local test passed. Real user validation remains.", recommendation: "Review proof.", evidence: ["Local test passed"], risks: [], next_steps: ["CEO review"] }, lineage: { task_id: "task_1" }
        });
        console.log("Local validation passed.");
      }, 350);
    } else setInterval(() => fs.appendFileSync(writer, "x"), 20);
  }
}
