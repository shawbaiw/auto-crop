import type { TranslationKey } from "../../ui/language";

/** The task status groups of dashboard ADR 0002, each with its colour. */
export type TaskStatusTone = "running" | "waiting" | "review" | "needsYou" | "failed" | "complete" | "cancelled";

export function taskStatusTone(status: string): TaskStatusTone {
  switch (status) {
    case "running":
    case "retrying":
      return "running";
    case "review":
      return "review";
    case "blocked":
    case "needs_replan":
      return "needsYou";
    case "failed":
      return "failed";
    case "complete":
      return "complete";
    case "cancelled":
      return "cancelled";
    default:
      return "waiting";
  }
}

export const taskStatusToneLabelKey: Record<TaskStatusTone, TranslationKey> = {
  running: "ceoOffice.taskStatus.running",
  waiting: "ceoOffice.taskStatus.waiting",
  review: "ceoOffice.taskStatus.review",
  needsYou: "ceoOffice.taskStatus.needsYou",
  failed: "ceoOffice.taskStatus.failed",
  complete: "ceoOffice.taskStatus.complete",
  cancelled: "ceoOffice.taskStatus.cancelled",
};

/** Badge classes: running blue, waiting gray, review violet, needs you amber, failed red, complete green, cancelled struck gray. */
export const taskStatusToneClassName: Record<TaskStatusTone, string> = {
  running: "bg-blue-50 text-blue-700",
  waiting: "bg-slate-100 text-slate-600",
  review: "bg-violet-50 text-violet-700",
  needsYou: "bg-amber-50 text-amber-800",
  failed: "bg-red-50 text-red-700",
  complete: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-500 line-through",
};
