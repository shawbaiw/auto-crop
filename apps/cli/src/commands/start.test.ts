import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockAgentAdapter } from "@auto-crop/server";
import { startAutoCrop } from "./start";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("startAutoCrop", () => {
  it("starts the local API server, prints the dashboard URL, and detects configured agents", async () => {
    const projectRoot = createTempProjectRoot();
    const logs: string[] = [];

    const started = await startAutoCrop({
      projectRoot,
      host: "127.0.0.1",
      port: 0,
      agents: [
        createMockAgentAdapter({
          id: "claude-code",
          name: "Claude Code",
          capabilities: ["writing", "research"],
          detected: false,
        }),
        createMockAgentAdapter({
          id: "codex",
          name: "Codex",
          capabilities: ["code", "frontend"],
          detected: true,
        }),
      ],
      log: (line) => logs.push(line),
    });

    try {
      expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(logs).toContain(`Dashboard: ${started.url}`);
      expect(logs).toContain("Agent Claude Code: unavailable");
      expect(logs).toContain("Agent Codex: available");

      const response = await fetch(`${started.url}/api/agents`);
      const body = (await response.json()) as { agents: Array<{ id: string; detected: boolean }> };
      expect(response.ok).toBe(true);
      expect(body.agents).toContainEqual({
        id: "codex",
        name: "Codex",
        capabilities: ["code", "frontend"],
        detected: true,
      });
    } finally {
      await started.close();
    }
  });
});

function createTempProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "auto-crop-cli-"));
  createdDirs.push(dir);
  return dir;
}
