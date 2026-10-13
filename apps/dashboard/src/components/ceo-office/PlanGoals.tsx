import { Target } from "lucide-react";
import type { KeyResultSummary, Locale, ObjectiveSummary, TaskSummary } from "../../api/client";
import { cn } from "@/lib/utils";
import { useLanguage, type TranslationKey } from "../../ui/language";
import { resolveLocalizedValue } from "../../ui/language/localizedText";

const STATUS_TONE: Record<string, string> = {
  met: "bg-emerald-50 text-emerald-700",
  missed: "bg-red-50 text-red-700",
  active: "bg-slate-100 text-slate-600",
};

/**
 * The goals the plan serves, always in view above the canvas: each goal, its key results with their
 * targets, how many of their tasks are done, and whether each is met. "Met" is the server's status,
 * set when every task serving the key result is complete (ADR 0048); the task count only shows the
 * way there.
 */
export function PlanGoals({
  keyResults,
  locale,
  objectives,
  tasks,
}: {
  keyResults: KeyResultSummary[];
  locale: Locale;
  objectives: ObjectiveSummary[];
  tasks: TaskSummary[];
}) {
  const { t } = useLanguage();
  if (objectives.length === 0) return null;
  return (
    <section aria-label={t("ceoOffice.planGoals")} className="grid max-h-48 shrink-0 gap-2 overflow-y-auto rounded-lg border border-border/80 bg-card p-3">
      {[...objectives].sort((a, b) => a.priority - b.priority).map((objective) => (
        <div className="grid gap-1" key={objective.id}>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold">
            <Target aria-hidden="true" className="size-3.5 text-muted-foreground" />
            {resolveLocalizedValue(objective.titleText, locale, objective.title)}
          </h3>
          <ul className="grid gap-1">
            {keyResults.filter((keyResult) => keyResult.objectiveId === objective.id).map((keyResult) => {
              const serving = tasks.filter((task) => task.keyResultId === keyResult.id && task.taskKind !== "department_subtask" && task.status !== "cancelled");
              const done = serving.filter((task) => task.status === "complete").length;
              const status = keyResult.status in STATUS_TONE ? keyResult.status : "active";
              return (
                <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-xs" key={keyResult.id}>
                  <span className="min-w-0 font-medium">{resolveLocalizedValue(keyResult.titleText, locale, keyResult.title)}</span>
                  <span className="text-muted-foreground">
                    {t("ceoOffice.goalTarget").replace("{target}", resolveLocalizedValue(keyResult.targetValueText, locale, keyResult.targetValue))}
                  </span>
                  <span className="text-muted-foreground">
                    {serving.length === 0 ? t("ceoOffice.goalNoTasks") : t("ceoOffice.goalTasks").replace("{done}", String(done)).replace("{total}", String(serving.length))}
                  </span>
                  <span className={cn("rounded-full px-1.5 py-0.5 font-medium", STATUS_TONE[status])}>{t(`ceoOffice.keyResultStatus.${status}` as TranslationKey)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
