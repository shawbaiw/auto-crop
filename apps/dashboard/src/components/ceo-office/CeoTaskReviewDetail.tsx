import { useState } from "react";
import type {
  BusinessArtifactSummary,
  CeoReviewReturnReason,
  LocalizedText,
  ProofSummary,
  TaskAffordanceKind,
  TaskSummary,
} from "../../api/client";
import type { WorkspaceHandlers } from "../workbench/workspaceHandlers";
import { VideotexKeyValue } from "../../ui/data";
import { useLanguage } from "../../ui/language";
import { taskDescription, taskTitle } from "../../ui/language/localizedNames";
import { resolveLocalizedValue } from "../../ui/language/localizedText";
import { RetroButton } from "../../ui/retro";
import {
  formatArtifactKind,
  formatArtifactReviewStatus,
  formatArtifactRole,
  formatArtifactValidationStatus,
  formatCodeLabel,
  formatProofType,
} from "../../ui/tasks/formatDisplayValue";
import { formatTaskFailureReason, formatTaskStatus } from "../../ui/tasks/formatTaskStatus";
import { TaskStatusAction } from "../task/TaskStatusAction";
import { CeoReturnReasonFields } from "./CeoReturnReasonFields";
import type { CeoPendingItem } from "./ceoPendingItems";

