import { Activity, Building2, FileCheck2, ListChecks, ShieldAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { CompanySummary, DepartmentSummary, ServerEvent, TaskSummary } from "../api/client";
import { VideotexKeyValue, VideotexLog } from "../ui/data";
import { useLanguage, type TranslationKey } from "../ui/language";
import { AppShell, PageHeader, Workspace } from "../ui/layout";
import { RetroPanel } from "../ui/retro";

export type CompanyOperationsProps = {
  company: CompanySummary;
  departments: DepartmentSummary[];
  events: ServerEvent[];
  isPaused: boolean;
  menuBar?: ReactNode;
  tasks: TaskSummary[];
};

export function CompanyOperations({ company, departments, events, isPaused, menuBar, tasks }: CompanyOperationsProps) {
  const { t } = useLanguage();
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const activityRows = useMemo(
    () => events.map((event) => formatAgentActivityEvent(event, event.taskId ? tasksById.get(event.taskId) : undefined, t)),
    [events, tasksById, t],
  );
  const taskCounts = countTaskStates(tasks);

  return (
    <AppShell className="app-shell--workbench" menuBar={menuBar}>
      <PageHeader
        eyebrow={company.name}
        status={company.status}
        statusIcon={<Activity size={16} aria-hidden="true" />}
        title={t("operations.title")}
      />
      {isPaused ? <section className="system-message system-message--danger">{t("app.globalPause")}</section> : null}

      <Workspace className="operations-grid">
        <RetroPanel icon={<Building2 size={18} aria-hidden="true" />} title={t("operations.companyState")} variant="inverted">
          <VideotexKeyValue
            items={[
              { label: t("operations.state"), value: company.status },
              { label: t("operations.playbook"), value: company.playbookId },
              { label: t("operations.departments"), value: String(departments.length).padStart(2, "0") },
            ]}
          />
        </RetroPanel>
        <RetroPanel icon={<ListChecks size={18} aria-hidden="true" />} title={t("operations.taskFlow")}>
          <VideotexKeyValue
            items={[
              { label: t("operations.running"), value: String(taskCounts.running).padStart(2, "0") },
              { label: t("operations.review"), value: String(taskCounts.review).padStart(2, "0") },
              { label: t("operations.blocked"), value: String(taskCounts.blocked).padStart(2, "0") },
              { label: t("operations.failed"), value: String(taskCounts.failed).padStart(2, "0") },
            ]}
          />
        </RetroPanel>
        <RetroPanel icon={<ShieldAlert size={18} aria-hidden="true" />} title={t("operations.attention")}>
          <VideotexLog
            emptyMessage={t("operations.noAttention")}
            rows={tasks
              .filter((task) => task.status === "blocked" || task.status === "failed")
              .map((task) => `${task.title} / ${formatTaskStatus(task)}`)}
          />
        </RetroPanel>
      </Workspace>

      <Workspace className="control-grid">
        <RetroPanel icon={<Activity size={18} aria-hidden="true" />} title={t("operations.agentActivity")}>
          <VideotexLog emptyMessage={t("operations.waitingActivity")} rows={activityRows} />
        </RetroPanel>
        <RetroPanel icon={<FileCheck2 size={18} aria-hidden="true" />} title={t("operations.reviewQueue")}>
          <VideotexLog
            emptyMessage={t("operations.noReviewTasks")}
            rows={tasks.filter((task) => task.status === "review").map((task) => task.title)}
          />
        </RetroPanel>
        <RetroPanel icon={<ListChecks size={18} aria-hidden="true" />} title={t("operations.departments")}>
          <VideotexLog emptyMessage={t("operations.noDepartments")} rows={departments.map((department) => department.name)} />
        </RetroPanel>
      </Workspace>
    </AppShell>
  );
}

function countTaskStates(tasks: TaskSummary[]) {
  return tasks.reduce(
    (counts, task) => ({
      ...counts,
      [task.status]: (counts[task.status as keyof typeof counts] ?? 0) + 1,
    }),
    { blocked: 0, failed: 0, review: 0, running: 0 },
  );
}

function formatTaskStatus(task: TaskSummary): string {
  const details = [task.status];

  if (task.failureReason) {
    details.push(task.failureReason);
  }

  if (task.dependencyNote) {
    details.push(task.dependencyNote);
  }

  return details.join(" · ");
}

function formatAgentActivityEvent(event: ServerEvent, task: TaskSummary | undefined, t: (key: TranslationKey) => string): string {
  const title = task?.title ?? t("operations.unknownTask");
  return `${formatAgentActivityState(event, t)} · ${title} — ${formatAgentActivityDetail(event, t)}`;
}

function formatAgentActivityState(event: ServerEvent, t: (key: TranslationKey) => string): string {
  switch (event.type) {
    case "task_started":
      return t("operations.running");
    case "task_review":
      return t("operations.readyForReview");
    case "task_failed":
      return t("operations.failed");
    case "task_blocked":
      return t("operations.blocked");
    case "task_warning":
      return t("operations.warning");
    case "partial_output":
      return t("operations.partialOutput");
    default:
      return event.status ? titleCase(event.status) : t("operations.activity");
  }
}

function formatAgentActivityDetail(event: ServerEvent, t: (key: TranslationKey) => string): string {
  if (event.type === "task_started") {
    return event.effectiveTimeoutMs
      ? `${t("operations.agentWorking")} ${t("operations.budget")}: ${formatBudget(event.effectiveTimeoutMs)}.`
      : t("operations.agentWorking");
  }

  if (event.type === "task_review") {
    return t("operations.proofReady");
  }

  if (event.type === "task_failed") {
    return formatFailureDetail(event.failureReason, t);
  }

  if (event.type === "task_blocked") {
    return event.dependencyNote ?? cleanActivityMessage(event.message) ?? t("operations.waitingDependency");
  }

  if (event.type === "task_warning") {
    return cleanActivityMessage(event.message) ?? t("operations.needsAttention");
  }

  if (event.type === "partial_output") {
    return event.artifactWorkspacePath
      ? `${event.artifactWorkspacePath} ${t("operations.diagnosticPath")}`
      : t("operations.diagnosticOnly");
  }

  return cleanActivityMessage(event.message) ?? t("operations.newActivity");
}

function formatFailureDetail(reason: string | undefined, t: (key: TranslationKey) => string): string {
  switch (reason) {
    case "timeout":
      return t("operations.failureTimeout");
    case "no_proof":
      return t("operations.failureNoProof");
    case "proof_capture_failed":
      return t("operations.failureProofCapture");
    case "dependency_failed":
      return t("operations.failureDependency");
    case "agent_failed":
      return t("operations.failureAgent");
    default:
      return t("operations.failureDefault");
  }
}

function formatBudget(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}

function cleanActivityMessage(message: string): string | null {
  const cleaned = message
    .replace(/^Task warning:\s*/i, "")
    .replace(/^Task blocked:\s*/i, "")
    .replace(/^Task failed:\s*/i, "")
    .replace(/^Partial Output:\s*/i, "")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
