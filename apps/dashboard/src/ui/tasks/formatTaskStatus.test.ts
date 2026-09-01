import { describe, expect, it } from "vitest";
import type { TaskSummary } from "../../api/client";
import { chineseTranslations, englishTranslations, type TranslationKey } from "../language/translations";
import { formatTaskStatus } from "./formatTaskStatus";

function translate(locale: "en" | "zh") {
  const messages = locale === "en" ? englishTranslations : chineseTranslations;
  return (key: TranslationKey) => messages[key];
}

describe("formatTaskStatus", () => {
  it("localizes task status and failure reason display values", () => {
    const task = {
      id: "task_1",
      title: "Validate prototype",
      status: "failed",
      departmentId: "department_1",
      failureReason: "agent_failed",
    } satisfies TaskSummary;

    expect(formatTaskStatus(task, translate("en"))).toBe("failed · agent failed");
    expect(formatTaskStatus(task, translate("zh"))).toBe("失败 · Agent 运行失败");
  });

  it("localizes timeout details while preserving the raw budget value", () => {
    const task = {
      id: "task_1",
      title: "Validate prototype",
      status: "failed",
      departmentId: "department_1",
      failureReason: "timeout",
      effectiveTimeoutMs: 120_000,
    } satisfies TaskSummary;

    expect(formatTaskStatus(task, translate("en"))).toBe("failed · timed out · 2m");
    expect(formatTaskStatus(task, translate("zh"))).toBe("失败 · 已超时 · 2m");
  });
});
