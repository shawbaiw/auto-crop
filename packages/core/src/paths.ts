export const AUTO_CROP_DIR = ".auto-crop";

export function companyRoot(companyId: string): string {
  return `${AUTO_CROP_DIR}/companies/${companyId}`;
}

export function departmentMemoryPath(companyId: string, departmentId: string): string {
  return `${companyRoot(companyId)}/departments/${departmentId}/Memory.md`;
}

export function taskWorkspacePath(taskId: string): string {
  return `${AUTO_CROP_DIR}/workspaces/${taskId}`;
}
