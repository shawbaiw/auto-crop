// Installed only on the isolated smoke PATH. The production adapter launches this local process.
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
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
        fs.mkdirSync(path.join(process.cwd(), ".auto-crop"), { recursive: true });
        fs.writeFileSync(path.join(process.cwd(), ".auto-crop/business-artifact.json"), JSON.stringify({
          artifact_kind: "deliverable", artifact_role: "implementation", artifact_subtype: "prototype_implementation", task_type: "engineering.prototype_implementation",
          payload: { summary: "Local prototype validated.", execution_report: { work_summary: "Implemented local fixture.", evidence: "Local test passed.", conclusion: "Prototype ready.", vision_impact: "Advances build milestone.", remaining_gap: "Real user validation.", recommendation: "Review the proof." },
            outcome_summary: "Prototype ready, local test passed. Real user validation remains.", recommendation: "Review proof.", evidence: ["Local test passed"], risks: [], next_steps: ["CEO review"] }, lineage: { task_id: "task_1" }
        }));
        console.log("Local validation passed.");
      }, 350);
    } else setInterval(() => fs.appendFileSync(writer, "x"), 20);
  }
}
