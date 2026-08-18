import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

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
  artifactsDir: string;
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
  const artifactsDir = resolveWorkspacePath(projectRoot, `${root}/artifacts`);
  mkdirSync(root, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });

  return { root, artifactsDir };
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

function assertWorkspaceId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid workspace id: ${id}`);
  }
}

function toTitle(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
