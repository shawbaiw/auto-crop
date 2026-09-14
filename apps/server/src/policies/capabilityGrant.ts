import type { Task } from "@auto-crop/core";
import { decideAction, type ActionPolicy, type ActionType } from "./policy";

/**
 * What a process is *permitted to do* during one Agent Run.
 *
 * Not to be confused with `AgentCapability` (`code`, `frontend`, `research`, …), which describes what
 * an adapter is *good at* and selects which agent runs a task. The two vocabularies answer different
 * questions and a shared word would collapse them. See ADR 0021.
 */
export const runtimeCapabilities = [
  "workspace_read",
  "workspace_write",
  "run_command",
  "web_research",
] as const;

export type RuntimeCapability = (typeof runtimeCapabilities)[number];

/**
 * The capabilities one Agent Run holds, and the ones it asked for and was refused.
 *
 * `withheld` is not bookkeeping: the prompt names it, so an agent that cannot do the work knows which
 * capability to report missing instead of inventing an explanation for a denial it met mid-run.
 */
export type AgentCapabilityGrant = {
  granted: RuntimeCapability[];
  withheld: RuntimeCapability[];
  /** Stable identity for the granted set. Two runs with different grants must not share a session. */
  id: string;
};

/**
 * Which Action Policy decision gates each Runtime Capability. Exhaustive over the union, so a
 * capability added later cannot reach an agent without stating which policy decision allows it.
 */
const capabilityGate: Record<RuntimeCapability, ActionType> = {
  workspace_read: "read_workspace",
  workspace_write: "write_workspace",
  run_command: "run_safe_command",
  web_research: "read_public_web",
};

const alwaysNeeded: RuntimeCapability[] = ["workspace_read", "workspace_write"];

const webResearchAgentCapabilities = new Set(["research"]);
/**
 * Only the schema that is definitionally research. `product-brief` is deliberately absent: a brief
 * synthesizing accepted upstream handoffs needs no web, and granting it one on schema alone would
 * put every brief over the `short` execution budget for a capability most of them never use. A brief
 * that does need the web says so by declaring the `research` capability.
 */
const webResearchProofSchemas = new Set(["research-report"]);
const runCommandAgentCapabilities = new Set(["code", "frontend", "test", "refactor"]);
const runCommandProofSchemas = new Set(["repo-diff", "test-output", "landing-page-file"]);

/**
 * What this task needs to be doable, derived from the shape of its deliverable.
 *
 * Both signals are consulted rather than one: `requiredCapabilities` is authored by the CEO Agent and
 * `proofSchemaId` is drawn from a fixed set, so a planner that names the work but forgets the
 * capability (or the reverse) still gets a usable grant.
 */
export function resolveTaskCapabilityNeeds(
  task: Pick<Task, "proofSchemaId" | "requiredCapabilities">,
): RuntimeCapability[] {
  const needs = new Set<RuntimeCapability>(alwaysNeeded);
  const capabilities = task.requiredCapabilities ?? [];

  if (
    capabilities.some((capability) => webResearchAgentCapabilities.has(capability)) ||
    webResearchProofSchemas.has(task.proofSchemaId)
  ) {
    needs.add("web_research");
  }

  if (
    capabilities.some((capability) => runCommandAgentCapabilities.has(capability)) ||
    runCommandProofSchemas.has(task.proofSchemaId)
  ) {
    needs.add("run_command");
  }

  return sortCapabilities([...needs]);
}

/**
 * What a CEO blueprint or replan planner run needs. These are not tasks and have no proof schema, so
 * they cannot go through {@link resolveTaskCapabilityNeeds}. Planning reads the world and writes a
 * plan; it does not run the operated project's code.
 */
export const planningCapabilityNeeds: RuntimeCapability[] = sortCapabilities([
  ...alwaysNeeded,
  "web_research",
]);

/**
 * The grant for a run that only reasons and returns JSON, such as an Execution Brief.
 *
 * Such a run is already told not to use tools; holding none makes that a property of the launch
 * rather than an instruction the model may read past.
 */
export const noToolGrant: AgentCapabilityGrant = { granted: [], withheld: [], id: "none" };

/**
 * Intersect what the run needs with what the company's Permission Mode allows.
 *
 * An `ask` decision grants. `ask` means "a person must consent before this runs", and the scheduler
 * already collects that consent once, before dispatch, for the whole task — see
 * {@link grantNeedsFounderApproval}. Re-reading it here as a denial would park every `safe`-mode task
 * on a capability it had already been approved for. Only `deny` withholds.
 */
export function resolveAgentCapabilityGrant(input: {
  needs: RuntimeCapability[];
  policy: ActionPolicy;
}): AgentCapabilityGrant {
  const granted: RuntimeCapability[] = [];
  const withheld: RuntimeCapability[] = [];

  for (const capability of sortCapabilities(input.needs)) {
    if (decideAction(input.policy, capabilityGate[capability]) === "deny") {
      withheld.push(capability);
    } else {
      granted.push(capability);
    }
  }

  return { granted, withheld, id: granted.join("+") || "none" };
}

/**
 * Whether a run needs Founder Approval before dispatch: any capability it needs carries an `ask`
 * decision under the company's policy.
 *
 * This replaces a hardcoded `run_safe_command` proxy that asked the same question for every task
 * regardless of what the task did. The granularity is still deliberately coarse — one pre-dispatch
 * question for the whole run, not per action — but it is now derived from what the run will actually
 * be handed.
 */
export function grantNeedsFounderApproval(input: {
  needs: RuntimeCapability[];
  policy: ActionPolicy;
}): boolean {
  return input.needs.some((capability) => decideAction(input.policy, capabilityGate[capability]) === "ask");
}

const capabilityDescriptions: Record<RuntimeCapability, string> = {
  workspace_read: "read files inside this workspace",
  workspace_write: "create and edit files inside this workspace",
  run_command: "run shell commands",
  web_research: "search the public web and fetch pages (WebSearch, WebFetch)",
};

export function describeRuntimeCapability(capability: RuntimeCapability): string {
  return `${capability} — ${capabilityDescriptions[capability]}`;
}

function sortCapabilities(capabilities: RuntimeCapability[]): RuntimeCapability[] {
  const order = new Map(runtimeCapabilities.map((capability, index) => [capability, index]));
  return [...new Set(capabilities)].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
}
