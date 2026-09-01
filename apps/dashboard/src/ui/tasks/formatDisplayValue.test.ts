import { describe, expect, it } from "vitest";
import { chineseTranslations, englishTranslations, type TranslationKey } from "../language/translations";
import {
  formatArtifactKind,
  formatArtifactReviewStatus,
  formatArtifactRole,
  formatArtifactValidationStatus,
  formatCompanyStatus,
  formatProofType,
} from "./formatDisplayValue";

function translate(locale: "en" | "zh") {
  const messages = locale === "en" ? englishTranslations : chineseTranslations;
  return (key: TranslationKey) => messages[key];
}

describe("formatDisplayValue", () => {
  it("localizes company and proof display values", () => {
    expect(formatCompanyStatus("active", translate("en"))).toBe("Active");
    expect(formatCompanyStatus("active", translate("zh"))).toBe("运行中");
    expect(formatProofType("command_output", translate("en"))).toBe("Command output");
    expect(formatProofType("command_output", translate("zh"))).toBe("命令输出");
  });

  it("localizes artifact display values", () => {
    expect(formatArtifactKind("deliverable", translate("en"))).toBe("Deliverable");
    expect(formatArtifactKind("deliverable", translate("zh"))).toBe("交接物");
    expect(formatArtifactRole("implementation", translate("en"))).toBe("Implementation");
    expect(formatArtifactRole("implementation", translate("zh"))).toBe("实现");
    expect(formatArtifactValidationStatus("valid", translate("en"))).toBe("Valid");
    expect(formatArtifactValidationStatus("valid", translate("zh"))).toBe("有效");
    expect(formatArtifactReviewStatus("unreviewed", translate("en"))).toBe("Unreviewed");
    expect(formatArtifactReviewStatus("unreviewed", translate("zh"))).toBe("未审查");
  });
});
