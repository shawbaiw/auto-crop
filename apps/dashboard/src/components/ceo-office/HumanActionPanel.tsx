import { useState } from "react";
import type { CeoOfficeItemSummary } from "../../api/client";
import { Button, Input, Label } from "@/components/ui";
import type { WorkspaceHandlers } from "../workbench/workspaceHandlers";
import { useLanguage } from "../../ui/language";

type HumanActionItem = Extract<CeoOfficeItemSummary, { type: "human_action" }>;

/** Send back what an action outside Auto-Crop produced, one field per thing the task asked for. */
export function HumanActionPanel({
  item,
  onConfirm,
  onDone,
}: {
  item: HumanActionItem;
  onConfirm?: WorkspaceHandlers["onConfirmHumanAction"];
  onDone(message: string): void;
}) {
  const { t } = useLanguage();
  const requirements = item.data.confirmationRequirements.length > 0 ? item.data.confirmationRequirements : ["configuration_value"];
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (item.data.status !== "pending") {
    return <p className="text-sm text-muted-foreground">{t("ceoOffice.actionConfirmed")}</p>;
  }

  return (
    <form
      aria-label={t("ceoOffice.actions")}
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting || !onConfirm) return;
        setError(null);
        setSubmitting(true);
        try {
          await onConfirm(item.sourceId, Object.fromEntries(requirements.map((requirement) => [requirement, values[requirement] ?? ""])));
          onDone(t("ceoOffice.actionConfirmed"));
        } catch (confirmError) {
          setError((confirmError as Error).message);
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {requirements.map((requirement) => (
        <div className="grid gap-1.5" key={requirement}>
          <Label htmlFor={`${item.id}:${requirement}`}>{requirement}</Label>
          <Input
            id={`${item.id}:${requirement}`}
            onChange={(event) => setValues((current) => ({ ...current, [requirement]: event.target.value }))}
            value={values[requirement] ?? ""}
          />
        </div>
      ))}
      {error ? <p className="text-sm text-status-failed" role="alert">{error}</p> : null}
      <Button aria-busy={submitting} className="justify-self-end" disabled={submitting || !onConfirm} type="submit">
        {t("ceoOffice.confirmAction")}
      </Button>
    </form>
  );
}
