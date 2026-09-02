import { Activity, Building2, FileCheck2, GitBranchPlus, ListChecks, ShieldAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { CompanySummary, DepartmentSummary, HumanActionSummary, ReplanProposalSummary, ServerEvent, TaskSummary, WaitStateSummary } from "../api/client";
import { VideotexKeyValue, VideotexLog } from "../ui/data";
import { HumanActionPanel } from "../ui/humanActions/HumanActionPanel";
import { useLanguage, type TranslationKey } from "../ui/language";
import { resolveLocalizedValue } from "../ui/language/localizedText";
import { AppShell, PageHeader, Workspace } from "../ui/layout";
import { RetroButton, RetroPanel } from "../ui/retro";
import { formatCodeLabel, formatCompanyStatus, formatReplanProposalStatus } from "../ui/tasks/formatDisplayValue";
import { formatTaskFailureReason, formatTaskStatus } from "../ui/tasks/formatTaskStatus";
import { WaitStatePanel } from "../ui/waitStates/WaitStatePanel";

export type CompanyOperationsProps = {
  company: CompanySummary;
  departments: DepartmentSummary[];
  events: ServerEvent[];
  humanActions: HumanActionSummary[];
  isPaused: boolean;
  menuBar?: ReactNode;
  onConfirmHumanAction(humanActionId: string, evidence: Record<string, string>): Promise<void> | void;
  onConfirmReplanProposal(proposalId: string): void;
  onCreateReplanProposal(taskId: string): void;
  replanProposals: ReplanProposalSummary[];
  tasks: TaskSummary[];
  waitStates: WaitStateSummary[];
};

export function CompanyOperations({
  company,
  departments,
  events,
  humanActions,
  isPaused,
  menuBar,
  onConfirmHumanAction,
  onConfirmReplanProposal,
  onCreateReplanProposal,
  replanProposals,
  tasks,
  waitStates,
}: CompanyOperationsProps) {
  const { language, t } = useLanguage();
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const activityRows = useMemo(
    () => events.map((event) => formatAgentActivityEvent(event, event.taskId ? tasksById.get(event.taskId) : undefined, language, t)),
    [events, tasksById, language, t],
  );
  const replanSourceTaskIds = useMemo(() => new Set(replanProposals.map((proposal) => proposal.sourceTaskId)), [replanProposals]);
  const tasksAwaitingReplanProposal = tasks.filter(
    (task) => task.status === "needs_replan" && !replanSourceTaskIds.has(task.id),
  );
  const taskCounts = countTaskStates(tasks);

  return (
    <AppShell className="app-shell--workbench" menuBar={menuBar}>
      <PageHeader
        eyebrow={company.name}
        status={formatCompanyStatus(company.status, t)}
        statusIcon={<Activity size={16} aria-hidden="true" />}
        title={t("operations.title")}
      />
      {isPaused ? <section className="system-message system-message--danger">{t("app.globalPause")}</section> : null}

      <Workspace className="operations-grid">
        <RetroPanel icon={<Building2 size={18} aria-hidden="true" />} title={t("operations.companyState")} variant="inverted">
          <VideotexKeyValue
            items={[
              { label: t("operations.state"), value: formatCompanyStatus(company.status, t) },
              { label: t("operations.playbook"), value: company.playbookId },
              { label: t("operations.departments"), value: String(departments.length).padStart(2, "0") },
            ]}
          />
        </RetroPanel>
        <RetroPanel icon={<ListChecks size={18} aria-hidden="true" />} title={t("operations.taskFlow")}>
          <VideotexKeyValue
            items={[
              { label: t("operations.running"), value: String(taskCounts.running).padStart(2, "0") },
              { label: t("operations.waiting"), value: String(taskCounts.waiting_dependency).padStart(2, "0") },
              { label: t("operations.retrying"), value: String(taskCounts.retrying).padStart(2, "0") },
              { label: t("operations.review"), value: String(taskCounts.review).padStart(2, "0") },
              { label: t("operations.blocked"), value: String(taskCounts.blocked).padStart(2, "0") },
              { label: t("operations.needsReplan"), value: String(taskCounts.needs_replan).padStart(2, "0") },
              { label: t("operations.failed"), value: String(taskCounts.failed).padStart(2, "0") },
            ]}
          />
        </RetroPanel>
        <RetroPanel icon={<ShieldAlert size={18} aria-hidden="true" />} title={t("operations.attention")}>
          <HumanActionPanel
            actions={humanActions.filter((action) => action.status === "pending")}
            onConfirm={onConfirmHumanAction}
            title={t("department.humanActions")}
          />
          <WaitStatePanel title={t("department.waitStates")} waitStates={waitStates} />
          <VideotexLog
            emptyMessage={
              humanActions.some((action) => action.status === "pending") || waitStates.length > 0 ? "" : t("operations.noAttention")
            }
            rows={tasks
              .filter((task) => task.status === "blocked" || task.status === "failed" || task.status === "needs_replan")
              .map((task) => `${taskTitle(task, language)} / ${formatTaskStatus(task, t)}`)}
          />
        </RetroPanel>
      </Workspace>

      <Workspace>
        <RetroPanel icon={<GitBranchPlus size={18} aria-hidden="true" />} title={t("operations.replanProposals")}>
          <div className="replan-proposals">
            {tasksAwaitingReplanProposal.map((task) => (
              <div className="replan-card" key={task.id}>
                <p>
                  {taskTitle(task, language)} — {t("operations.replanAwaitingProposal")}
                </p>
                <RetroButton onClick={() => onCreateReplanProposal(task.id)} variant="primary">
                  {t("operations.createReplanProposal")}
                </RetroButton>
              </div>
            ))}

            {replanProposals.length === 0 && tasksAwaitingReplanProposal.length === 0 ? (
              <p className="muted">{t("operations.noReplanProposals")}</p>
            ) : null}

            {replanProposals.map((proposal) => {
              const sourceTask = tasksById.get(proposal.sourceTaskId);
              const affectedDownstreamTasks = tasks.filter((task) => task.dependsOnTaskIds?.includes(proposal.sourceTaskId));
              const finalReplacementTask = proposal.replacementTasks.at(-1);
              return (
                <div className="replan-card" key={proposal.id}>
                  <div className="replan-card__header">
                    <p>
                      {sourceTask ? taskTitle(sourceTask, language) : t("operations.unknownTask")} —{" "}
                      {resolveLocalizedValue(proposal.rationaleText, language, proposal.rationale)}
                    </p>
                    <span>{formatReplanProposalStatus(proposal.status, t)}</span>
                  </div>
                  <VideotexKeyValue
                    items={[
                      { label: t("operations.proposalSource"), value: formatProposalSource(proposal.proposalSource, t) },
                      {
                        label: t("operations.plannerAgent"),
                        value: proposal.plannerAgentId ?? t("operations.notAvailable"),
                      },
                      {
                        label: t("operations.plannerPrompt"),
                        value: proposal.plannerPromptPath ?? t("operations.notAvailable"),
                      },
                      ...(proposal.plannerFailureReason
                        ? [
                            {
                              label: t("operations.fallbackReason"),
                              value: `${formatTaskFailureReason(proposal.plannerFailureReason, t)}: ${proposal.plannerFailureMessage ?? t("operations.notAvailable")}`,
                            },
                          ]
                        : []),
                    ]}
                  />
                  <section className="replan-review-section">
                    <h3>{t("operations.originalTask")}</h3>
                    <VideotexLog
                      emptyMessage={t("operations.unknownTask")}
                      rows={sourceTask ? [`${taskTitle(sourceTask, language)} / ${formatTaskStatus(sourceTask, t)}`] : []}
                    />
                  </section>
                  <section className="replan-review-section">
                    <h3>{t("operations.replacementChain")}</h3>
                    <VideotexLog
                      emptyMessage={t("operations.noReplacementTasks")}
                      rows={proposal.replacementTasks.map((task) => resolveLocalizedValue(task.titleText, language, task.title))}
                    />
                  </section>
                  <section className="replan-review-section">
                    <h3>{t("operations.affectedDownstream")}</h3>
                    <VideotexLog
                      emptyMessage={t("operations.noAffectedDownstream")}
                      rows={affectedDownstreamTasks.map((task) => taskTitle(task, language))}
                    />
                  </section>
                  <section className="replan-review-section">
                    <h3>{t("operations.rewirePreview")}</h3>
                    <VideotexLog
                      emptyMessage={t("operations.noRewirePreview")}
                      rows={affectedDownstreamTasks.map((task) =>
                        finalReplacementTask
                          ? `${taskTitle(task, language)} ${t("operations.rewirePreviewConnector")} ${resolveLocalizedValue(finalReplacementTask.titleText, language, finalReplacementTask.title)}.`
                          : `${taskTitle(task, language)} ${t("operations.rewirePreviewMissingFinalTask")}`,
                      )}
                    />
                  </section>
                  {proposal.status === "proposed" ? (
                    <RetroButton onClick={() => onConfirmReplanProposal(proposal.id)} variant="primary">
                      {t("operations.confirmReplan")}
                    </RetroButton>
                  ) : (
                    <p className="muted">{t("operations.replanConfirmed")}</p>
                  )}
                </div>
              );
            })}
          </div>
        </RetroPanel>
      </Workspace>

      <Workspace className="control-grid">
        <RetroPanel icon={<Activity size={18} aria-hidden="true" />} title={t("operations.agentActivity")}>
          <VideotexLog emptyMessage={t("operations.waitingActivity")} rows={activityRows} />
        </RetroPanel>
        <RetroPanel icon={<FileCheck2 size={18} aria-hidden="true" />} title={t("operations.reviewQueue")}>
          <VideotexLog
            emptyMessage={t("operations.noReviewTasks")}
            rows={tasks
              .filter((task) => task.taskKind !== "department_subtask" && task.status === "review")
              .map((task) => taskTitle(task, language))}
          />
        </RetroPanel>
        <RetroPanel icon={<ListChecks size={18} aria-hidden="true" />} title={t("operations.departments")}>
          <VideotexLog
            emptyMessage={t("operations.noDepartments")}
            rows={departments.map((department) => resolveLocalizedValue(department.nameText, language, department.name))}
          />
        </RetroPanel>
      </Workspace>
    </AppShell>
  );
}

function formatProposalSource(source: ReplanProposalSummary["proposalSource"], t: (key: TranslationKey) => string): string {
  if (source === "planner_agent") {
    return t("operations.generatedByPlanner");
  }

  return t("operations.generatedByTemplate");
}

function countTaskStates(tasks: TaskSummary[]) {
  return tasks.reduce(
    (counts, task) => ({
      ...counts,
      [task.status]: (counts[task.status as keyof typeof counts] ?? 0) + 1,
    }),
    { blocked: 0, failed: 0, needs_replan: 0, retrying: 0, review: 0, running: 0, waiting_dependency: 0 },
  );
}

function formatAgentActivityEvent(event: ServerEvent, task: TaskSummary | undefined, language: "en" | "zh", t: (key: TranslationKey) => string): string {
  const title = task ? taskTitle(task, language) : t("operations.unknownTask");
  return `${formatAgentActivityState(event, t)} · ${title} — ${formatAgentActivityDetail(event, language, t)}`;
}

function formatAgentActivityState(event: ServerEvent, t: (key: TranslationKey) => string): string {
  switch (event.type) {
    case "task_started":
      return t("operations.running");
    case "dependency_waiting":
      return t("operations.waiting");
    case "task_retrying":
      return t("operations.retrying");
    case "task_needs_replan":
      return t("operations.needsReplan");
    case "deliverable_missing":
      return t("operations.missingDeliverable");
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
      return event.status ? formatCodeLabel(event.status) : t("operations.activity");
  }
}

function formatAgentActivityDetail(event: ServerEvent, language: "en" | "zh", t: (key: TranslationKey) => string): string {
  if (event.type === "task_started") {
    return event.effectiveTimeoutMs
      ? `${t("operations.agentWorking")} ${t("operations.budget")}: ${formatBudget(event.effectiveTimeoutMs)}.`
      : t("operations.agentWorking");
  }

  if (event.type === "task_review") {
    return t("operations.proofReady");
  }

  if (event.type === "dependency_waiting") {
    return event.dependencyNote ?? cleanActivityMessage(resolveLocalizedValue(event.messageText, language, event.message)) ?? t("operations.waitingDependencyProof");
  }

  if (event.type === "task_retrying") {
    return t("operations.retryingBudget");
  }

  if (event.type === "task_needs_replan") {
    return t("operations.needsReplanDetail");
  }

  if (event.type === "deliverable_missing") {
    return event.dependencyNote ?? t("operations.missingDeliverableDetail");
  }

  if (event.type === "task_failed") {
    return formatFailureDetail(event.failureReason, t);
  }

  if (event.type === "task_blocked") {
    return event.dependencyNote ?? cleanActivityMessage(resolveLocalizedValue(event.messageText, language, event.message)) ?? t("operations.waitingDependency");
  }

  if (event.type === "task_warning") {
    return cleanActivityMessage(resolveLocalizedValue(event.messageText, language, event.message)) ?? t("operations.needsAttention");
  }

  if (event.type === "partial_output") {
    return event.artifactWorkspacePath
      ? `${event.artifactWorkspacePath} ${t("operations.diagnosticPath")}`
      : t("operations.diagnosticOnly");
  }

  return cleanActivityMessage(resolveLocalizedValue(event.messageText, language, event.message)) ?? t("operations.newActivity");
}

function taskTitle(task: TaskSummary, language: "en" | "zh"): string {
  return resolveLocalizedValue(task.titleText, language, task.title);
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
    case "missing_deliverable":
      return t("operations.failureMissingDeliverable");
    case "needs_replan":
      return t("operations.needsReplanDetail");
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
