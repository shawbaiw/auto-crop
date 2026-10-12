import type { TaskProgressEventSummary, TaskSummary } from "../../api/client";
import { useLanguage } from "../../ui/language";
import { taskTitle } from "../../ui/language/localizedNames";
import { resolveLocalizedValue } from "../../ui/language/localizedText";
import { formatTaskStatus } from "../../ui/tasks/formatTaskStatus";

export function groupProgressEvents(events: TaskProgressEventSummary[]): Map<string, TaskProgressEventSummary[]> {
  const grouped = new Map<string, TaskProgressEventSummary[]>();
  for (const event of events) {
    grouped.set(event.parentTaskId, [...(grouped.get(event.parentTaskId) ?? []), event]);
  }
  return grouped;
}

export function resolveTaskProgressEvents(task: TaskSummary, events: TaskProgressEventSummary[] | undefined): TaskProgressEventSummary[] {
  const baseEvents = compactProgressEvents(events ?? fallbackProgressEvents(task));
  const derivedEvent = deriveCurrentTaskProgressEvent(task);

  if (!derivedEvent || progressEventsAlreadyReflectTaskStatus(baseEvents, task)) {
    return baseEvents;
  }

  return [...baseEvents, derivedEvent];
}

function compactProgressEvents(events: TaskProgressEventSummary[]): TaskProgressEventSummary[] {
  const latestEventIdBySubject = new Map<string, string>();

  for (const event of events) {
    if (event.subjectTaskId) {
      latestEventIdBySubject.set(event.subjectTaskId, event.id);
    }
  }

  return events.filter((event) => !event.subjectTaskId || latestEventIdBySubject.get(event.subjectTaskId) === event.id);
}

function deriveCurrentTaskProgressEvent(task: TaskSummary): TaskProgressEventSummary | null {
  const status = taskProgressStatusForTask(task);

  if (!status) {
    return null;
  }

  return {
    id: `${task.id}_derived_current_status`,
    companyId: "",
    departmentId: task.departmentId,
    parentTaskId: task.parentTaskId ?? task.id,
    subjectTaskId: task.id,
    step: task.status === "review" ? "awaiting_review" : "executing",
    status,
    label: `Task (${task.title}) ${task.status}`,
    labelText: {
      en: `Task (${resolveLocalizedValue(task.titleText, "en", task.title)}) ${task.status}`,
      zh: `任务（${resolveLocalizedValue(task.titleText, "zh", task.title)}）${task.status}`,
    },
    detail: null,
    createdAt: "",
  };
}

function taskProgressStatusForTask(task: TaskSummary): TaskProgressEventSummary["status"] | null {
  switch (task.status) {
    case "queued":
      return "waiting";
    case "running":
    case "retrying":
    case "review":
      return "current";
    case "waiting_dependency":
      return "waiting";
    case "complete":
      return "complete";
    case "blocked":
    case "failed":
    case "needs_replan":
      return "blocked";
    default:
      return null;
  }
}

function progressEventsAlreadyReflectTaskStatus(events: TaskProgressEventSummary[], task: TaskSummary): boolean {
  return events.some((event) => {
    if (task.status === "review") {
      return event.step === "awaiting_review" || (event.step === "executing" && /\sreview$/i.test(event.label));
    }

    if (task.status === "complete") {
      return event.step === "complete" || event.status === "complete";
    }

    if (task.status === "blocked" || task.status === "failed" || task.status === "needs_replan") {
      return event.step === "blocked" && event.status === "blocked";
    }

    if (event.step !== "executing") {
      return false;
    }

    const match = event.label.match(/^Task(?: \d+)? \((.+)\) ([a-z_]+)$/i);
    return Boolean(match && match[2] === task.status);
  });
}

function fallbackProgressEvents(task: TaskSummary): TaskProgressEventSummary[] {
  const isDone = task.status === "review" || task.status === "complete";
  const isBlocked = task.status === "blocked" || task.status === "failed" || task.status === "needs_replan";
  const currentStatus = isDone ? "complete" : isBlocked ? "blocked" : task.status === "queued" ? "waiting" : "current";

  return [
    {
      id: `${task.id}_received`,
      companyId: "",
      departmentId: task.departmentId,
      parentTaskId: task.id,
      subjectTaskId: null,
      step: "received",
      status: "complete",
      label: "Received CEO task",
      labelText: { en: "Received CEO task", zh: "已接收 CEO 任务" },
      detail: null,
      createdAt: "",
    },
    {
      id: `${task.id}_assessment`,
      companyId: "",
      departmentId: task.departmentId,
      parentTaskId: task.id,
      subjectTaskId: null,
      step: "assessment_complete",
      status: task.status === "queued" ? "waiting" : "complete",
      label: task.status === "queued" ? "Assessment pending" : "Assessment complete",
      labelText:
        task.status === "queued"
          ? { en: "Assessment pending", zh: "评估待开始" }
          : { en: "Assessment complete", zh: "评估完成" },
      detail: null,
      createdAt: "",
    },
    {
      id: `${task.id}_execution`,
      companyId: "",
      departmentId: task.departmentId,
      parentTaskId: task.id,
      subjectTaskId: task.id,
      step: "executing",
      status: currentStatus,
      label: `Task 1 (${task.title}) ${task.status}`,
      labelText: {
        en: `Task 1 (${resolveLocalizedValue(task.titleText, "en", task.title)}) ${task.status}`,
        zh: `任务 1（${resolveLocalizedValue(task.titleText, "zh", task.title)}）${task.status}`,
      },
      detail: null,
      createdAt: "",
    },
  ];
}

