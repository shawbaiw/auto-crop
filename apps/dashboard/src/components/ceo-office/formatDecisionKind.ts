import { useLanguage } from "../../ui/language";
import { formatCodeLabel } from "../../ui/tasks/formatDisplayValue";

export function formatDecisionKind(kind: string, t: ReturnType<typeof useLanguage>["t"]): string {
  switch (kind) {
    case "target_market":
      return t("department.decisionKindTargetMarket");
    case "product_direction":
      return t("department.decisionKindProductDirection");
    case "mvp_type":
      return t("department.decisionKindMvpType");
    case "pricing_model":
      return t("department.decisionKindPricingModel");
    case "launch_target":
      return t("department.decisionKindLaunchTarget");
    default:
      return formatCodeLabel(kind);
  }
}
