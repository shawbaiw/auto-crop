import {
  actionIntentCategories,
  actionIntentStatuses,
  type ActionIntent,
  type ActionIntentCategory,
  type ActionIntentStatus,
} from "@auto-crop/core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CATEGORIES = new Set<string>(actionIntentCategories);
const STATUSES = new Set<string>(actionIntentStatuses);

export type ParsedActionIntents = {
  /** Whether the payload declares actions at all. An artifact written before this contract does not. */
  declared: boolean;
  actions: ActionIntent[];
  errors: string[];
};

/**
 * Read `payload.actions`, the delivery's Action Intent declaration.
 *
 * An empty array is a declaration — "this run took no external or sensitive action" — and is the normal
 * case. Absent is not: artifacts written before this contract have nothing to read, and the caller falls
 * back to the old text scan for them rather than reading silence as a claim (ADR 0027).
 */
export function parseActionIntents(payload: unknown): ParsedActionIntents {
  const value = isRecord(payload) ? payload.actions ?? payload.action_intents : undefined;
  if (value === undefined) {
    return { declared: false, actions: [], errors: [] };
  }
  if (!Array.isArray(value)) {
    return { declared: true, actions: [], errors: ["payload.actions: Expected an array (use [] when this run took no such action)."] };
  }

  const errors: string[] = [];
  const actions: ActionIntent[] = [];
  value.forEach((entry, index) => {
    const category = isRecord(entry) ? entry.category : undefined;
    const status = isRecord(entry) ? entry.status : undefined;
    const description = isRecord(entry) && typeof entry.description === "string" ? entry.description.trim() : "";
    const target = isRecord(entry) ? entry.target : undefined;
    if (typeof category !== "string" || !CATEGORIES.has(category)) {
      errors.push(`payload.actions[${index}].category: Expected one of ${actionIntentCategories.join(", ")}.`);
      return;
    }
    if (typeof status !== "string" || !STATUSES.has(status)) {
      errors.push(`payload.actions[${index}].status: Expected one of ${actionIntentStatuses.join(", ")}.`);
      return;
    }
    if (!description) {
      errors.push(`payload.actions[${index}].description: Expected a non-empty string.`);
      return;
    }
    if (target !== undefined && target !== null && typeof target !== "string") {
      errors.push(`payload.actions[${index}].target: Expected a string when present.`);
      return;
    }
    actions.push({
      category: category as ActionIntentCategory,
      status: status as ActionIntentStatus,
      description,
      ...(typeof target === "string" ? { target } : {}),
    });
  });

  return { declared: true, actions, errors };
}
