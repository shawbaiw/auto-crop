import { Send } from "lucide-react";
import { useId, useState } from "react";
import type { CompanySummary } from "../../api/client";
import { Button } from "@/components/ui";
import { ComposerInput } from "../composer";
import { useLanguage } from "../../ui/language";

/** What a composer says, so CEO Office and a department page can share it. Defaults to CEO Office. */
export type ComposerCopy = { label: string; placeholder: string; hint: string };

/**
 * A text-only composer (dashboard ADR 0002). On CEO Office each message becomes a CEO Intake; on a
 * department page, a Department Intake (root ADR 0046). A paused company keeps the message until it
 * resumes; a stopped company takes none.
 */
export function CeoComposer({
  companyStatus,
  copy,
  draft,
  onDraftChange,
  onSubmit,
}: {
  companyStatus: CompanySummary["status"];
  copy?: ComposerCopy;
  draft: string;
  onDraftChange(value: string): void;
  onSubmit?: (body: string) => Promise<void> | void;
}) {
  const { t } = useLanguage();
  const inputId = useId();
  const hintId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopped = companyStatus === "stopped";
  const canSend = !stopped && draft.trim().length > 0 && !submitting;

  const send = async () => {
    if (!canSend) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit?.(draft.trim());
      onDraftChange("");
    } catch (sendError) {
      setError(t("ceoOffice.composerSendFailed").replace("{error}", (sendError as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="grid shrink-0 gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label className="sr-only" htmlFor={inputId}>
        {copy?.label ?? t("ceoOffice.composerLabel")}
      </label>
      <div className="relative">
        <ComposerInput
          aria-describedby={hintId}
          className="min-h-20 resize-none pr-14 text-sm sm:min-h-24 sm:text-base"
          disabled={stopped}
          id={inputId}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={copy?.placeholder ?? t("ceoOffice.composerPlaceholder")}
          value={draft}
        />
        <Button
          aria-busy={submitting}
          aria-label={t("ceoOffice.composerSend")}
          className="absolute bottom-2.5 right-2.5"
          disabled={!canSend}
          size="icon"
          type="submit"
        >
          <Send aria-hidden="true" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground" id={hintId}>
        {stopped ? t("ceoOffice.composerStopped") : companyStatus === "paused" ? t("ceoOffice.composerPaused") : copy?.hint ?? t("ceoOffice.composerHint")}
      </p>
      {error ? <p className="text-xs text-status-failed" role="alert">{error}</p> : null}
    </form>
  );
}
