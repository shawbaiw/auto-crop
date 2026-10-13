import { Languages } from "lucide-react";
import { Button } from "@/components/ui";
import { languageOrder, useLanguage } from "../../ui/language";

export function LanguageSwitch() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div aria-label={t("menu.language")} className="inline-flex items-center gap-1" role="group">
      <Languages aria-hidden="true" className="mr-1 hidden size-4 text-muted-foreground sm:block" />
      {languageOrder.map((languageId) => (
        <Button
          aria-label={languageId === "zh" ? t("menu.languageChinese") : t("menu.languageEnglish")}
          aria-pressed={languageId === language}
          className="aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"
          key={languageId}
          onClick={() => setLanguage(languageId)}
          size="sm"
          variant="ghost"
        >
          {languageId === "zh" ? t("menu.languageChinese") : t("menu.languageEnglishShort")}
        </Button>
      ))}
    </div>
  );
}
