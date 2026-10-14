import { OctagonX } from "lucide-react";
import { useId, useState } from "react";
import { Alert, Button, Input, Label } from "@/components/ui";
import { useLanguage } from "../../ui/language";
import type { WorkbenchCommand } from "./workbenchCommands";

/** Stop Operating is final, so the founder confirms it by typing the company name (ADR 0044). */
export type StopOperatingConfirmProps = {
  command: WorkbenchCommand;
  companyName: string;
  /** Overrides the command's own label and the explanation, for a company that never got a blueprint. */
  label?: string;
  explanation?: string;
  onStopped?(): void;
};

export function StopOperatingConfirm({ command, companyName, explanation, label, onStopped }: StopOperatingConfirmProps) {
  const { t } = useLanguage();
  const confirmId = useId();
  const [confirming, setConfirming] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!command.enabled) {
    return <p className="text-sm text-muted-foreground">{t("settings.stopUnavailable")}</p>;
  }

  async function stop() {
    setStopping(true);
    setError(null);
    try {
      await command.run();
      setConfirming(false);
      onStopped?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="grid gap-3 border-t border-border/70 pt-3">
      <p className="text-sm text-muted-foreground">{explanation ?? t("settings.stopExplanation")}</p>
      {confirming ? (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={confirmId}>{t("settings.stopConfirmLabel").replace("{name}", companyName)}</Label>
            <Input autoComplete="off" id={confirmId} onChange={(event) => setTypedName(event.target.value)} value={typedName} />
          </div>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={typedName.trim() !== companyName || stopping} onClick={() => void stop()} variant="destructive">
              <OctagonX aria-hidden="true" />
              {t("settings.stopConfirm")}
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                setTypedName("");
                setError(null);
              }}
              variant="outline"
            >
              {t("settings.stopCancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button onClick={() => setConfirming(true)} variant="outline">
            <OctagonX aria-hidden="true" />
            {label ?? t(command.labelKey)}
          </Button>
        </div>
      )}
    </div>
  );
}
