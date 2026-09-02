import { describe, expect, it } from "vitest";
import { buildProofContractInstructions } from "./proofContract";

describe("buildProofContractInstructions", () => {
  it("names the runtime-collected diff locations for repo-diff tasks", () => {
    const text = buildProofContractInstructions({ id: "task_1", proofSchemaId: "repo-diff" }).join("\n");
    expect(text).toContain(".auto-crop-proof/task_1.diff");
  });

  it("teaches the environment-blocked escape hatch for screenshot tasks", () => {
    const text = buildProofContractInstructions({ id: "task_1", proofSchemaId: "screenshot" }).join("\n");
    // The agent has no way to guess the shape the runtime verifier expects unless the prompt says so.
    expect(text).toContain("payload.blocker_class");
    expect(text).toContain("environment_blocked");
    expect(text).toContain("browser_screenshot");
    expect(text).toContain("payload.target_url");
  });
});
