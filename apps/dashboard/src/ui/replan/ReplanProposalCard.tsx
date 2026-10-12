import { useId, useState } from "react";
import type { ReplanProposalSummary, ReplanRequirementSummary, ReplanTaskDefinitionSummary, TaskSummary } from "../../api/client";
import { VideotexKeyValue, VideotexLog } from "../data";
import { useLanguage, type TranslationKey } from "../language";
import { resolveLocalizedValue } from "../language/localizedText";
import { RetroBadge, RetroButton, RetroField, RetroTextarea } from "../retro";
import { formatReplanProposalStatus } from "../tasks/formatDisplayValue";
import { formatTaskFailureReason, formatTaskStatus } from "../tasks/formatTaskStatus";

type Translate = (key: TranslationKey) => string;

/**
 * One Replan Proposal as the founder decides it. A Split shows the replacement chain and how consumers
 * are rewired; a Revision shows the task and every requirement it amends side by side, before and after,
 * because confirming it is one decision about what the company now accepts (ADR 0043). Whether a
 * proposal is stale comes from the server — the same comparison that refuses to confirm it.
 */
export function ReplanProposalCard({
  proposal,
  tasks,
  onConfirm,
  onReject,
}: {
  proposal: ReplanProposalSummary;
  tasks: TaskSummary[];
  onConfirm(proposalId: string): Promise<void> | void;
  onReject(proposalId: string, note: string | null): Promise<void> | void;
}) {
  const { language, t } = useLanguage();
  const rejectionId = useId();
  const [rejectionNote, setRejectionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const title = (taskId: string) => {
    const task = tasksById.get(taskId);
    return task ? resolveLocalizedValue(task.titleText, language, task.title) : taskId;
  };
  const sourceTask = tasksById.get(proposal.sourceTaskId);
  const mode = proposal.status === "failed" ? null : (proposal.mode ?? "split");
  const pending = proposal.status === "proposed";
  const stale = pending && proposal.stale === true;

  async function act(action: () => Promise<void> | void) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={stale ? "replan-card replan-card--stale" : "replan-card"}>
      <div className="replan-card__header">
        <p>
          {sourceTask ? title(sourceTask.id) : t("operations.unknownTask")} —{" "}
          {resolveLocalizedValue(proposal.rationaleText, language, proposal.rationale)}
        </p>
        <span>{formatReplanProposalStatus(proposal.status, t)}</span>
        {mode ? <RetroBadge tone="signal">{t(mode === "revision" ? "operations.replanModeLabelRevision" : "operations.replanModeLabelSplit")}</RetroBadge> : null}
      </div>
      {stale ? <p className="system-message system-message--danger">{t("operations.replanStale")}</p> : null}
      <VideotexKeyValue
        items={[
          { label: t("operations.proposalSource"), value: t(proposal.proposalSource === "planner_agent" ? "operations.generatedByPlanner" : "operations.generatedByTemplate") },
          { label: t("operations.plannerAgent"), value: proposal.plannerAgentId ?? t("operations.notAvailable") },
          { label: t("operations.plannerPrompt"), value: proposal.plannerPromptPath ?? t("operations.notAvailable") },
          {
            label: t("operations.replanRequested"),
            value: `${proposal.requestedMode ? t(proposal.requestedMode === "revision" ? "operations.replanModeLabelRevision" : "operations.replanModeLabelSplit") : t("operations.replanModeAuto")}${proposal.founderNote ? ` — ${proposal.founderNote}` : ""}`,
          },
          ...(proposal.plannerFailureReason
            ? [{
                label: t("operations.fallbackReason"),
                value: `${formatTaskFailureReason(proposal.plannerFailureReason, t)}: ${proposal.plannerFailureMessage ?? t("operations.notAvailable")}`,
              }]
            : []),
        ]}
      />
      {mode === "revision" ? (
        <RevisionChanges proposal={proposal} title={title} t={t} />
      ) : mode === "split" ? (
        <SplitChanges proposal={proposal} sourceTask={sourceTask} tasks={tasks} language={language} t={t} />
      ) : null}
      {error ? <p className="system-message system-message--danger">{error}</p> : null}
      {pending ? (
        <div className="replan-card__actions">
          <RetroButton disabled={busy || stale} onClick={() => void act(() => onConfirm(proposal.id))} variant="primary">
            {t("operations.confirmReplan")}
          </RetroButton>
          <RetroField htmlFor={rejectionId} label={t("operations.replanRejectionNote")}>
            <RetroTextarea id={rejectionId} onChange={(event) => setRejectionNote(event.target.value)} rows={2} value={rejectionNote} />
          </RetroField>
          <RetroButton disabled={busy} onClick={() => void act(() => onReject(proposal.id, rejectionNote.trim() || null))}>
            {t("operations.rejectReplan")}
          </RetroButton>
        </div>
      ) : (
        <p className="muted">{closedMessage(proposal, t)}</p>
      )}
    </div>
  );
}

