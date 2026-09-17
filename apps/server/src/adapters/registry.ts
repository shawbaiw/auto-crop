import type { AdapterLaunchSupport } from "./launchPolicy";
import type { AgentAdapter } from "./types";

export type AgentRegistry = {
  list(): AgentAdapter[];
  selectByCapabilities(requiredCapabilities: string[]): Promise<AgentAdapter>;
};

export function createAgentRegistry(adapters: AgentAdapter[]): AgentRegistry {
  return {
    list(): AgentAdapter[] {
      return [...adapters];
    },

    async selectByCapabilities(requiredCapabilities: string[]): Promise<AgentAdapter> {
      for (const adapter of adapters) {
        if (!hasCapabilities(adapter, requiredCapabilities)) {
          continue;
        }

        if (await adapter.detect()) {
          return adapter;
        }
      }

      throw new Error(
        `No agent adapter detected with required capabilities: ${requiredCapabilities.join(", ")}`,
      );
    },
  };
}

function hasCapabilities(adapter: AgentAdapter, requiredCapabilities: string[]): boolean {
  const available = new Set(adapter.capabilities);
  return requiredCapabilities.every((capability) => available.has(capability));
}

export type AdapterLaunchResolution =
  | { launchable: true; adapter: AgentAdapter; support: AdapterLaunchSupport | null }
  | { launchable: false; unavailable: AdapterLaunchSupport[] };

/**
 * The first of `candidates` whose launch support is not `unavailable`. An adapter without a launch
 * plan makes no isolation claim and is launchable with no warnings. Dispatch goes through this so a
 * task is never handed to an installed CLI that cannot run Auto-Crop's launch shape.
 */
export async function resolveLaunchableAdapter(candidates: AgentAdapter[]): Promise<AdapterLaunchResolution> {
  const unavailable: AdapterLaunchSupport[] = [];
  for (const adapter of candidates) {
    const support = adapter.launchPlan ? (await adapter.launchPlan()).support : null;
    if (support?.isolationLevel === "unavailable") {
      unavailable.push(support);
      continue;
    }
    return { launchable: true, adapter, support };
  }
  return { launchable: false, unavailable };
}