export function progressMarker(status: TaskProgressEventSummary["status"]): string {
  if (status === "complete") {
    return "✓";
  }
  if (status === "current") {
    return "●";
  }
  return "○";
}

export function formatProgressLabel(
  event: TaskProgressEventSummary,
  task: TaskSummary,
  language: "en" | "zh",
  t: ReturnType<typeof useLanguage>["t"],
  hasCeoPendingItem: boolean,
): string {
  switch (event.step) {
    case "received":
      return t("department.flowReceived");
    case "assessing":
      return t("department.flowAssessing");
    case "assessment_complete":
      return t("department.flowAssessmentComplete");
    case "splitting":
      return t("department.flowSplitting");
    case "split_complete":
      return t("department.flowSplitComplete");
    case "no_split_needed":
      return t("department.flowNoSplitNeeded");
    case "summarizing_proof":
      return t("department.flowSummarizingProof");
    case "awaiting_review":
      return formatReviewProgressLabel(task, language, t, hasCeoPendingItem);
    case "complete":
      return t("department.flowComplete");
    case "blocked":
      if (event.label.startsWith("CEO Office returned")) {
        const label = resolveLocalizedValue(event.labelText, language, event.label);
        const detail = event.detail ? resolveLocalizedValue(event.detailText, language, event.detail) : null;
        return detail ? `${label} ${detail}` : label;
      }
      return t("department.flowBlocked");
    case "needs_ceo_reassignment":
      return t("department.flowNeedsCeoReassignment");
    case "executing":
      return formatExecutingProgressLabel(event.label, task, language, t, hasCeoPendingItem);
  }
}

function formatExecutingProgressLabel(
  label: string,
  task: TaskSummary,
  language: "en" | "zh",
  t: ReturnType<typeof useLanguage>["t"],
  hasCeoPendingItem: boolean,
): string {
  const match = label.match(/^Task(?: \d+)? \((.+)\) ([a-z_]+)$/i);
  if (!match) {
    return label;
  }

  const [, , status] = match;
  if (status === "review") {
    return formatReviewProgressLabel(task, language, t, hasCeoPendingItem);
  }

  return `${t("department.flowTask")} (${taskTitle(task, language)}) ${formatFlowTaskStatus(task.status, t)}`;
}

function formatReviewProgressLabel(
  task: TaskSummary,
  language: "en" | "zh",
  t: ReturnType<typeof useLanguage>["t"],
  hasCeoPendingItem: boolean,
): string {
  if (task.status === "review" && hasCeoPendingItem) {
    return formatCeoReviewSubmittedLabel(taskTitle(task, language), t);
  }

  return `${t("department.flowTask")} (${taskTitle(task, language)}) ${formatFlowTaskStatus(task.status, t)}`;
}

function formatCeoReviewSubmittedLabel(title: string, t: ReturnType<typeof useLanguage>["t"]): string {
  return `${t("department.flowTask")} (${title}) ${t("department.flowSubmittedToCeoReview")}`;
}

export function isActiveCeoReviewProgressEvent(event: TaskProgressEventSummary, task: TaskSummary): boolean {
  if (task.status !== "review") {
    return false;
  }

  if (event.step === "awaiting_review") {
    return true;
  }

  return event.step === "executing" && /\sreview$/i.test(event.label);
}

function formatFlowTaskStatus(status: string, t: ReturnType<typeof useLanguage>["t"]): string {
  switch (status) {
    case "waiting":
      return t("department.flowStatusWaiting");
    case "queued":
      return t("department.flowStatusWaiting");
    case "waiting_dependency":
    case "needs_replan":
      return formatTaskStatus({ status } as TaskSummary, t);
    case "running":
      return t("department.flowStatusRunning");
    case "retrying":
      return t("department.flowStatusRunning");
    case "blocked":
      return t("department.flowStatusBlocked");
    case "failed":
      return t("department.flowStatusBlocked");
    case "review":
      return t("department.flowStatusReview");
    case "complete":
      return t("department.flowStatusComplete");
    default:
      return status;
  }
}
