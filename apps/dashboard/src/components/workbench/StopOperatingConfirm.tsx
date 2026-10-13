import { OctagonX } from "lucide-react";
import { useId, useState } from "react";
import { PillButton } from "@/components/ice-mist";
import { Alert, Button, Input, Label } from "@/components/ui";
import { cn } from "@/lib/utils";
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
  /** Visual only: "ice-mist" renders the same flow with Ice Mist controls and no divider of its own. */
  appearance?: "default" | "ice-mist";
};

export function StopOperatingConfirm({ appearance = "default", command, companyName, explanation, label, onStopped }: StopOperatingConfirmProps) {
  const iceMist = appearance === "ice-mist";
  const { t } = useLanguage();
  const confirmId = useId();
  const [confirming, setConfirming] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!command.enabled) {
    return <p className={iceMist ? "text-[13px] font-medium text-[color:var(--text-secondary)]" : "text-sm text-muted-foreground"}>{t("settings.stopUnavailable")}</p>;
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

  function cancel() {
    setConfirming(false);
    setTypedName("");
    setError(null);
  }

  return (
    <div className={iceMist ? "grid gap-3" : "grid gap-3 border-t border-border/70 pt-3"}>
      <p className={iceMist ? "text-[13px] font-medium text-[color:var(--text-secondary)]" : "text-sm text-muted-foreground"}>
        {explanation ?? t("settings.stopExplanation")}
      </p>
      {confirming ? (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={confirmId}>{t("settings.stopConfirmLabel").replace("{name}", companyName)}</Label>
            <Input
              autoComplete="off"
              className={cn(
                iceMist &&
                  "h-[var(--hit-min)] rounded-[var(--r-pill)] border-[color:var(--text-secondary)] bg-[color:var(--surface-input)] px-4 text-[15px] text-[color:var(--text-primary)] focus-visible:shadow-[var(--focus-ring)] focus-visible:ring-0 focus-visible:ring-offset-0",
              )}
              id={confirmId}
              onChange={(event) => setTypedName(event.target.value)}
              value={typedName}
            />
          </div>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            {iceMist ? (
              <>
                <PillButton disabled={typedName.trim() !== companyName || stopping} onClick={() => void stop()} variant="danger">
                  <OctagonX aria-hidden="true" />
                  {t("settings.stopConfirm")}
                </PillButton>
                <PillButton onClick={cancel} variant="secondary">
                  {t("settings.stopCancel")}
                </PillButton>
              </>
            ) : (
              <>
                <Button disabled={typedName.trim() !== companyName || stopping} onClick={() => void stop()} variant="destructive">
                  <OctagonX aria-hidden="true" />
                  {t("settings.stopConfirm")}
                </Button>
                <Button onClick={cancel} variant="outline">
                  {t("settings.stopCancel")}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div>
          {iceMist ? (
            <PillButton onClick={() => setConfirming(true)} variant="danger">
              <OctagonX aria-hidden="true" />
              {label ?? t(command.labelKey)}
            </PillButton>
          ) : (
            <Button onClick={() => setConfirming(true)} variant="outline">
              <OctagonX aria-hidden="true" />
              {label ?? t(command.labelKey)}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
