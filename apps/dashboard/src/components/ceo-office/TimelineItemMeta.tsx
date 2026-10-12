import type { CeoOfficeItemSummary, DepartmentSummary, Locale } from "../../api/client";
import { departmentName } from "../../ui/language/localizedNames";
import { formatCeoOfficeItemType, formatTimelineRelativeTime, type TranslateFn } from "./timelineItemView";

/** The card / modal meta line: type tag · department · time. `relative` picks the time format. */
export function TimelineItemMeta({
  departmentsById,
  item,
  locale,
  relative,
  t,
}: {
  departmentsById: Map<string, DepartmentSummary>;
  item: CeoOfficeItemSummary;
  locale: Locale;
  relative: boolean;
  t: TranslateFn;
}) {
  const department = item.departmentId ? departmentsById.get(item.departmentId) : null;
  return (
    <span className="ceo-office-timeline__meta">
      <span>{formatCeoOfficeItemType(item.type, t)}</span>
      {department ? <span>{departmentName(department, locale)}</span> : null}
      <span>{relative ? formatTimelineRelativeTime(item.occurredAt, locale) : new Date(item.occurredAt).toLocaleString(locale)}</span>
    </span>
  );
}
