import { describe, expect, it } from "vitest";
import { parseOpenDecisions } from "./founderDecision";

function payloadWith(entry: Record<string, unknown>): Record<string, unknown> {
  return { open_decisions: [entry] };
}

const wellFormed = {
  decisionKind: "pricing_model",
  options: [
    { label: "Flat monthly fee", tradeoffs: "Predictable revenue; underprices heavy users." },
    { label: "Usage-based", tradeoffs: "Scales with value; harder to forecast." },
  ],
  recommendation: "Flat monthly fee",
  rationale: "Early buyers want a predictable bill.",
  briefing: "Explored flat, usage-based, and tiered against interviewed buyers; the opportunity is predictable billing for solo buyers.",
};

// The "kept, carries briefing" and "missing briefing fails validation" cases run through the real
// Business Artifact path in businessArtifact.test.ts. These cover only what is specific to the
// locale-collapse rule the parser adds.
describe("parseOpenDecisions briefing / locale collapse", () => {
  it("treats a whitespace-only briefing as missing, like an empty rationale", () => {
    const result = parseOpenDecisions(payloadWith({ ...wellFormed, briefing: "   " }), "en");

    expect(result.kept).toEqual([]);
    expect(result.errors).toContain("payload.open_decisions[0].briefing: Expected a non-empty string.");
  });

  it("collapses a localized briefing / rationale object onto the company locale", () => {
    const result = parseOpenDecisions(
      payloadWith({
        ...wellFormed,
        rationale: { en: "Predictable bill wins.", zh: "可预测的账单更受欢迎。" },
        briefing: { en: "English briefing.", zh: "中文说明。" },
      }),
      "zh",
    );

    expect(result.errors).toEqual([]);
    expect(result.kept[0]!.briefing).toBe("中文说明。");
    expect(result.kept[0]!.rationale).toBe("可预测的账单更受欢迎。");
  });

  it("falls back to another locale when the company-locale value is absent", () => {
    const result = parseOpenDecisions(
      payloadWith({ ...wellFormed, briefing: { en: "English only briefing." } }),
      "zh",
    );

    expect(result.errors).toEqual([]);
    expect(result.kept[0]!.briefing).toBe("English only briefing.");
  });
});
