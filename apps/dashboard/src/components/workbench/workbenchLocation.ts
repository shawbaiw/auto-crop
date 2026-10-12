/** Where the founder is in the Workbench (dashboard ADR 0002). */
export type WorkbenchLocation =
  | { page: "ceo-office" }
  | { page: "department"; departmentId: string }
  | { page: "operations" }
  | { page: "deliverables" }
  | { page: "settings" };

export const ceoOfficeLocation: WorkbenchLocation = { page: "ceo-office" };

export function sameLocation(a: WorkbenchLocation, b: WorkbenchLocation): boolean {
  return serializeLocation(a) === serializeLocation(b);
}

export function serializeLocation(location: WorkbenchLocation): string {
  return location.page === "department" ? `department:${location.departmentId}` : location.page;
}

/**
 * Reads a stored location. Values written before the Workbench name the legacy pages, which map to
 * where their content now lives.
 */
export function parseLocation(value: string | null): WorkbenchLocation | null {
  if (!value) return null;
  if (value.startsWith("department:")) {
    const departmentId = value.slice("department:".length);
    return departmentId ? { page: "department", departmentId } : null;
  }
  switch (value) {
    case "ceo-office":
    case "department-workspace":
    case "dashboard":
      return ceoOfficeLocation;
    case "operations":
    case "deliverables":
    case "settings":
      return { page: value };
    default:
      return null;
  }
}
