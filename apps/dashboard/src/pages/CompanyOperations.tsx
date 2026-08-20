import { Activity, Building2, FileCheck2, ListChecks, ShieldAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { CompanySummary, DepartmentSummary, ServerEvent, TaskSummary } from "../api/client";
import { VideotexKeyValue, VideotexLog } from "../ui/data";
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
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const activityRows = useMemo(
    () => events.map((event) => formatAgentActivityEvent(event, event.taskId ? tasksById.get(event.taskId) : undefined)),
    [events, tasksById],
  );
  const taskCounts = countTaskStates(tasks);

  return (
    <AppShell className="app-shell--workbench" menuBar={menuBar}>
      <PageHeader
        eyebrow={company.name}
        status={company.status}
        statusIcon={<Activity size={16} aria-hidden="true" />}
        title="Company Operations"
      />
      {isPaused ? <section className="system-message system-message--danger">Global pause active</section> : null}

      <Workspace className="operations-grid">
        <RetroPanel icon={<Building2 size={18} aria-hidden="true" />} title="Company State" variant="inverted">
          <VideotexKeyValue
            items={[
              { label: "State", value: company.status },
              { label: "Playbook", value: company.playbookId },
              { label: "Departments", value: String(departments.length).padStart(2, "0") },
            ]}
          />
        </RetroPanel>
        <RetroPanel icon={<ListChecks size={18} aria-hidden="true" />} title="Task Flow">
          <VideotexKeyValue
            items={[
              { label: "Running", value: String(taskCounts.running).padStart(2, "0") },
              { label: "Review", value: String(taskCounts.review).padStart(2, "0") },
              { label: "Blocked", value: String(taskCounts.blocked).padStart(2, "0") },
              { label: "Failed", value: String(taskCounts.failed).padStart(2, "0") },
            ]}
          />
        </RetroPanel>
        <RetroPanel icon={<ShieldAlert size={18} aria-hidden="true" />} title="Attention">
          <VideotexLog
            emptyMessage="No tasks need attention."
            rows={tasks
              .filter((task) => task.status === "blocked" || task.status === "failed")
              .map((task) => `${task.title} / ${formatTaskStatus(task)}`)}
          />
        </RetroPanel>
      </Workspace>

      <Workspace className="control-grid">
        <RetroPanel icon={<Activity size={18} aria-hidden="true" />} title="Agent Activity">
          <VideotexLog emptyMessage="Waiting for agent activity." rows={activityRows} />
        </RetroPanel>
        <RetroPanel icon={<FileCheck2 size={18} aria-hidden="true" />} title="Review Queue">
          <VideotexLog
            emptyMessage="No tasks are ready for review."
            rows={tasks.filter((task) => task.status === "review").map((task) => task.title)}
          />
        </RetroPanel>
        <RetroPanel icon={<ListChecks size={18} aria-hidden="true" />} title="Departments">
          <VideotexLog emptyMessage="No departments created." rows={departments.map((department) => department.name)} />
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

function formatAgentActivityEvent(event: ServerEvent, task?: TaskSummary): string {
  const title = task?.title ?? "Unknown task";
  return `${formatAgentActivityState(event)} · ${title} — ${formatAgentActivityDetail(event)}`;
}

function formatAgentActivityState(event: ServerEvent): string {
  switch (event.type) {
    case "task_started":
      return "Running";
    case "task_review":
      return "Ready for review";
    case "task_failed":
      return "Failed";
    case "task_blocked":
      return "Blocked";
    case "task_warning":
      return "Warning";
    case "partial_output":
      return "Partial output";
    default:
      return event.status ? titleCase(event.status) : "Activity";
  }
}

function formatAgentActivityDetail(event: ServerEvent): string {
  if (event.type === "task_started") {
    return event.effectiveTimeoutMs
      ? `Agent is working on this task. Budget: ${formatBudget(event.effectiveTimeoutMs)}.`
      : "Agent is working on this task.";
  }

  if (event.type === "task_review") {
    return "Proof is ready to inspect from the Proof menu.";
  }

  if (event.type === "task_failed") {
    return formatFailureDetail(event.failureReason);
  }

  if (event.type === "task_blocked") {
    return event.dependencyNote ?? cleanActivityMessage(event.message) ?? "Waiting for an approval or dependency.";
  }

  if (event.type === "task_warning") {
    return cleanActivityMessage(event.message) ?? "Needs attention before this task can continue.";
  }

  if (event.type === "partial_output") {
    return event.artifactWorkspacePath
      ? `${event.artifactWorkspacePath} is available for diagnosis, but it is not proof.`
      : "The agent left diagnostic output, but the task is not review-ready.";
  }

  return cleanActivityMessage(event.message) ?? "New task activity received.";
}

function formatFailureDetail(reason?: string): string {
  switch (reason) {
    case "timeout":
      return "Timed out before producing review-ready proof.";
    case "no_proof":
      return "Finished, but no required proof was captured.";
    case "proof_capture_failed":
      return "Finished, but proof capture failed.";
    case "dependency_failed":
      return "A required upstream task failed.";
    case "agent_failed":
      return "Agent run failed before review.";
    default:
      return "Task did not reach review.";
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
