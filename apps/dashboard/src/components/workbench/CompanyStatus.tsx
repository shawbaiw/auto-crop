import { cn } from "@/lib/utils";
import { useLanguage } from "../../ui/language";
import { formatCompanyStatus } from "../../ui/tasks/formatDisplayValue";

/** Company status colours (dashboard ADR 0002). */
const statusTone: Record<string, { dot: string; text: string }> = {
  active: { dot: "bg-emerald-500", text: "text-emerald-700" },
  paused: { dot: "bg-amber-500", text: "text-amber-700" },
  stopped: { dot: "bg-slate-400", text: "text-slate-500" },
  creating: { dot: "bg-blue-500", text: "text-blue-700" },
  creation_failed: { dot: "bg-red-500", text: "text-red-700" },
};

export function CompanyStatus({ className, status }: { className?: string; status: string }) {
  const { t } = useLanguage();
  const tone = statusTone[status] ?? statusTone.stopped!;

  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 text-xs font-medium", tone.text, className)}>
      <span aria-hidden="true" className={cn("size-2 rounded-full", tone.dot)} />
      {formatCompanyStatus(status, t)}
    </span>
  );
}
