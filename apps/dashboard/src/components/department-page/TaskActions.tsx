import { GitBranchPlus, RefreshCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { FounderApprovalResponse, TaskRecoveryResponse, TaskRefreshResponse, TaskSummary } from "../../api/client";
import { Button } from "@/components/ui";
import { useLanguage } from "../../ui/language";
import { taskTitle } from "../../ui/language/localizedNames";
import {
  inlineAffordanceControls,
  type InlineAffordanceButton,
  type InlineAffordanceHandler,
} from "../../ui/tasks/affordanceControls";

export type TaskActionHandlers = {
  onRefreshTask?: (taskId: string) => Promise<TaskRefreshResponse> | TaskRefreshResponse | void;
  onRecoverTask?: (taskId: string) => Promise<TaskRecoveryResponse> | TaskRecoveryResponse | void;
  onConfirmTaskTermination?: (taskId: string) => Promise<unknown> | void;
  onDecideFounderApproval?: (approvalId: string, decision: "approved" | "denied") => Promise<FounderApprovalResponse> | FounderApprovalResponse | void;
};

/**
 * The actions drawn on a task, strictly from the server's Resume Affordances through the inline
 * registry (ADR 0020). Asking for a new plan opens the plan request form, which the trace owns.
 */
export function TaskActions({
  handlers,
  locale,
  onRequestReplan,
  task,
}: {
  handlers: TaskActionHandlers;
  locale: "en" | "zh";
  onRequestReplan?: () => void;
  task: TaskSummary;
}) {
  const { t } = useLanguage();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // One entry per inline affordance handler: adding an inline affordance without one is a compile error.
  const run: Record<InlineAffordanceHandler, { available: boolean; icon: ReactNode; go: (button: InlineAffordanceButton, subjectId: string | null) => Promise<void> | void }> = {
    refresh: {
      available: Boolean(handlers.onRefreshTask),
      icon: <RefreshCcw aria-hidden="true" />,
      go: async () => setMessage((await handlers.onRefreshTask?.(task.id))?.recovery?.message ?? null),
    },
    recover: {
      available: Boolean(handlers.onRecoverTask),
      icon: <RefreshCcw aria-hidden="true" />,
      go: async () => setMessage((await handlers.onRecoverTask?.(task.id))?.recovery?.message ?? null),
    },
    confirmTermination: {
      available: Boolean(handlers.onConfirmTaskTermination),
      icon: <ShieldCheck aria-hidden="true" />,
      go: async () => { await handlers.onConfirmTaskTermination?.(task.id); },
    },
    founderApproval: {
      available: Boolean(handlers.onDecideFounderApproval),
      icon: <ShieldCheck aria-hidden="true" />,
      go: async (button, subjectId) => {
        if (subjectId && button.decision) await handlers.onDecideFounderApproval?.(subjectId, button.decision);
      },
    },
    requestReplan: {
      available: Boolean(onRequestReplan),
      icon: <GitBranchPlus aria-hidden="true" />,
      go: () => onRequestReplan?.(),
    },
  };
  const controls = inlineAffordanceControls(task.affordances ?? []).filter((control) => run[control.handler].available);
  if (controls.length === 0 && !message && !error) return null;

  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap gap-2">
        {controls.flatMap((control) =>
          control.buttons.map((button) => (
            <Button
              aria-label={`${t(button.labelKey)} ${taskTitle(task, locale)}`}
              disabled={busy}
              key={`${control.kind}:${button.labelKey}`}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await run[control.handler].go(button, control.subjectId);
                } catch (actionError) {
                  setError((actionError as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              size="sm"
              variant={button.tone === "danger" ? "destructive" : "outline"}
            >
              {button.tone === "danger" ? <ShieldAlert aria-hidden="true" /> : run[control.handler].icon}
              {t(button.labelKey)}
            </Button>
          )),
        )}
      </div>
      {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}
