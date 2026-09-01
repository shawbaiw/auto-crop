import { describe, expect, it } from "vitest";
import { localizedTextFromString, resolveLocalizedText } from "./localizedText";

describe("localizedText", () => {
  it("resolves the requested locale when present", () => {
    expect(resolveLocalizedText({ en: "Engineering", zh: "工程" }, "zh")).toBe("工程");
  });

  it("falls back to English before any available locale", () => {
    expect(resolveLocalizedText({ en: "Engineering" }, "zh")).toBe("Engineering");
    expect(resolveLocalizedText({ zh: "工程" }, "en")).toBe("工程");
  });

  it("wraps legacy strings as localized text for migration compatibility", () => {
    expect(localizedTextFromString("Build prototype.")).toEqual({
      en: "Build prototype.",
      zh: "Build prototype.",
    });
  });
});
