import { useMemo } from "react";
import type { CeoOfficeItemSummary, CompanySummary, DepartmentSummary, TaskSummary } from "../../api/client";
import { useLanguage } from "../../ui/language";
import { resolveLocalizedValue } from "../../ui/language/localizedText";
import type { CeoOfficeView } from "./CeoOfficeCard";
import { compareCeoOfficeTimelineItems, makeLineResolver, type TimelineRenderContext } from "./timelineItemView";

/**
 * The cards' view of a company, shared by CEO Office and the department pages so a card reads the
 * same wherever it is shown. Business text resolves in the company locale (ADR 0013).
 */
export function useOfficeView(input: {
  company: CompanySummary;
  ceoOfficeItems: CeoOfficeItemSummary[];
  departments: DepartmentSummary[];
  tasks: TaskSummary[];
  lastSeen: string | null;
  actions: Pick<CeoOfficeView, "onOpenItem" | "onOpenDepartment" | "onOpenTask" | "onOpenCeoOffice">;
}): { items: CeoOfficeItemSummary[]; view: CeoOfficeView } {
  const { t } = useLanguage();
  const locale = input.company.locale ?? "en";
  const tasksById = useMemo(() => new Map(input.tasks.map((task) => [task.id, task])), [input.tasks]);
  const departmentsById = useMemo(() => new Map(input.departments.map((department) => [department.id, department])), [input.departments]);
  const items = useMemo(() => [...input.ceoOfficeItems].sort(compareCeoOfficeTimelineItems), [input.ceoOfficeItems]);
  const intakeDepartments = useMemo(
    () => new Map(items.filter((item) => item.type === "founder_intake").map((item) => [item.sourceId, item.departmentId])),
    [items],
  );
  const ctx: TimelineRenderContext = useMemo(
    () => ({
      locale,
      line: makeLineResolver(locale, t),
      localize: (text, fallback) => resolveLocalizedValue(text, locale, fallback),
      t,
      tasksById,
    }),
    [locale, t, tasksById],
  );
  return {
    items,
    view: { ctx, companyStatus: input.company.status, departmentsById, lastSeen: input.lastSeen, intakeDepartments, ...input.actions },
  };
}

/** A Department Intake's cards belong to its department page, not to the CEO Office timeline. */
export function isDepartmentIntakeItem(item: CeoOfficeItemSummary): boolean {
  return (item.type === "founder_intake" || item.type === "intake_outcome") && item.departmentId !== null;
}
