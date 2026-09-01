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
