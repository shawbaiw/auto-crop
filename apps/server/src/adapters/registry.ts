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
