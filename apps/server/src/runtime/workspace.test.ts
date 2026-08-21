import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCompanyWorkspace,
  createDepartmentWorkspace,
  createTaskWorkspace,
  cleanupGeneratedWorkspaceArtifacts,
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

  it("removes generated dependency directories from task workspaces only", () => {
    const projectRoot = createTempProjectRoot();
    const workspace = createTaskWorkspace(projectRoot, "task_1");
    const sourcePath = join(workspace.root, "src", "App.tsx");
    const handoffPath = join(workspace.root, ".auto-crop-handoff", "package.json");
    const rootDependencyPath = join(workspace.root, "node_modules", "vite", "index.js");
    const nestedDependencyPath = join(workspace.root, "app", "node_modules", "react", "index.js");
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    mkdirSync(join(workspace.root, ".auto-crop-handoff"), { recursive: true });
    mkdirSync(join(workspace.root, "node_modules", "vite"), { recursive: true });
    mkdirSync(join(workspace.root, "app", "node_modules", "react"), { recursive: true });
    writeFileSync(sourcePath, "export default function App() { return null; }\n", "utf8");
    writeFileSync(handoffPath, "{}\n", "utf8");
    writeFileSync(rootDependencyPath, "module.exports = {}\n", "utf8");
    writeFileSync(nestedDependencyPath, "module.exports = {}\n", "utf8");

    const result = cleanupGeneratedWorkspaceArtifacts({ projectRoot, workspacePath: workspace.root });

    expect(result.removedPaths).toEqual([
      join(workspace.root, "app", "node_modules"),
      join(workspace.root, "node_modules"),
    ]);
    expect(existsSync(join(workspace.root, "node_modules"))).toBe(false);
    expect(existsSync(join(workspace.root, "app", "node_modules"))).toBe(false);
    expect(readFileSync(sourcePath, "utf8")).toContain("App");
    expect(readFileSync(handoffPath, "utf8")).toBe("{}\n");
  });

  it("rejects cleanup outside managed task workspaces", () => {
    const projectRoot = createTempProjectRoot();

    expect(() =>
      cleanupGeneratedWorkspaceArtifacts({
        projectRoot,
        workspacePath: join(projectRoot, ".auto-crop", "companies", "company_1"),
      }),
    ).toThrow(/not a task workspace/i);
    expect(() =>
      cleanupGeneratedWorkspaceArtifacts({
        projectRoot,
        workspacePath: join(tmpdir(), "outside-task"),
      }),
    ).toThrow(/outside project root/i);
  });
});

function createTempProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "auto-crop-workspace-"));
  createdDirs.push(dir);
  return dir;
}
