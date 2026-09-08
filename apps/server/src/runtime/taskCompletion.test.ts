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

    expect(extractExecutionReport(payload)).toEqual({
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

  it("keeps old Task Outcome Summary prose readable when no structured report exists", () => {
    expect(extractExecutionReport({ outcome_summary: "Legacy summary." })).toBeNull();
    expect(extractOutcomeSummaryText({ outcome_summary: "Legacy summary." })).toEqual({
      en: "Legacy summary.",
      zh: "Legacy summary.",
    });
  });
});
