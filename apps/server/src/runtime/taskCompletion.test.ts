import { describe, expect, it } from "vitest";
import { extractExecutionReport, extractOutcomeSummaryText } from "./taskCompletion";

describe("task completion report extraction", () => {
  it("prefers a structured Execution Report while preserving Task Outcome Summary fallback", () => {
    const payload = {
      execution_report: {
        conclusion: "The prototype validates the first workflow.",
        vision_impact: "The founder vision now has a concrete product path.",
        remaining_gap: "The launch channel is still untested.",
        recommendation: "Run a narrow launch experiment next.",
      },
      outcome_summary:
        "The prototype validates the first workflow. It gives the founder vision a product path; launch remains untested. Run a narrow launch experiment next.",
    };

    expect(extractExecutionReport(payload, "en")).toEqual({
      conclusion: { en: "The prototype validates the first workflow." },
      visionImpact: { en: "The founder vision now has a concrete product path." },
      remainingGap: { en: "The launch channel is still untested." },
      recommendation: { en: "Run a narrow launch experiment next." },
    });
    expect(extractOutcomeSummaryText(payload)).toEqual({
      en: "The prototype validates the first workflow. It gives the founder vision a product path; launch remains untested. Run a narrow launch experiment next.",
      zh: "The prototype validates the first workflow. It gives the founder vision a product path; launch remains untested. Run a narrow launch experiment next.",
    });
  });

  it("stores a bare Execution Report string under the company's canonical locale", () => {
    const payload = {
      execution_report: {
        conclusion: "原型验证了第一个工作流。",
        vision_impact: "创始人愿景现在有了具体的产品路径。",
        remaining_gap: "发布渠道仍未验证。",
        recommendation: "接下来做一次小范围发布实验。",
      },
    };

    expect(extractExecutionReport(payload, "zh")).toEqual({
      conclusion: { zh: "原型验证了第一个工作流。" },
      visionImpact: { zh: "创始人愿景现在有了具体的产品路径。" },
      remainingGap: { zh: "发布渠道仍未验证。" },
      recommendation: { zh: "接下来做一次小范围发布实验。" },
    });
  });

  it("keeps an already-localized Execution Report object unchanged regardless of company locale", () => {
    const payload = {
      execution_report: {
        conclusion: { en: "The prototype validates the first workflow." },
        vision_impact: { en: "The founder vision now has a concrete product path." },
        remaining_gap: { en: "The launch channel is still untested." },
        recommendation: { en: "Run a narrow launch experiment next." },
      },
    };

    expect(extractExecutionReport(payload, "zh")).toEqual({
      conclusion: { en: "The prototype validates the first workflow." },
      visionImpact: { en: "The founder vision now has a concrete product path." },
      remainingGap: { en: "The launch channel is still untested." },
      recommendation: { en: "Run a narrow launch experiment next." },
    });
  });

  it("keeps old Task Outcome Summary prose readable when no structured report exists", () => {
    expect(extractExecutionReport({ outcome_summary: "Legacy summary." }, "en")).toBeNull();
    expect(extractOutcomeSummaryText({ outcome_summary: "Legacy summary." })).toEqual({
      en: "Legacy summary.",
      zh: "Legacy summary.",
    });
  });
});
