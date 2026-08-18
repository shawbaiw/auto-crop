import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCompanyWorkspace,
  createDepartmentWorkspace,
  createTaskWorkspace,
  resolveWorkspacePath,
} from "./workspace";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("workspace layout", () => {
  it("creates the company root under .auto-crop/companies/<companyId>", () => {
    const projectRoot = createTempProjectRoot();

    const workspace = createCompanyWorkspace(projectRoot, "company_1");

    expect(workspace.companyRoot).toBe(join(projectRoot, ".auto-crop", "companies", "company_1"));
    expect(existsSync(workspace.companyRoot)).toBe(true);
  });

  it("creates department memory and runtime directories", () => {
    const projectRoot = createTempProjectRoot();

    const workspace = createDepartmentWorkspace(projectRoot, "company_1", "engineering");

    expect(existsSync(workspace.root)).toBe(true);
    expect(existsSync(workspace.tasksDir)).toBe(true);
    expect(existsSync(workspace.artifactsDir)).toBe(true);
    expect(existsSync(workspace.proofDir)).toBe(true);
    expect(existsSync(workspace.reviewsDir)).toBe(true);
    expect(existsSync(workspace.logsDir)).toBe(true);
    expect(readFileSync(workspace.memoryPath, "utf8")).toContain("# Engineering Memory");
  });

  it("creates task workspaces under .auto-crop/workspaces/<taskId>", () => {
    const projectRoot = createTempProjectRoot();

    const workspace = createTaskWorkspace(projectRoot, "task_1");

    expect(workspace.root).toBe(join(projectRoot, ".auto-crop", "workspaces", "task_1"));
    expect(existsSync(workspace.root)).toBe(true);
  });

  it("rejects ids that would escape the project root", () => {
    const projectRoot = createTempProjectRoot();

    expect(() => createCompanyWorkspace(projectRoot, "../outside")).toThrow(/invalid workspace id/i);
    expect(() => createDepartmentWorkspace(projectRoot, "company_1", "../outside")).toThrow(
      /invalid workspace id/i,
    );
    expect(() => createTaskWorkspace(projectRoot, "../outside")).toThrow(/invalid workspace id/i);
  });

  it("rejects resolved paths outside the project root", () => {
    const projectRoot = createTempProjectRoot();

    expect(() => resolveWorkspacePath(projectRoot, "../outside")).toThrow(/outside project root/i);
  });
});

function createTempProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "auto-crop-workspace-"));
  createdDirs.push(dir);
  return dir;
}
