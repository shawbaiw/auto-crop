export const localeOrder = ["en", "zh"] as const;
export type Locale = (typeof localeOrder)[number];
export type LocalizedText = Partial<Record<Locale, string>>;
export type CompleteLocalizedText = Record<Locale, string>;

export function isLocale(value: string): value is Locale {
  return localeOrder.includes(value as Locale);
}

export function localizedTextFromString(value: string): CompleteLocalizedText {
  return {
    en: value,
    zh: value,
  };
}

export function resolveLocalizedText(text: LocalizedText, locale: Locale): string {
  return text[locale] ?? text.en ?? localeOrder.map((candidate) => text[candidate]).find((value): value is string => Boolean(value)) ?? "";
}

/**
 * Collapse an agent-authored founder-facing field to a single trimmed string in the company locale.
 * The field may arrive as a bare string (the single-canonical-locale contract, ADR 0013) or as an
 * `{ en, zh }` object (older shape / defensive), which is resolved on `locale` then `en` then any set
 * value. Returns `null` when nothing usable is present — callers treat that as a missing field.
 */
export function resolveMaybeLocalized(value: unknown, locale: Locale): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    const localized: LocalizedText = {};
    for (const candidate of localeOrder) {
      if (typeof source[candidate] === "string") {
        localized[candidate] = source[candidate] as string;
      }
    }
    const resolved = resolveLocalizedText(localized, locale).trim();
    return resolved.length > 0 ? resolved : null;
  }
  return null;
}
