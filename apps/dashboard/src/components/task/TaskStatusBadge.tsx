import { cn } from "@/lib/utils";
import { useLanguage } from "../../ui/language";
import { taskStatusTone, taskStatusToneClassName, taskStatusToneIcon, taskStatusToneLabelKey } from "./taskStatusTone";

/** A task's status as a small pill: its group's color, icon and name. Only running spins. */
export function TaskStatusBadge({ className, status }: { className?: string; status: string }) {
  const { t } = useLanguage();
  const tone = taskStatusTone(status);
  const Icon = taskStatusToneIcon[tone];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-[var(--r-pill)] px-2 py-0.5 text-xs font-medium", taskStatusToneClassName[tone], className)}>
      <Icon aria-hidden="true" className={cn("size-3 shrink-0", tone === "running" && "animate-spin")} />
      {t(taskStatusToneLabelKey[tone])}
    </span>
  );
}
