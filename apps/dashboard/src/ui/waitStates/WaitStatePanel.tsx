import type { WaitStateSummary } from "../../api/client";
import { useLanguage } from "../language";

type WaitStatePanelProps = {
  title: string;
  waitStates: WaitStateSummary[];
};

export function WaitStatePanel({ title, waitStates }: WaitStatePanelProps) {
  const { t } = useLanguage();

  return (
    <section className="wait-state-list" aria-label={title}>
      <h3>{title}</h3>
      {waitStates.length === 0 ? <p className="muted">{t("department.noWaitStates")}</p> : null}
      {waitStates.map((waitState) => (
        <article className="wait-state-card" key={waitState.id}>
          <div>
            <p>{waitState.status === "ready_for_check_in" ? t("department.waitStateReady") : t("department.waitStateWaiting")}</p>
            <h4>{waitState.label}</h4>
            <p className="muted">{waitState.reason}</p>
          </div>
          <dl>
            <div>
              <dt>{t("department.waitStateNextCheck")}</dt>
              <dd>{waitState.nextCheckAt}</dd>
            </div>
            <div>
              <dt>{t("department.waitStateAffectedTasks")}</dt>
              <dd>{waitState.affectedTaskIds.length}</dd>
            </div>
          </dl>
        </article>
      ))}
    </section>
  );
}
