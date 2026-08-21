import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export type CompanyWorkspace = {
  companyRoot: string;
};

export type DepartmentWorkspace = {
  root: string;
  memoryPath: string;
  tasksDir: string;
  artifactsDir: string;
  proofDir: string;
  reviewsDir: string;
  logsDir: string;
};

export type TaskWorkspace = {
  root: string;
};

export type WorkspaceCleanupResult = {
  removedPaths: string[];
};

export type CleanupGeneratedWorkspaceInput = {
  projectRoot: string;
  workspacePath: string;
  generatedDirNames?: string[];
};

export function createCompanyWorkspace(projectRoot: string, companyId: string): CompanyWorkspace {
  assertWorkspaceId(companyId);

  const companyRoot = resolveWorkspacePath(projectRoot, `.auto-crop/companies/${companyId}`);
  mkdirSync(companyRoot, { recursive: true });

  return { companyRoot };
}

export function createDepartmentWorkspace(
  projectRoot: string,
  companyId: string,
  departmentId: string,
): DepartmentWorkspace {
  assertWorkspaceId(companyId);
  assertWorkspaceId(departmentId);

  const root = resolveWorkspacePath(
    projectRoot,
    `.auto-crop/companies/${companyId}/departments/${departmentId}`,
  );
  const workspace = {
    root,
    memoryPath: resolveWorkspacePath(projectRoot, `${root}/Memory.md`),
    tasksDir: resolveWorkspacePath(projectRoot, `${root}/tasks`),
    artifactsDir: resolveWorkspacePath(projectRoot, `${root}/artifacts`),
    proofDir: resolveWorkspacePath(projectRoot, `${root}/proof`),
    reviewsDir: resolveWorkspacePath(projectRoot, `${root}/reviews`),
    logsDir: resolveWorkspacePath(projectRoot, `${root}/logs`),
  };

  mkdirSync(workspace.tasksDir, { recursive: true });
  mkdirSync(workspace.artifactsDir, { recursive: true });
  mkdirSync(workspace.proofDir, { recursive: true });
  mkdirSync(workspace.reviewsDir, { recursive: true });
  mkdirSync(workspace.logsDir, { recursive: true });

  if (!existsSync(workspace.memoryPath)) {
    writeFileSync(workspace.memoryPath, `# ${toTitle(departmentId)} Memory\n\n`, "utf8");
  }

  return workspace;
}

export function createTaskWorkspace(projectRoot: string, taskId: string): TaskWorkspace {
  assertWorkspaceId(taskId);

  const root = resolveWorkspacePath(projectRoot, `.auto-crop/workspaces/${taskId}`);
  mkdirSync(root, { recursive: true });

  return { root };
}

export function resolveWorkspacePath(projectRoot: string, pathWithinProject: string): string {
  const normalizedRoot = resolve(projectRoot);
  const candidate = resolve(normalizedRoot, pathWithinProject);
  const relativePath = relative(normalizedRoot, candidate);

  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return candidate;
  }

  throw new Error(`Path resolves outside project root: ${pathWithinProject}`);
}

export function cleanupGeneratedWorkspaceArtifacts(
  input: CleanupGeneratedWorkspaceInput,
): WorkspaceCleanupResult {
  const workspacePath = resolveWorkspacePath(input.projectRoot, input.workspacePath);
  assertTaskWorkspacePath(input.projectRoot, workspacePath);

  if (!existsSync(workspacePath)) {
    return { removedPaths: [] };
  }

  const generatedDirNames = new Set(input.generatedDirNames ?? ["node_modules"]);
  const removedPaths: string[] = [];

  removeGeneratedDirs(workspacePath, generatedDirNames, removedPaths);

  return { removedPaths };
}

function assertWorkspaceId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid workspace id: ${id}`);
  }
}

function assertTaskWorkspacePath(projectRoot: string, workspacePath: string): void {
  const workspacesRoot = resolveWorkspacePath(projectRoot, ".auto-crop/workspaces");
  const relativePath = relative(workspacesRoot, workspacePath);

  if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
    return;
  }

  throw new Error(`Cleanup path is not a task workspace: ${workspacePath}`);
}

function removeGeneratedDirs(root: string, generatedDirNames: Set<string>, removedPaths: string[]): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);

    if (!entry.isDirectory()) {
      continue;
    }

    if (generatedDirNames.has(entry.name)) {
      rmSync(entryPath, { force: true, recursive: true });
      removedPaths.push(entryPath);
      continue;
    }

    removeGeneratedDirs(entryPath, generatedDirNames, removedPaths);
  }
}

function toTitle(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