function closedMessage(proposal: ReplanProposalSummary, t: Translate): string {
  switch (proposal.status) {
    case "confirmed":
      return t("operations.replanConfirmed");
    case "rejected":
      return proposal.rejectionNote ? `${t("operations.replanRejected")} ${proposal.rejectionNote}` : t("operations.replanRejected");
    case "dismissed":
      return t("operations.replanDismissed");
    case "failed":
      return t("operations.replanFailed");
    default:
      return formatReplanProposalStatus(proposal.status, t);
  }
}

/** The task as it is and as the Revision would make it, then every requirement it amends, side by side. */
function RevisionChanges({ proposal, title, t }: { proposal: ReplanProposalSummary; title(taskId: string): string; t: Translate }) {
  const before = proposal.taskBefore;
  const after = proposal.taskAfter;
  const fields: Array<{ key: TranslationKey; read(definition: ReplanTaskDefinitionSummary): string }> = [
    { key: "operations.replanFieldTitle", read: (definition) => definition.title },
    { key: "operations.replanFieldDescription", read: (definition) => definition.description },
    { key: "operations.replanFieldProofSchema", read: (definition) => definition.proofSchemaId },
    { key: "operations.replanFieldCapabilities", read: (definition) => definition.requiredCapabilities.join(", ") },
  ];
  return (
    <>
      <section className="replan-review-section">
        <h3>{t("operations.replanTaskChanges")}</h3>
        {before && after ? (
          <table className="replan-diff" aria-label={t("operations.replanTaskChanges")}>
            <thead>
              <tr>
                <th scope="col">{t("operations.replanField")}</th>
                <th scope="col">{t("operations.replanCurrent")}</th>
                <th scope="col">{t("operations.replanProposed")}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => {
                const was = field.read(before);
                const will = field.read(after);
                return (
                  <tr className={was === will ? undefined : "replan-diff__changed"} key={field.key}>
                    <th scope="row">{t(field.key)}</th>
                    <td>{was}</td>
                    <td>{will}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted">{t("operations.notAvailable")}</p>
        )}
        {proposal.capabilitiesChanged ? <p className="system-message">{t("operations.replanCapabilitiesChanged")}</p> : null}
      </section>
      <section className="replan-review-section">
        <h3>{t("operations.replanRequirementChanges")}</h3>
        {(proposal.requirementChanges ?? []).length === 0 ? <p className="muted">{t("operations.replanNoRequirementChanges")}</p> : null}
        {(proposal.requirementChanges ?? []).map((change) => (
          <table className="replan-diff" aria-label={`${t("operations.replanRequirementChanges")} ${title(change.verifierTaskId)}`} key={change.verifierTaskId}>
            <caption>{title(change.verifierTaskId)}</caption>
            <thead>
              <tr>
                <th scope="col">{t("operations.replanCurrent")}</th>
                <th scope="col">{t("operations.replanProposed")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="replan-diff__changed">
                <td><RequirementList requirements={change.before} /></td>
                <td><RequirementList requirements={change.after} /></td>
              </tr>
            </tbody>
          </table>
        ))}
        {(proposal.requirementSourceNotes ?? []).map((note) => (
          <p className="muted" key={note.verifierTaskId}>
            {title(note.verifierTaskId)} {t("operations.replanRequirementSourceConnector")} {title(note.producerTaskId)}.
          </p>
        ))}
      </section>
    </>
  );
}

function RequirementList({ requirements }: { requirements: ReplanRequirementSummary[] }) {
  return (
    <ul className="replan-diff__requirements">
      {requirements.map((requirement) => (
        <li key={requirement.id}>
          <code>{requirement.id}</code> {requirement.description}
        </li>
      ))}
    </ul>
  );
}

function SplitChanges({
  proposal,
  sourceTask,
  tasks,
  language,
  t,
}: {
  proposal: ReplanProposalSummary;
  sourceTask: TaskSummary | undefined;
  tasks: TaskSummary[];
  language: "en" | "zh";
  t: Translate;
}) {
  const affectedDownstreamTasks = tasks.filter((task) => task.dependsOnTaskIds?.includes(proposal.sourceTaskId));
  const finalReplacementTask = proposal.replacementTasks.at(-1);
  const taskTitle = (task: TaskSummary) => resolveLocalizedValue(task.titleText, language, task.title);
  return (
    <>
      <section className="replan-review-section">
        <h3>{t("operations.originalTask")}</h3>
        <VideotexLog
          emptyMessage={t("operations.unknownTask")}
          rows={sourceTask ? [`${taskTitle(sourceTask)} / ${formatTaskStatus(sourceTask, t)}`] : []}
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
        <VideotexLog emptyMessage={t("operations.noAffectedDownstream")} rows={affectedDownstreamTasks.map(taskTitle)} />
      </section>
      <section className="replan-review-section">
        <h3>{t("operations.rewirePreview")}</h3>
        <VideotexLog
          emptyMessage={t("operations.noRewirePreview")}
          rows={affectedDownstreamTasks.map((task) =>
            finalReplacementTask
              ? `${taskTitle(task)} ${t("operations.rewirePreviewConnector")} ${resolveLocalizedValue(finalReplacementTask.titleText, language, finalReplacementTask.title)}.`
              : `${taskTitle(task)} ${t("operations.rewirePreviewMissingFinalTask")}`,
          )}
        />
      </section>
    </>
  );
}
