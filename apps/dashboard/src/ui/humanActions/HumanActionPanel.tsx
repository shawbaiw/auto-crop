import { useState } from "react";
import type { HumanActionSummary } from "../../api/client";
import { useLanguage } from "../language";
import { RetroButton } from "../retro";

type HumanActionPanelProps = {
  actions: HumanActionSummary[];
  onConfirm?: (humanActionId: string, evidence: Record<string, string>) => Promise<void> | void;
  title: string;
};

export function HumanActionPanel({ actions, onConfirm, title }: HumanActionPanelProps) {
  const { t } = useLanguage();
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="human-action-list" aria-label={title}>
      <h3>{title}</h3>
      {actions.length === 0 ? <p className="muted">{t("department.noHumanActions")}</p> : null}
      {actions.map((action) => {
        const requirements = requirementsFor(action);
        const isConfirmed = action.status === "confirmed";
        return (
          <article className="human-action-card" key={action.id}>
            <div>
              <p>{isConfirmed ? t("department.humanActionConfirmed") : t("department.humanActionPending")}</p>
              <h4>{action.label}</h4>
              <p className="muted">{`${t("department.blockedTasks")}: ${action.blockedTaskIds.length}`}</p>
            </div>
            {isConfirmed ? (
              <p className="system-message">{t("department.humanActionEvidenceAccepted")}</p>
            ) : (
              <>
                {requirements.map((requirement) => (
                  <label className="retro-field" key={`${action.id}-${requirement}`}>
                    <span>{requirement}</span>
                    <input
                      className="retro-input"
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [action.id]: {
                            ...(current[action.id] ?? {}),
                            [requirement]: event.target.value,
                          },
                        }))
                      }
                      value={drafts[action.id]?.[requirement] ?? ""}
                    />
                  </label>
                ))}
                <RetroButton
                  disabled={!onConfirm}
                  onClick={async () => {
                    if (!onConfirm) {
                      return;
                    }
                    setError(null);
                    try {
                      await onConfirm(action.id, evidenceFor(requirements, drafts[action.id] ?? {}));
                    } catch (confirmError) {
                      setError((confirmError as Error).message);
                    }
                  }}
                >
                  {t("department.confirmHumanAction")}
                </RetroButton>
              </>
            )}
          </article>
        );
      })}
      {error ? <p className="warning-message">{error}</p> : null}
    </section>
  );
}

function requirementsFor(action: HumanActionSummary): string[] {
  return action.confirmationRequirements.length > 0 ? action.confirmationRequirements : ["configuration_value"];
}

function evidenceFor(requirements: string[], draft: Record<string, string>): Record<string, string> {
  return Object.fromEntries(requirements.map((requirement) => [requirement, draft[requirement] ?? ""]));
}
