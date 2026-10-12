import type {
  DepartmentSummary,
  HumanActionSummary,
  ObjectiveSummary,
  TaskSummary,
  VisionGapSummary,
  WaitStateSummary,
} from "../../api/client";
import { VideotexKeyValue, VideotexLog } from "../../ui/data";
import { useLanguage } from "../../ui/language";

export function CeoExecutiveOverview({
  companyTaskCount,
  departmentsById,
  founderVision,
  humanActions,
  objectives,
  tasksById,
  visionGaps,
  waitStates,
}: {
  companyTaskCount: number;
  departmentsById: Map<string, DepartmentSummary>;
  founderVision: string;
  humanActions: HumanActionSummary[];
  objectives: ObjectiveSummary[];
  tasksById: Map<string, TaskSummary>;
  visionGaps: VisionGapSummary[];
  waitStates: WaitStateSummary[];
}) {
  const { t } = useLanguage();
  const blockingTasks = [...tasksById.values()].filter((task) => task.status === "blocked" || task.status === "needs_replan" || task.status === "failed");
  const completedTasks = [...tasksById.values()].filter((task) => task.status === "complete");

  return (
    <section className="ceo-executive-overview" aria-label={t("department.ceoExecutiveOverview")}>
      <h3>{t("department.ceoExecutiveOverview")}</h3>
      {/* The Founder Vision is shown once here, not repeated on every Task Brief card (spec User Story 13). */}
      {founderVision ? (
        <p className="ceo-executive-overview__vision">
          <span className="ceo-executive-overview__label">{t("department.timelineFounderVision")}</span>
          {founderVision}
        </p>
      ) : null}
      <VideotexKeyValue
        items={[
          { label: t("department.objectives"), value: String(objectives.length) },
          { label: t("department.completedTasks"), value: `${completedTasks.length}/${companyTaskCount}` },
          { label: t("department.blockedTasks"), value: String(blockingTasks.length) },
        ]}
      />
      <VideotexLog
        emptyMessage={t("department.noCriticalChains")}
        rows={criticalDependencyRows([...tasksById.values()], departmentsById)}
      />
      <section className="ceo-executive-overview__signal-list" aria-label={t("department.humanActions")}>
        <p className="ceo-executive-overview__label">{t("department.humanActions")}</p>
        <VideotexLog
          emptyMessage={t("department.noHumanActions")}
          rows={humanActions.map((action) => `${formatRollupOwner(action.departmentId, departmentsById)} / ${action.status} / ${action.label}`)}
        />
      </section>
      <section className="ceo-executive-overview__signal-list" aria-label={t("department.waitStates")}>
        <p className="ceo-executive-overview__label">{t("department.waitStates")}</p>
        <VideotexLog
          emptyMessage={t("department.noWaitStates")}
          rows={waitStates.map(
            (waitState) => `${formatRollupOwner(waitState.departmentId, departmentsById)} / ${waitState.status} / ${waitState.label} / ${waitState.nextCheckAt}`,
          )}
        />
      </section>
      <section className="ceo-executive-overview__signal-list" aria-label={t("department.visionGaps")}>
        <p className="ceo-executive-overview__label">{t("department.visionGaps")}</p>
        <VideotexLog
          emptyMessage={t("department.noVisionGaps")}
          rows={visionGaps.map((gap) => `${gap.label} / ${gap.severity} / ${formatRollupOwner(gap.departmentId, departmentsById)}`)}
        />
      </section>
    </section>
  );
}

function formatRollupOwner(departmentId: string, departmentsById: Map<string, DepartmentSummary>): string {
  return departmentsById.get(departmentId)?.name ?? departmentId;
}

function criticalDependencyRows(tasks: TaskSummary[], departmentsById: Map<string, DepartmentSummary>): string[] {
  return tasks
    .filter((task) => task.taskKind !== "department_subtask")
    .filter((task) => task.status === "blocked" || task.status === "waiting_dependency" || task.status === "needs_replan")
    .map((task) => `${task.title} / ${formatRollupOwner(task.departmentId, departmentsById)} / ${task.dependencyNote ?? task.status}`);
}
