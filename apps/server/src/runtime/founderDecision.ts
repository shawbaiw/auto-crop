import {
  resolveMaybeLocalized,
  strategicDecisionKindSchema,
  type FounderDecisionOption,
  type Locale,
  type StrategicDecisionKind,
} from "@auto-crop/core";

/**
 * A well-formed `open_decisions` entry, normalized: the completing agent's declared open choice on a
 * Strategic Decision Kind. Produced by {@link parseOpenDecisions} for entries that are kept (known
 * `decisionKind`, more than one option, all required fields present and well-shaped).
 *
 * `recommendation`, `rationale`, `briefing`, and each option's `label` / `tradeoffs` are stored as
 * the company-locale plain string: the agent authors them in the company's canonical locale
 * (ADR 0013 → single canonical locale), and a bare string or an `{ en, zh }` object are both
 * accepted and collapsed to that locale's value.
 */
export type FounderDecisionDeclaration = {
  decisionKind: StrategicDecisionKind;
  options: FounderDecisionOption[];
  recommendation: string;
  rationale: string;
  /**
   * What the founder needs to decide from the Decision card alone: what was explored, where the
   * opportunity is, what is differentiated, the monetization angle and why.
   */
  briefing: string;
};

/**
 * Read the completing agent's `open_decisions` array out of a Business Artifact payload.
 *
 * Contract (ADR 0017, amended 2026-09-09): each entry declares `{ decisionKind, options,
 * recommendation, rationale, briefing }`.
 * - An entry whose `decisionKind` is in the {@link StrategicDecisionKind} enum and that carries more
 *   than one well-formed option is **kept** and returned in `kept`.
 * - An entry whose `decisionKind` is not a recognized kind (or is missing / not a string) is
 *   **dropped silently** — that choice is the agent's own call.
 * - An entry on a recognized `decisionKind` that is otherwise malformed (too few options, an option
 *   missing its label or trade-offs, a `recommendation` that names no option, a missing `rationale`,
 *   a missing `briefing`) is a **structural validation failure**: its error strings are returned in
 *   `errors`, exactly like any other missing-required-field failure. The runtime does not judge the
 *   choice's meaning.
 *
 * `locale` is the company's canonical content locale: it is the key a localized-object field is
 * collapsed on.
 *
 * `open_decisions` is optional; an absent field yields `{ kept: [], errors: [] }`.
 */
export function parseOpenDecisions(payload: unknown, locale: Locale): {
  kept: FounderDecisionDeclaration[];
  errors: string[];
} {
  if (!isRecord(payload)) {
    return { kept: [], errors: [] };
  }

  const raw = payload.open_decisions ?? payload.openDecisions;
  if (raw === undefined || raw === null) {
    return { kept: [], errors: [] };
  }
  if (!Array.isArray(raw)) {
    return { kept: [], errors: ["payload.open_decisions: Expected an array."] };
  }

  const kept: FounderDecisionDeclaration[] = [];
  const errors: string[] = [];

  raw.forEach((entry, index) => {
    const decisionKind = strategicDecisionKindSchema.safeParse(
      isRecord(entry) ? entry.decisionKind ?? entry.decision_kind : undefined,
    );
    if (!decisionKind.success) {
      // Unknown / missing decisionKind: the agent's own tactical call, dropped without error.
      return;
    }

    const parsed = parseKnownEntry(entry as Record<string, unknown>, decisionKind.data, index, locale);
    if (parsed.kind === "kept") {
      kept.push(parsed.declaration);
    } else {
      errors.push(...parsed.errors);
    }
  });

  return { kept, errors };
}

function parseKnownEntry(
  entry: Record<string, unknown>,
  decisionKind: StrategicDecisionKind,
  index: number,
  locale: Locale,
):
  | { kind: "kept"; declaration: FounderDecisionDeclaration }
  | { kind: "invalid"; errors: string[] } {
  const prefix = `payload.open_decisions[${index}]`;
  const errors: string[] = [];

  const rawOptions = entry.options;
  const options: { label: string; tradeoffs: string }[] = [];
  if (!Array.isArray(rawOptions) || rawOptions.length < 2) {
    errors.push(`${prefix}.options: Expected more than one option, each with a label and its trade-offs.`);
  } else {
    rawOptions.forEach((option, optionIndex) => {
      if (!isRecord(option)) {
        errors.push(`${prefix}.options[${optionIndex}]: Expected an object with a label and its trade-offs.`);
        return;
      }
      const label = resolveMaybeLocalized(option.label, locale);
      const tradeoffs = resolveMaybeLocalized(option.tradeoffs ?? option.trade_offs, locale);
      if (!label) {
        errors.push(`${prefix}.options[${optionIndex}].label: Expected a non-empty string.`);
      }
      if (!tradeoffs) {
        errors.push(`${prefix}.options[${optionIndex}].tradeoffs: Expected a non-empty string.`);
      }
      if (label && tradeoffs) {
        options.push({ label, tradeoffs });
      }
    });
  }

  const recommendation = requireField(entry.recommendation, `${prefix}.recommendation`, locale, errors, {
    hint: "naming one of the options",
  });
  if (recommendation && options.length > 0 && !options.some((option) => option.label === recommendation)) {
    errors.push(`${prefix}.recommendation: Must name one of the declared options.`);
  }

  const rationale = requireField(entry.rationale, `${prefix}.rationale`, locale, errors);
  const briefing = requireField(entry.briefing, `${prefix}.briefing`, locale, errors);

  if (errors.length > 0) {
    return { kind: "invalid", errors };
  }

  return {
    kind: "kept",
    declaration: {
      decisionKind,
      options: options.map((option) => ({
        label: option.label,
        tradeoffs: option.tradeoffs,
        recommended: option.label === recommendation,
      })),
      recommendation: recommendation!,
      rationale: rationale!,
      briefing: briefing!,
    },
  };
}

/**
 * Collapse one required founder-facing prose field to the company-locale string, pushing the standard
 * missing-field error (like {@link parseOpenDecisions}'s other required-field failures) when it is
 * absent or empty. `hint` is appended to the error for fields that carry extra shape expectations.
 */
function requireField(
  value: unknown,
  path: string,
  locale: Locale,
  errors: string[],
  options: { hint?: string } = {},
): string | null {
  const resolved = resolveMaybeLocalized(value, locale);
  if (!resolved) {
    errors.push(`${path}: Expected a non-empty string${options.hint ? ` ${options.hint}` : ""}.`);
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
