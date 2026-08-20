import { Building2, ClipboardCheck, Crown, ListChecks } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type {
  AgentSummary,
  CompanySummary,
  DepartmentSummary,
  ObjectiveSummary,
  ServerEvent,
  TaskSummary,
} from "../api/client";
import { VideotexKeyValue, VideotexLog } from "../ui/data";
import { AppShell, PageHeader, Workspace } from "../ui/layout";
import { RetroBadge, RetroListRow, RetroPanel } from "../ui/retro";

export type DepartmentWorkspaceProps = {
  agents: AgentSummary[];
  company: CompanySummary;
  departments: DepartmentSummary[];
  menuBar?: ReactNode;
  objectives: ObjectiveSummary[];
  selectedCeoAgentId: string;
  tasks: TaskSummary[];
  events: ServerEvent[];
};

const ceoRoleId = "ceo";

export function DepartmentWorkspace({
  agents,
  company,
  departments,
  menuBar,
  objectives,
  selectedCeoAgentId,
  tasks,
  events,
}: DepartmentWorkspaceProps) {
  const [selectedRoleId, setSelectedRoleId] = useState(ceoRoleId);
  const selectedDepartment = departments.find((department) => department.id === selectedRoleId) ?? null;
  const selectedCeoAgent = agents.find((agent) => agent.id === selectedCeoAgentId) ?? null;
  const tasksByDepartment = useMemo(() => {
    const grouped = new Map(departments.map((department) => [department.id, [] as TaskSummary[]]));
    for (const task of tasks) {
      grouped.get(task.departmentId)?.push(task);
    }
    return grouped;
  }, [departments, tasks]);
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const activityRows = useMemo(
    () => events.map((event) => formatAgentActivityEvent(event, event.taskId ? tasksById.get(event.taskId) : undefined)),
    [events, tasksById],
  );

  return (
    <AppShell className="app-shell--workbench app-shell--department-workspace" menuBar={menuBar}>
      <PageHeader
        eyebrow="Department Workspace"
        status={company.status}
        statusIcon={<Building2 size={16} aria-hidden="true" />}
        title={company.name}
      />

      <Workspace className="department-workspace">
        <RetroPanel className="department-workspace__rail" icon={<ClipboardCheck size={18} aria-hidden="true" />} title="Departments">
          <RetroListRow
            meta={selectedCeoAgent?.name ?? selectedCeoAgentId}
            onClick={() => setSelectedRoleId(ceoRoleId)}
            selected={selectedRoleId === ceoRoleId}
            title="CEO"
          />
          {departments.map((department) => (
            <RetroListRow
              key={department.id}
              meta={String((tasksByDepartment.get(department.id) ?? []).length).padStart(2, "0")}
              onClick={() => setSelectedRoleId(department.id)}
              selected={selectedRoleId === department.id}
              title={department.name}
            />
          ))}
        </RetroPanel>

        <section className="department-workspace__main">
          {selectedDepartment ? (
            <RetroPanel icon={<ListChecks size={18} aria-hidden="true" />} title={`${selectedDepartment.name} Workspace`}>
              <div className="role-summary">
                <VideotexKeyValue
                  items={[
                    { label: "Role", value: selectedDepartment.name },
                    { label: "Lead", value: selectedDepartment.leadAgentId ?? "unassigned" },
                    { label: "Memory", value: selectedDepartment.memoryPath ?? "pending" },
                  ]}
                />
                <p>{selectedDepartment.responsibility}</p>
                <div>
                  {(tasksByDepartment.get(selectedDepartment.id) ?? []).map((task) => (
                    <RetroBadge key={task.id} tone="signal">
                      {task.title} / {formatTaskStatus(task)}
                    </RetroBadge>
                  ))}
                </div>
                <p className="muted">Department chat will be added later. Use queued tasks and proof views for execution.</p>
              </div>
            </RetroPanel>
          ) : (
            <RetroPanel icon={<Crown size={18} aria-hidden="true" />} title="CEO Workspace">
              <div className="role-summary">
                <VideotexKeyValue
                  items={[
                    { label: "CEO", value: selectedCeoAgent?.name ?? selectedCeoAgentId },
                    { label: "Status", value: company.status },
                    { label: "Playbook", value: company.playbookId },
                  ]}
                />
                <div>
                  <h3>Objectives</h3>
                  <VideotexLog emptyMessage="No objectives queued." rows={objectives.map((objective) => objective.title)} />
                </div>
                <div>
                  <h3>First Tasks</h3>
                  <VideotexLog emptyMessage="No tasks queued." rows={tasks.map((task) => `${task.title} / ${formatTaskStatus(task)}`)} />
                </div>
                <p className="muted">
                  Scheduler, proof, and review views are available from the menu.
                </p>
              </div>
            </RetroPanel>
          )}
          <RetroPanel title="Agent Activity">
            <VideotexLog emptyMessage="Waiting for agent activity." rows={activityRows} />
          </RetroPanel>
        </section>
      </Workspace>
    </AppShell>
  );
}

function formatTaskStatus(task: TaskSummary): string {
  const details = [task.status];

  if (task.failureReason) {
    details.push(task.failureReason);
  }

  if (task.failureReason === "timeout" && task.effectiveTimeoutMs) {
    details.push(formatBudget(task.effectiveTimeoutMs));
  }

  if (task.dependencyNote) {
    details.push(task.dependencyNote);
  }

  if (task.artifactWorkspacePath && task.status === "failed") {
    details.push(`Partial Output: ${task.artifactWorkspacePath}`);
  }

  return details.join(" · ");
}

function formatBudget(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
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
