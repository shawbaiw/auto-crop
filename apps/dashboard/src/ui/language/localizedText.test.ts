import { describe, expect, it } from "vitest";
import { resolveLocalizedValue } from "./localizedText";

describe("resolveLocalizedValue", () => {
  it("returns the active locale value when present", () => {
    expect(resolveLocalizedValue({ en: "Engineering", zh: "工程" }, "zh", "Engineering")).toBe("工程");
  });

  it("falls back to English and then the legacy value", () => {
    expect(resolveLocalizedValue({ en: "Engineering" }, "zh", "Legacy Engineering")).toBe("Engineering");
    expect(resolveLocalizedValue(undefined, "zh", "Legacy Engineering")).toBe("Legacy Engineering");
  });
});
