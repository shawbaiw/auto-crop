import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "../adapters/types";
import type { AgentCapabilityGrant } from "../policies/capabilityGrant";

/** One repair per delivery, on a budget sized for editing one file rather than redoing the work. */
export const ARTIFACT_SYNTAX_REPAIR_TIMEOUT_MS = 120_000;

const BUSINESS_ARTIFACT_PATH = join(".auto-crop", "business-artifact.json");

export type ArtifactSyntaxRepairOutcome =
  /** The file parsed after the repair run, and only quoting, escaping and layout changed. */
  | "repaired"
  /** The repair run finished, and the file still does not parse; the original file was put back. */
  | "still_invalid"
  /** The file parsed, but the run changed more than syntax; the original file was put back. */
  | "content_changed"
  /** The repair run itself did not complete; the original file was put back. */
  | "run_failed";

export type ArtifactSyntaxRepair = {
  outcome: ArtifactSyntaxRepairOutcome;
  /** The parse error that triggered the repair. */
  syntaxError: string;
  result: AgentRunResult;
};

/**
 * The parse error of the run's Business Artifact file, or null when there is no file or it parses.
 * Read from the file itself rather than from a capture's validation messages: whether a delivery is
 * syntactically broken is a fact about the file, not a phrase to match.
 */
export function readBusinessArtifactSyntaxError(workspacePath: string): string | null {
  const path = join(workspacePath, BUSINESS_ARTIFACT_PATH);
  if (!existsSync(path)) {
    return null;
  }
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * Give a delivery whose Business Artifact does not parse one narrow chance to fix its syntax.
 *
 * Prose in any language quotes phrases, and a bare ASCII quote inside a JSON string breaks the whole
 * file. The work was done; only its envelope is broken. Re-running the task would redo the work to
 * fix a character, and repairing the text in the runtime would be a guess about what the agent meant.
 * So the same agent edits the file, told exactly what failed to parse, holding only the workspace —
 * and the runtime checks the result instead of trusting it: the repaired file must parse, and must
 * carry the same content once quoting, escaping and layout are set aside. Anything else restores the
 * original file, so the capture that follows records the delivery as the agent actually left it.
 *
 * Returns null when the artifact parses or is absent: there is nothing to repair.
 */
export async function repairBusinessArtifactSyntax(input: {
  adapter: AgentAdapter;
  request: Omit<AgentRunRequest, "prompt" | "grant" | "timeoutMs" | "outputSchema">;
  grant: AgentCapabilityGrant;
}): Promise<ArtifactSyntaxRepair | null> {
  const workspacePath = input.request.workspacePath;
  const syntaxError = readBusinessArtifactSyntaxError(workspacePath);
  if (!syntaxError) {
    return null;
  }

  const path = join(workspacePath, BUSINESS_ARTIFACT_PATH);
  const original = readFileSync(path, "utf8");
  const result = await input.adapter.run({
    ...input.request,
    prompt: buildArtifactSyntaxRepairPrompt(syntaxError),
    grant: artifactSyntaxRepairGrant(input.grant),
    timeoutMs: ARTIFACT_SYNTAX_REPAIR_TIMEOUT_MS,
  });

  const outcome = judgeRepair(result, original, path);
  if (outcome !== "repaired") {
    writeFileSync(path, original, "utf8");
  }
  return { outcome, syntaxError, result };
}

function judgeRepair(result: AgentRunResult, original: string, path: string): ArtifactSyntaxRepairOutcome {
  if (result.status !== "complete") {
    return "run_failed";
  }
  if (!existsSync(path)) {
    return "still_invalid";
  }
  const repaired = readFileSync(path, "utf8");
  try {
    JSON.parse(repaired);
  } catch {
    return "still_invalid";
  }
  return preservesArtifactContent(original, repaired) ? "repaired" : "content_changed";
}

/**
 * The repair edits one file in the workspace, so it holds workspace access and nothing more, and never
 * more than the delivery's own grant.
 */
export function artifactSyntaxRepairGrant(grant: AgentCapabilityGrant): AgentCapabilityGrant {
  const granted = grant.granted.filter((capability): boolean => capability === "workspace_read" || capability === "workspace_write");
  const withheld = grant.granted.filter((capability) => !granted.includes(capability));
  return { granted, withheld: [...grant.withheld, ...withheld], id: granted.join("+") || "none" };
}

/**
 * Whether two versions of an artifact file say the same thing once syntax is set aside: whitespace,
 * JSON punctuation, every kind of quote mark, and backslash escapes. A syntax repair only ever touches
 * those — escaping a quote, swapping `"` for `「」`, adding a missing comma or brace — so any other
 * difference is a change of content the repair was not allowed to make.
 */
export function preservesArtifactContent(original: string, repaired: string): boolean {
  return contentSignature(original) === contentSignature(repaired);
}

function contentSignature(text: string): string {
  return text.replace(/\\[nrtbf"\\/]/g, "").replace(/[\s,:{}[\]"'“”‘’「」『』\\]/g, "");
}

function buildArtifactSyntaxRepairPrompt(syntaxError: string): string {
  return [
    "## Repair the Business Artifact syntax",
    "",
    `\`${BUSINESS_ARTIFACT_PATH}\` in this workspace is not valid JSON. Parsing it fails with:`,
    "",
    `    ${syntaxError}`,
    "",
    "Edit that file so it parses as JSON. Change syntax only:",
    "- A double quote inside a string value must be escaped as `\\\"`, or replaced with a quotation mark that is not ASCII, such as `「」` or `“”`.",
    "- Fix any missing or extra comma, bracket or brace, and escape any raw line break inside a string as `\\n`.",
    "- Do not change, add or remove any content: every key, value and sentence stays as it is.",
    "- Do not create or edit any other file.",
    "",
    "The runtime compares the repaired file with the original, and discards a repair that changed content.",
  ].join("\n");
}
