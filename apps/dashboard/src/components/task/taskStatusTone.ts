import { Check, CircleAlert, CircleSlash, Clock, Eye, Hand, LoaderCircle, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "../../ui/language";

/** The task status groups of dashboard ADR 0002; their colors and icons follow color system v2 §6.1. */
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

const yourTurn = "bg-[color:var(--status-your-turn-bg)] text-[color:var(--status-your-turn-fg)] font-semibold";

/**
 * Badge classes, one color per state: review and needs-you share "your turn" (charcoal) and differ by
 * icon and text, since both ask the founder to act; waiting and cancelled are neutral.
 */
export const taskStatusToneClassName: Record<TaskStatusTone, string> = {
  running: "bg-status-running-bg text-status-running",
  waiting: "bg-status-neutral-bg text-status-neutral",
  review: yourTurn,
  needsYou: yourTurn,
  failed: "bg-status-failed-bg text-status-failed",
  complete: "bg-status-success-bg text-status-success",
  cancelled: "bg-status-neutral-bg text-status-neutral line-through",
};

export const taskStatusToneIcon: Record<TaskStatusTone, LucideIcon> = {
  running: LoaderCircle,
  waiting: Clock,
  review: Eye,
  needsYou: Hand,
  failed: CircleAlert,
  complete: Check,
  cancelled: CircleSlash,
};
