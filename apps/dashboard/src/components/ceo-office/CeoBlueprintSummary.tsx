import type { DepartmentSummary, FounderDecisionSummary, ObjectiveSummary, TaskSummary } from "../../api/client";
import { VideotexLog } from "../../ui/data";
import { useLanguage } from "../../ui/language";
import { resolveLocalizedValue } from "../../ui/language/localizedText";
import { CeoTaskDependencyGraph } from "./CeoTaskDependencyGraph";
import type { CeoPendingItem } from "./ceoPendingItems";

export function CeoBlueprintSummary({
  departments,
  founderDecisions,
  objectives,
  onSelectDepartment,
  onViewPendingTask,
  pendingItems,
  tasks,
}: {
  departments: DepartmentSummary[];
  founderDecisions: FounderDecisionSummary[];
  objectives: ObjectiveSummary[];
  onSelectDepartment: (departmentId: string) => void;
  onViewPendingTask: (taskId: string) => void;
  pendingItems: CeoPendingItem[];
  tasks: TaskSummary[];
}) {
  const { language, t } = useLanguage();

  return (
    <section className="ceo-blueprint-summary" aria-label={t("department.ceoBlueprintSummary")}>
      <div>
        <h3>{t("department.objectives")}</h3>
        <VideotexLog
          emptyMessage={t("department.noObjectives")}
          rows={objectives.map((objective) => resolveLocalizedValue(objective.titleText, language, objective.title))}
        />
      </div>
      <div>
        <h3>{t("department.taskRelationships")}</h3>
        <CeoTaskDependencyGraph
          departments={departments}
          founderDecisions={founderDecisions}
          onSelectDepartment={onSelectDepartment}
          onViewPendingTask={onViewPendingTask}
          pendingItems={pendingItems}
          tasks={tasks}
        />
      </div>
    </section>
  );
}
