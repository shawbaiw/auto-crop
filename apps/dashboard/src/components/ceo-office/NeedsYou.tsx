import { CircleArrowRight, FileCheck2, GitBranchPlus, Hand, Scale } from "lucide-react";
import type { ReactNode } from "react";
import type { CeoOfficeItemSummary, TaskSummary, WaitStateSummary } from "../../api/client";
import { Button } from "@/components/ui";
import { useLanguage, type TranslationKey } from "../../ui/language";
import { departmentName, taskTitle } from "../../ui/language/localizedNames";
import type { CeoOfficeView } from "./CeoOfficeCard";
import type { NeedsYou as NeedsYouList } from "./deriveNeedsYou";

type NeedsYouSection = { key: "reviews" | "decisions" | "actions"; type: CeoOfficeItemSummary["type"]; icon: ReactNode };

const SECTIONS: NeedsYouSection[] = [
  { key: "reviews", type: "approval_request", icon: <FileCheck2 aria-hidden="true" /> },
  { key: "decisions", type: "decision_request", icon: <Scale aria-hidden="true" /> },
  { key: "actions", type: "human_action", icon: <Hand aria-hidden="true" /> },
];

/**
 * The "Needs you" column of CEO Office (dashboard ADR 0002): overview counts, then a card for each
 * review, decision, Human Action and new plan, and for each task only the founder can move. What is
 * waiting, or stuck in a way the runtime can still handle, is counted, not listed.
 */
export function NeedsYou({
  message,
  needs: cards,
  tasks,
  view,
  waitStates,
}: {
  message: string | null;
  needs: NeedsYouList;
  tasks: TaskSummary[];
  view: CeoOfficeView;
  waitStates: WaitStateSummary[];
}) {
  const { t } = useLanguage();
  const planned = tasks.filter((task) => task.taskKind !== "department_subtask");
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  // Numbers stay charcoal; a small dot in the state's icon color says which state each counts.
  const counts: Array<{ key: TranslationKey; value: string; dot: string }> = [
    { key: "ceoOffice.countDone", value: `${planned.filter((task) => task.status === "complete").length}/${planned.length}`, dot: "bg-status-success-icon" },
    { key: "ceoOffice.countRunning", value: String(planned.filter((task) => task.status === "running" || task.status === "retrying").length), dot: "bg-status-running-icon" },
    { key: "ceoOffice.countStuck", value: String(planned.filter((task) => task.status === "blocked" || task.status === "needs_replan" || task.status === "failed").length), dot: "bg-[color:var(--status-your-turn-bg)]" },
    { key: "ceoOffice.countWaitingFor", value: String(waitStates.length), dot: "bg-status-neutral-icon" },
  ];
  const empty = cards.items.length === 0 && cards.plans.length === 0 && cards.tasks.length === 0;

  return (
    <div className="grid content-start gap-4">
      <dl aria-label={t("ceoOffice.overview")} className="grid grid-cols-4 gap-2 lg:grid-cols-2">
        {counts.map((count) => (
          <div className="grid gap-0.5 rounded-md bg-muted/60 px-2.5 py-2" key={count.key}>
            <dt className="truncate text-xs text-muted-foreground">{t(count.key)}</dt>
            <dd className="m-0 flex items-center gap-1.5 text-lg font-semibold text-foreground">
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-[var(--r-pill)] ${count.dot}`} />
              {count.value}
            </dd>
          </div>
        ))}
      </dl>
      {message ? (
        <p className="rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success" role="status">
          {message}
        </p>
      ) : null}
      {empty ? <p className="text-sm text-muted-foreground">{t("ceoOffice.nothingNeedsYou")}</p> : null}
      {SECTIONS.map((section) => {
        const sectionItems = cards.items.filter((item) => item.type === section.type);
        if (sectionItems.length === 0) return null;
        return (
          <section aria-label={t(`ceoOffice.${section.key}` as TranslationKey)} className="grid gap-2" key={section.key}>
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground [&_svg]:size-3.5">
              {section.icon}
              {t(`ceoOffice.${section.key}` as TranslationKey)}
            </h3>
            {sectionItems.map((item) => (
              <NeedsYouCard item={item} key={item.id} view={view} />
            ))}
          </section>
        );
      })}
      {cards.tasks.length > 0 ? (
        <section aria-label={t("ceoOffice.waitsOnYou")} className="grid gap-2">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground [&_svg]:size-3.5">
            <CircleArrowRight aria-hidden="true" />
            {t("ceoOffice.waitsOnYou")}
          </h3>
          {cards.tasks.map(({ task, kind }) => {
            const department = view.departmentsById.get(task.departmentId);
            return (
              <article className="grid gap-1 rounded-lg border border-border/80 bg-card p-3 shadow-workbench" key={task.id}>
                <p className="text-sm font-medium leading-snug">{taskTitle(task, view.ctx.locale)}</p>
                {department ? <p className="text-xs text-muted-foreground">{departmentName(department, view.ctx.locale)}</p> : null}
                <p className="text-sm text-foreground/80">{t(`ceoOffice.waitsOnYouReason.${kind}` as TranslationKey)}</p>
                <Button className="mt-1 justify-self-start" onClick={() => view.onOpenTask(task.id)} size="sm" variant="outline">
                  {t("ceoOffice.openDepartmentPage")}
                </Button>
              </article>
            );
          })}
        </section>
      ) : null}
      {cards.plans.length > 0 ? (
        <section aria-label={t("ceoOffice.newPlans")} className="grid gap-2">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground [&_svg]:size-3.5">
            <GitBranchPlus aria-hidden="true" />
            {t("ceoOffice.newPlans")}
          </h3>
          {cards.plans.map((proposal) => {
            const task = tasksById.get(proposal.sourceTaskId);
            return (
              <article className="grid gap-2 rounded-lg border border-border/80 bg-card p-3 shadow-workbench" key={proposal.id}>
                <p className="text-sm">{t("ceoOffice.newPlanCard").replace("{task}", task ? taskTitle(task, view.ctx.locale) : proposal.sourceTaskId)}</p>
                <Button className="justify-self-start" onClick={() => view.onOpenTask(proposal.sourceTaskId)} size="sm" variant="outline">
                  {t("ceoOffice.openNewPlan")}
                </Button>
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function NeedsYouCard({ item, view }: { item: CeoOfficeItemSummary; view: CeoOfficeView }) {
  const { t } = useLanguage();
  const title = view.ctx.localize(item.titleText, item.title);
  const department = item.departmentId ? view.departmentsById.get(item.departmentId) : undefined;
  return (
    <article className="grid gap-1 rounded-lg border border-border/80 bg-card p-3 shadow-workbench">
      <p className="text-sm font-medium leading-snug">{title}</p>
      {department ? <p className="text-xs text-muted-foreground">{departmentName(department, view.ctx.locale)}</p> : null}
      <Button
        aria-label={t("ceoOffice.openItem").replace("{title}", title)}
        className="mt-1 justify-self-start"
        onClick={() => view.onOpenItem(item)}
        size="sm"
      >
        {t("ceoOffice.open")}
      </Button>
    </article>
  );
}
