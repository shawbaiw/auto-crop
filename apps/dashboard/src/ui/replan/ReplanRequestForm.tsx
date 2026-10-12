import { useId, useState } from "react";
import type { ReplanMode } from "../../api/client";
import { useLanguage } from "../language";
import { RetroButton, RetroField, RetroSelect, RetroTextarea } from "../retro";

export type ReplanRequest = { mode: ReplanMode | null; note: string | null };

/**
 * Ask for a Replan Proposal. The founder may name the mode and add a note; without a mode the planner
 * picks one (ADR 0043). The note goes to the planner only — the task's agent sees what the founder later
 * confirms, which is why the form says so.
 */
export function ReplanRequestForm({
  taskTitle,
  onSubmit,
}: {
  taskTitle: string;
  onSubmit(request: ReplanRequest): Promise<void> | void;
}) {
  const { t } = useLanguage();
  const noteId = useId();
  const [mode, setMode] = useState<"auto" | ReplanMode>("auto");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ mode: mode === "auto" ? null : mode, note: note.trim() || null });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="replan-request">
      <p>
        {taskTitle} — {t("operations.replanAwaitingProposal")}
      </p>
      <RetroSelect
        label={`${t("operations.replanMode")} ${taskTitle}`}
        onValueChange={(value) => setMode(value as "auto" | ReplanMode)}
        options={[
          { value: "auto", label: t("operations.replanModeAuto") },
          { value: "revision", label: t("operations.replanModeRevision") },
          { value: "split", label: t("operations.replanModeSplit") },
        ]}
        value={mode}
      />
      <RetroField htmlFor={noteId} label={t("operations.replanNote")}>
        <RetroTextarea id={noteId} onChange={(event) => setNote(event.target.value)} rows={3} value={note} />
      </RetroField>
      <p className="muted">{t("operations.replanNoteHint")}</p>
      {error ? <p className="system-message system-message--danger">{error}</p> : null}
      <RetroButton disabled={submitting} onClick={() => void submit()} variant="primary">
        {t("operations.createReplanProposal")}
      </RetroButton>
    </div>
  );
}
