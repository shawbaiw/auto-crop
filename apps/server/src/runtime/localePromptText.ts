import type { Locale } from "@auto-crop/core";

/**
 * The human-readable language name injected into founder-facing authoring prompts (task execution,
 * Final Founder Report). Under ADR 0013's single-canonical-locale model every generated founder-facing
 * prose field is authored in this one language; the dashboard chrome stays independently switchable.
 */
export const LOCALE_LANGUAGE_NAME: Record<Locale, string> = {
  en: "English",
  zh: "简体中文 (Simplified Chinese)",
};
