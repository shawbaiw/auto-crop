import type { CompleteLocalizedText, LocalizedText } from "../../api/client";
import type { LanguageId } from "./LanguageProvider";

export function resolveLocalizedValue(
  text: LocalizedText | CompleteLocalizedText | null | undefined,
  language: LanguageId,
  fallback: string,
): string {
  return text?.[language] ?? text?.en ?? fallback;
}
