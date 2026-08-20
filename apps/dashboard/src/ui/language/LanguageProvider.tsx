import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { chineseTranslations, englishTranslations, type TranslationKey } from "./translations";

export const languageOrder = ["en", "zh"] as const;
export type LanguageId = (typeof languageOrder)[number];

type LanguageContextValue = {
  language: LanguageId;
  setLanguage(language: LanguageId): void;
  t(key: TranslationKey): string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);
const currentLanguageStorageKey = "auto-crop.currentLanguage";
const translations = {
  en: englishTranslations,
  zh: chineseTranslations,
} satisfies Record<LanguageId, Record<TranslationKey, string>>;

export type LanguageProviderProps = {
  children: ReactNode;
  defaultLanguage?: LanguageId;
};

export function LanguageProvider({ children, defaultLanguage = "en" }: LanguageProviderProps) {
  const [language, setLanguage] = useState<LanguageId>(defaultLanguage);

  useEffect(() => {
    writeCurrentLanguage(language);
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: (key: TranslationKey) => translations[language][key],
    }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used inside LanguageProvider.");
  }
  return context;
}

export function isLanguageId(value: string): value is LanguageId {
  return languageOrder.includes(value as LanguageId);
}

export function readCurrentLanguage(): LanguageId | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  const storedLanguage = window.localStorage.getItem(currentLanguageStorageKey);
  return storedLanguage && isLanguageId(storedLanguage) ? storedLanguage : null;
}

function writeCurrentLanguage(language: LanguageId): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.setItem(currentLanguageStorageKey, language);
}