export function CeoTaskReviewDetail({
  item,
  onDecision,
  onRefreshTask,
  onCreateReplanProposal,
  onRecoverTask,
  onConfirmTaskTermination,
  proofs,
  businessArtifacts,
}: {
  item: CeoPendingItem;
  onDecision: (input: {
    taskId: string;
    decision: "approve" | "return";
    returnReason?: CeoReviewReturnReason;
    note?: string;
  }) => Promise<void>;
  onRefreshTask?: WorkspaceHandlers["onRefreshTask"];
  onCreateReplanProposal?: WorkspaceHandlers["onCreateReplanProposal"];
  onRecoverTask?: WorkspaceHandlers["onRecoverTask"];
  onConfirmTaskTermination?: WorkspaceHandlers["onConfirmTaskTermination"];
  proofs: ProofSummary[];
  businessArtifacts: BusinessArtifactSummary[];
}) {
  const { language, t } = useLanguage();
  const [returnReason, setReturnReason] = useState<CeoReviewReturnReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"approve" | "return" | null>(null);
  const hasProof = proofs.length > 0;
  const currentArtifact = businessArtifacts.find((artifact) => artifact.isCurrent) ?? businessArtifacts[0] ?? null;
  const hasValidArtifact =
    currentArtifact !== null &&
    currentArtifact.validationStatus === "valid" &&
    currentArtifact.reviewStatus === "unreviewed" &&
    (currentArtifact.artifactKind === "deliverable" || currentArtifact.artifactKind === "final_report");
  const reviewAffordanceOffered = hasTaskAffordance(item.task, "ceo_review_decision");
  const canApprove = reviewAffordanceOffered && hasProof && hasValidArtifact;
  const canReturn = reviewAffordanceOffered;
  const reviewMessage = reviewAffordanceOffered
    ? canApprove ? t("department.ceoReviewCanPass") : t("department.ceoReviewMissingProof")
    : t("department.ceoReviewNoLongerOffered");
  const outcomeSummary = readOutcomeSummary(currentArtifact?.payload);

  const handleApprove = async () => {
    if (!canApprove || submittingAction) {
      return;
    }

    setError(null);
    setSubmittingAction("approve");
    try {
      await onDecision({ taskId: item.task.id, decision: "approve" });
    } catch (decisionError) {
      setError((decisionError as Error).message);
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleReturn = async () => {
    if (!canReturn || submittingAction) {
      return;
    }

    if (!returnReason) {
      setError(t("department.ceoReviewReturnReasonRequired"));
      return;
    }

    setError(null);
    setSubmittingAction("return");
    try {
      await onDecision({
        taskId: item.task.id,
        decision: "return",
        returnReason,
        note: note.trim() || undefined,
      });
    } catch (decisionError) {
      setError((decisionError as Error).message);
    } finally {
      setSubmittingAction(null);
    }
  };

  return (
    <section className="ceo-task-review-detail" aria-label={t("department.ceoTaskReview")}>
      <h3>{t("department.ceoTaskReview")}</h3>
      <p className={canApprove ? "system-message" : "warning-message"}>
        {reviewMessage}
      </p>
      <section className="ceo-task-review-detail__outcome">
        <h4>{t("department.ceoReviewOutcomeSummary")}</h4>
        {outcomeSummary ? (
          <p className="ceo-task-review-detail__outcome-text">
            {typeof outcomeSummary === "string"
              ? outcomeSummary
              : resolveLocalizedValue(outcomeSummary, language, outcomeSummary.en ?? "")}
          </p>
        ) : (
          <p className="muted">{t("department.ceoReviewNoOutcomeSummary")}</p>
        )}
      </section>
      <div className="ceo-task-review-detail__grid">
        <section>
          <h4>{t("department.ceoReviewTaskContent")}</h4>
          <p>{taskTitle(item.task, language)}</p>
          {item.task.description ? <p className="muted">{taskDescription(item.task, language)}</p> : null}
        </section>
        <details className="ceo-task-review-detail__evidence">
          <summary>{t("department.ceoReviewEvidenceValidation")}</summary>
          <h4>{t("department.ceoReviewDepartmentSubmission")}</h4>
          {proofs.length === 0 ? <p className="muted">{t("department.ceoReviewNoProof")}</p> : null}
          {proofs.map((proof) => (
            <article className="ceo-task-review-proof" key={proof.id}>
              <p>{resolveLocalizedValue(proof.summaryText, language, proof.summary)}</p>
              <p className="muted">{`${formatProofType(proof.type, t)} / ${proof.uri}`}</p>
            </article>
          ))}
          {currentArtifact ? (
            <article className="ceo-task-review-proof">
              <p>{`${formatArtifactKind(currentArtifact.artifactKind, t)} / ${formatArtifactRole(currentArtifact.artifactRole, t)} / ${formatCodeLabel(currentArtifact.artifactSubtype)}`}</p>
              <p className="muted">{`${formatArtifactValidationStatus(currentArtifact.validationStatus, t)} / ${formatArtifactReviewStatus(currentArtifact.reviewStatus, t)}`}</p>
            </article>
          ) : (
            <p className="muted">{t("dashboard.noBusinessArtifacts")}</p>
          )}
        </details>
        <section>
          <h4>{t("department.ceoReviewRunStatus")}</h4>
          <VideotexKeyValue
            items={[
              { label: t("department.status"), value: formatTaskStatus(item.task, t) },
              { label: t("department.ceoPendingReviewRequestFrom"), value: item.departmentName },
              ...(item.task.executionProfileName ? [{ label: t("department.executionProfile"), value: formatCodeLabel(item.task.executionProfileName) }] : []),
              ...(item.task.effectiveTimeoutMs ? [{ label: t("department.executionBudget"), value: `${Math.round(item.task.effectiveTimeoutMs / 60_000)}m` }] : []),
              ...(item.task.failureReason ? [{ label: t("department.executionIssue"), value: formatTaskFailureReason(item.task.failureReason, t) }] : []),
              ...(item.task.failureMessage ? [{ label: t("department.executionDetail"), value: item.task.failureMessage }] : []),
              ...(item.task.artifactWorkspacePath ? [{ label: t("department.partialOutput"), value: item.task.artifactWorkspacePath }] : []),
            ]}
          />
        </section>
        <section>
          <h4>{t("department.ceoReviewDecision")}</h4>
          {reviewAffordanceOffered ? (
            <>
              <CeoReturnReasonFields
                note={note}
                noteClassName="ceo-task-review-detail__note"
                noteLabel={t("department.ceoReviewNextStepNote")}
                onNoteChange={setNote}
                onReturnReasonChange={setReturnReason}
                reasonLabel={t("department.ceoReviewReturnReason")}
                returnReason={returnReason}
              />
              {error ? <p role="alert" className="warning-message">{error}</p> : null}
              <div className="ceo-task-review-detail__actions">
                {canApprove ? (
                  <RetroButton
                    aria-busy={submittingAction === "approve"}
                    className={submittingAction === "approve" ? "ceo-task-review-detail__action--submitting" : undefined}
                    disabled={submittingAction !== null}
                    onClick={handleApprove}
                  >
                    {t("department.ceoReviewApprove")}
                  </RetroButton>
                ) : null}
                <RetroButton
                  aria-busy={submittingAction === "return"}
                  className={submittingAction === "return" ? "ceo-task-review-detail__action--submitting" : undefined}
                  disabled={submittingAction !== null}
                  onClick={handleReturn}
                >
                  {t("department.ceoReviewReturn")}
                </RetroButton>
              </div>
            </>
          ) : (
            <TaskStatusAction
              onRefreshTask={onRefreshTask}
              onCreateReplanProposal={onCreateReplanProposal}
              onRecoverTask={onRecoverTask}
              onConfirmTaskTermination={onConfirmTaskTermination}
              showStatusBadge={false}
              task={item.task}
            />
          )}
        </section>
      </div>
    </section>
  );
}

function readOutcomeSummary(payload: unknown): LocalizedText | string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const value = record.outcome_summary ?? record.outcomeSummary;
  if (typeof value === "string") {
    return value.trim().length > 0 ? value.trim() : null;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.en === "string" || typeof candidate.zh === "string") {
      return candidate as LocalizedText;
    }
  }
  return null;
}

function hasTaskAffordance(task: TaskSummary, kind: TaskAffordanceKind): boolean {
  return (task.affordances ?? []).some((affordance) => affordance.kind === kind);
}
