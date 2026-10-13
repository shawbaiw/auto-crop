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

/**
 * The Founder Writing Rules (ADR 0045), based on ASD-STE100. STE is an English standard, so the
 * Chinese rules state the same ideas for Chinese. A prompt that authors founder-facing prose includes
 * the rules for the company locale.
 */
export const FOUNDER_WRITING_RULES: Record<Locale, string> = {
  en: [
    "## Founder Writing Rules",
    "",
    "The founder reads what you write. Write it so that it is clear, exact and short:",
    "- One topic per sentence. Keep sentences short, at most about 20 words.",
    "- Use the active voice: say who does what.",
    "- Use common words. Do not invent terms, and do not use internal terms such as Business Artifact, Hold, Affordance, Envelope, Wait State, proof schema or task status codes.",
    "- Give specific facts and numbers instead of general claims.",
    "- Do not write codes such as `missing_business_artifact` in a sentence. Describe what happened instead.",
  ].join("\n"),
  zh: [
    "## 写给创始人的文字规则",
    "",
    "创始人会读你写的文字。要写得清楚、准确、简短：",
    "- 一句话只说一件事。句子要短，一般不超过 40 个字。",
    "- 用主动句，说清楚谁做什么。",
    "- 用常用词。不要自造术语，也不要用内部术语，比如 Business Artifact、Hold、Affordance、Envelope、Wait State、proof schema 或任务状态码。",
    "- 给出具体的事实和数字，不说笼统的话。",
    "- 不要把 `missing_business_artifact` 这样的代码写进句子里，要直接说发生了什么。",
  ].join("\n"),
};
