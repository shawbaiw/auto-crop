import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  createApiServer,
  createClaudeCodeAdapter,
  createCodexAdapter,
  createDatabaseClient,
  createRepositories,
  migrate,
  type AgentAdapter,
} from "@auto-crop/server";

export type StartAutoCropOptions = {
  projectRoot: string;
  host?: string;
  port?: number;
  agents?: AgentAdapter[];
  log?: (line: string) => void;
};

export type StartedAutoCrop = {
  url: string;
  close(): Promise<void>;
};

export async function startAutoCrop(options: StartAutoCropOptions): Promise<StartedAutoCrop> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const log = options.log ?? console.log;
  const stateDir = join(options.projectRoot, ".auto-crop");
  mkdirSync(stateDir, { recursive: true });

  const database = createDatabaseClient(join(stateDir, "state.sqlite"));
  migrate(database);
  const repositories = createRepositories(database);
  const agents = options.agents ?? [createClaudeCodeAdapter(), createCodexAdapter()];

  for (const agent of agents) {
    const detected = await agent.detect();
    log(`Agent ${agent.name}: ${detected ? "available" : "unavailable"}`);
  }

  const apiServer = createApiServer({
    projectRoot: options.projectRoot,
    repositories,
    agents,
  });

  await new Promise<void>((resolve) => {
    apiServer.httpServer.listen(port, host, resolve);
  });

  const address = apiServer.httpServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Unable to determine local server address.");
  }

  const url = `http://${host}:${(address as AddressInfo).port}`;
  log(`Dashboard: ${url}`);

  return {
    url,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        apiServer.httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      database.close();
    },
  };
}
