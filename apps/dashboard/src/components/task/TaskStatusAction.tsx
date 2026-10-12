import { GitBranchPlus, RefreshCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { FounderApprovalResponse, TaskRecoveryResponse, TaskRefreshResponse, TaskSummary } from "../../api/client";
import { useLanguage } from "../../ui/language";
import { taskTitle } from "../../ui/language/localizedNames";
import { resolveLocalizedValue } from "../../ui/language/localizedText";
import { RetroBadge, RetroButton } from "../../ui/retro";
import { TaskExecutionPanel } from "../../ui/tasks/TaskExecutionPanel";
import {
  inlineAffordanceControls,
  type InlineAffordanceButton,
  type InlineAffordanceHandler,
} from "../../ui/tasks/affordanceControls";
import { formatTaskStatus } from "../../ui/tasks/formatTaskStatus";

export function TaskStatusAction({
  onCreateReplanProposal,
  onDecideFounderApproval,
  onRecoverTask,
  onConfirmTaskTermination,
  onRefreshTask,
  showStatusBadge = true,
  task,
}: {
  onCreateReplanProposal?: (taskId: string) => Promise<unknown> | unknown | void;
  onDecideFounderApproval?: (
    approvalId: string,
    decision: "approved" | "denied",
  ) => Promise<FounderApprovalResponse> | FounderApprovalResponse | void;
  onRecoverTask?: (taskId: string) => Promise<TaskRecoveryResponse> | TaskRecoveryResponse | void;
  /** The founder attests the process holding this task's workspace is gone. */
  onConfirmTaskTermination?: (taskId: string) => Promise<unknown> | void;
  onRefreshTask?: (taskId: string) => Promise<TaskRefreshResponse> | TaskRefreshResponse | void;
  showStatusBadge?: boolean;
  task: TaskSummary;
}) {
  const { language, t } = useLanguage();
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  /**
   * One handler per inline affordance, keyed so the registry and the wiring cannot drift: adding an
   * inline affordance without a handler here is a compile error.
   */
  const handlers: Record<
    InlineAffordanceHandler,
    { available: boolean; icon: ReactNode; run: (button: InlineAffordanceButton, subjectId: string | null) => Promise<void> }
  > = {
    refresh: {
      available: Boolean(onRefreshTask),
      icon: <RefreshCcw size={14} aria-hidden="true" />,
      run: async () => {
        const response = await onRefreshTask?.(task.id);
        setActionMessage(response?.recovery?.message ?? null);
      },
    },
    recover: {
      available: Boolean(onRecoverTask),
      icon: <RefreshCcw size={14} aria-hidden="true" />,
      run: async () => {
        const response = await onRecoverTask?.(task.id);
        setActionMessage(response?.recovery?.message ?? null);
      },
    },
    confirmTermination: {
      available: Boolean(onConfirmTaskTermination),
      icon: <ShieldCheck size={14} aria-hidden="true" />,
      run: async () => {
        await onConfirmTaskTermination?.(task.id);
        setActionMessage(null);
      },
    },
    founderApproval: {
      available: Boolean(onDecideFounderApproval),
      icon: <ShieldCheck size={14} aria-hidden="true" />,
      run: async (button, subjectId) => {
        if (!subjectId || !button.decision) {
          return;
        }
        await onDecideFounderApproval?.(subjectId, button.decision);
        setActionMessage(null);
      },
    },
    requestReplan: {
      available: Boolean(onCreateReplanProposal),
      icon: <GitBranchPlus size={14} aria-hidden="true" />,
      run: async () => {
        await onCreateReplanProposal?.(task.id);
        setActionMessage(null);
      },
    },
  };

  // Drawn strictly from the server's Resume Affordances. The dashboard used to decide this with its
  // own predicates, which drifted from the server's guards and left a task at the Bounded Recovery
  // ceiling with no offered way forward at all (ADR 0020).
  const controls = inlineAffordanceControls(task.affordances ?? [])
    .filter((control) => handlers[control.handler].available);
  const holdReason = task.holds?.[0]
    ? resolveLocalizedValue(task.holds[0].reasonText, language, task.holds[0].reason)
    : null;

  if (!showStatusBadge && controls.length === 0 && !actionMessage && !task.execution && task.status !== "running" && task.status !== "retrying") {
    return null;
  }

  return (
    <div className="task-action-row">
      <TaskExecutionPanel task={task} />
      {showStatusBadge ? (
        <RetroBadge tone={task.status === "blocked" || task.status === "failed" ? "danger" : "signal"}>
          {taskTitle(task, language)} / {formatTaskStatus(task, t)}
        </RetroBadge>
      ) : null}
      {holdReason ? <p className="system-message">{holdReason}</p> : null}
      {controls.flatMap((control) =>
        control.buttons.map((button) => (
          <RetroButton
            aria-label={`${t(button.labelKey)} ${taskTitle(task, language)}`}
            icon={button.tone === "danger" ? <ShieldAlert size={14} aria-hidden="true" /> : handlers[control.handler].icon}
            key={`${control.kind}:${button.labelKey}`}
            onClick={() => handlers[control.handler].run(button, control.subjectId)}
            variant={button.tone === "danger" ? "danger" : undefined}
          >
            {t(button.labelKey)}
          </RetroButton>
        )),
      )}
      {actionMessage ? <p className="system-message">{actionMessage}</p> : null}
    </div>
  );
}
