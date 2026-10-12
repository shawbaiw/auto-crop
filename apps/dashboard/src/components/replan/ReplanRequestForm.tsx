import { useId, useState } from "react";
import type { ReplanMode } from "../../api/client";
import { Alert, Button, Label, Textarea } from "../ui";
import { useLanguage } from "../../ui/language";

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
  const modeId = useId();
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
    <div className="grid gap-3">
      <p className="text-sm">
        {taskTitle} — {t("operations.replanAwaitingProposal")}
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor={modeId}>{`${t("operations.replanMode")} ${taskTitle}`}</Label>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id={modeId}
          onChange={(event) => setMode(event.target.value as "auto" | ReplanMode)}
          value={mode}
        >
          <option value="auto">{t("operations.replanModeAuto")}</option>
          <option value="revision">{t("operations.replanModeRevision")}</option>
          <option value="split">{t("operations.replanModeSplit")}</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={noteId}>{t("operations.replanNote")}</Label>
        <Textarea id={noteId} onChange={(event) => setNote(event.target.value)} rows={3} value={note} />
        <p className="text-xs text-muted-foreground">{t("operations.replanNoteHint")}</p>
      </div>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <div>
        <Button disabled={submitting} onClick={() => void submit()}>
          {t("operations.createReplanProposal")}
        </Button>
      </div>
    </div>
  );
}
