import type { DepartmentSummary, TaskSummary } from "../../api/client";
import { resolveLocalizedValue } from "./localizedText";

export function departmentName(department: DepartmentSummary, language: "en" | "zh"): string {
  return resolveLocalizedValue(department.nameText, language, department.name);
}

export function departmentResponsibility(department: DepartmentSummary, language: "en" | "zh"): string {
  return resolveLocalizedValue(department.responsibilityText, language, department.responsibility);
}

export function taskTitle(task: TaskSummary, language: "en" | "zh"): string {
  return resolveLocalizedValue(task.titleText, language, task.title);
}

export function taskDescription(task: TaskSummary, language: "en" | "zh"): string {
  return resolveLocalizedValue(task.descriptionText, language, task.description ?? "");
}
