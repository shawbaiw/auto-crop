/**
 * Action Intent — what a delivery says it *did* or *asks to do*, as structure rather than prose.
 *
 * Automatic Acceptance used to decide by scanning the whole artifact payload for risk phrases. Describing
 * a risk reads exactly like requesting one: an SEO company's reports mention Search Console in their
 * remaining gaps and next steps, so every one of them was routed to manual CEO review, and a report that
 * happened to avoid the words could have taken a real external action unnoticed. The words were never the
 * question — whether this run performed an external or sensitive action, or wants approval to perform one
 * now, is (ADR 0027).
 */

/** Kinds of action that need a founder's eye when performed or requested. */
export const actionIntentCategories = [
  "external_publication",
  "deployment",
  "domain_or_dns",
  "search_engine_submission",
  "advertising_or_affiliate",
  "payment_or_billing",
  "credentials_or_access",
  "personal_data",
  "legal_or_compliance",
  "irreversible_change",
] as const;

export type ActionIntentCategory = (typeof actionIntentCategories)[number];

/**
 * - `performed` — this run carried the action out.
 * - `requested` — the work is blocked until someone approves and performs it now.
 * - `considered` — named as a future step, a limitation, or something deliberately not done. It is a
 *   statement about the plan, not an action, and never asks anyone for a decision.
 */
export const actionIntentStatuses = ["performed", "requested", "considered"] as const;

export type ActionIntentStatus = (typeof actionIntentStatuses)[number];

export type ActionIntent = {
  category: ActionIntentCategory;
  status: ActionIntentStatus;
  /** What the action is, in the company's language. */
  description: string;
  /** What it acts on — a URL, an account, a service — when there is one. */
  target?: string | null;
};

/** Whether a declaration puts a real action in front of the founder: something done, or asked for now. */
export function hasOversightBearingAction(actions: readonly ActionIntent[]): boolean {
  return actions.some((action) => action.status === "performed" || action.status === "requested");
}
