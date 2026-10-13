import { deriveCeoPendingItems } from "@auto-crop/core";
import type { CeoOfficeItemSummary, TaskSummary } from "../../api/client";
import { useLanguage } from "../../ui/language";

export type CeoPendingItem = {
  departmentName: string;
  officeItem: CeoOfficeItemSummary | null;
  task: TaskSummary;
  type: "review" | CeoOfficeItemSummary["type"];
};

export function getCeoPendingItems(
  ceoOfficeItems: CeoOfficeItemSummary[],
  tasks: TaskSummary[],
  departmentNamesById: Map<string, string>,
): CeoPendingItem[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  return deriveCeoPendingItems(ceoOfficeItems)
    .flatMap((officeItem) => {
      if (!officeItem.taskId) {
        return [];
      }
      const task = tasksById.get(officeItem.taskId);
      if (!task) {
        return [];
      }
      return [{
        departmentName: officeItem.departmentId ? departmentNamesById.get(officeItem.departmentId) ?? officeItem.departmentId : "",
        officeItem,
        task,
        type: officeItem.type,
      }];
    });
}

export function formatCeoPendingType(item: CeoPendingItem, t: ReturnType<typeof useLanguage>["t"]): string {
  switch (item.type) {
    case "review":
    case "approval_request":
      return `${t("department.ceoPendingReviewRequestFrom")} ${item.departmentName}`;
    case "decision_request":
      return `${t("department.ceoPendingDecisionRequestFrom")} ${item.departmentName}`;
    case "human_action":
      return `${t("department.ceoPendingHumanActionFrom")} ${item.departmentName}`;
    case "blocked_issue":
      return `${t("department.ceoPendingBlockedIssueFrom")} ${item.departmentName}`;
    case "wait_state":
      return `${t("department.ceoPendingWaitStateFrom")} ${item.departmentName}`;
    case "plan_brief":
    case "task_brief":
    case "execution_report":
    case "decision_resolution":
    case "stage_change":
    case "final_report":
    case "founder_intake":
    case "intake_outcome":
      return item.departmentName;
  }
}
