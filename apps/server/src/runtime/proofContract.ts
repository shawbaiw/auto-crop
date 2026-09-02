import type { Task } from "@auto-crop/core";

/**
 * The proof-contract section of an agent prompt: exactly where the runtime will look for Proof
 * that satisfies the task's proof schema. Shared by the scheduler and the recovery follow-up
 * prompts so both describe the same runtime-collected locations.
 */
export function buildProofContractInstructions(task: Pick<Task, "id" | "proofSchemaId">): string[] {
  const instructions = ["## Proof Contract", "", `Original Proof Schema: ${task.proofSchemaId}`];

  if (task.proofSchemaId === "repo-diff") {
    return [
      ...instructions,
      "Before finishing, leave registerable diff proof in one of these runtime-collected locations:",
      `- .auto-crop-proof/${task.id}.diff`,
      "- a top-level workspace `.diff` or `.patch` file",
      "Files under `.auto-crop/` are not proof for repo-diff tasks.",
      "Do not rely on `.auto-crop/business-artifact.json` alone; it is a business artifact, not diff proof.",
    ];
  }

  if (task.proofSchemaId === "landing-page-file") {
    return [
      ...instructions,
      "Before finishing, leave runnable prototype files directly in the task workspace, such as index.html, src/main.tsx, src/App.tsx, app/page.tsx, or package.json.",
    ];
  }

  if (task.proofSchemaId === "product-brief") {
    return [...instructions, "Before finishing, leave a product-brief.md file in the task workspace."];
  }

  if (task.proofSchemaId === "research-report") {
    return [...instructions, "Before finishing, leave a research-report.md file in the task workspace."];
  }

  if (task.proofSchemaId === "screenshot") {
    return [
      ...instructions,
      "A real screenshot PNG saved in the task workspace is the proof. Capture the running result and save it.",
      "If every browser and screenshot path is blocked by the sandbox, do not fabricate a screenshot. Instead write `.auto-crop/business-artifact.json` as a `blocker` with `payload.blocker_class: \"environment_blocked\"`, `payload.capability: \"browser_screenshot\"`, and `payload.target_url` set to the running prototype URL the runtime can fetch.",
      "On a 2xx response from that URL the runtime accepts the task with a validation-limits caveat instead of failing it.",
    ];
  }

  if (task.proofSchemaId === "test-output") {
    return [
      ...instructions,
      "Before finishing, run the relevant validation command and make sure the command output appears in stdout.",
      "Command output in stdout is the proof for this task. Visual confirmation such as a screenshot is optional and is never required.",
      "Do not install browser binaries and do not start more than one browser process; a single command or fetch check is enough.",
    ];
  }

  return [...instructions, "Before finishing, leave proof that matches the original proof schema."];
}
