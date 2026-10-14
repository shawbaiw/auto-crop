import { Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "../../ui/language";
import { formatCompanyStatus } from "../../ui/tasks/formatDisplayValue";

/** Company status colors (color system v2 §6.2): paused and stopped are neutral, never a warning. */
const statusTone: Record<string, { dot: string; text: string }> = {
  active: { dot: "bg-status-success-icon", text: "text-status-success" },
  paused: { dot: "", text: "text-status-neutral" },
  stopped: { dot: "bg-status-neutral-icon", text: "text-[color:var(--text-disabled)]" },
  creating: { dot: "bg-status-running-icon", text: "text-status-running" },
  creation_failed: { dot: "bg-status-failed-icon", text: "text-status-failed" },
};

export function CompanyStatus({ className, status }: { className?: string; status: string }) {
  const { t } = useLanguage();
  const tone = statusTone[status] ?? statusTone.stopped!;

  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 text-xs font-medium", tone.text, className)}>
      {status === "paused" ? (
        <Pause aria-hidden="true" className="size-3 text-status-neutral-icon" />
      ) : (
        <span aria-hidden="true" className={cn("size-2 rounded-[var(--r-pill)]", tone.dot)} />
      )}
      {formatCompanyStatus(status, t)}
    </span>
  );
}
