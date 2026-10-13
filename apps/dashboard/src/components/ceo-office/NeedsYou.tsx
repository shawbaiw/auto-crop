import { FileCheck2, GitBranchPlus, Hand, Scale } from "lucide-react";
import type { ReactNode } from "react";
import type { CeoOfficeItemSummary, ReplanProposalSummary, TaskSummary, WaitStateSummary } from "../../api/client";
import { Button } from "@/components/ui";
import { useLanguage, type TranslationKey } from "../../ui/language";
import { departmentName, taskTitle } from "../../ui/language/localizedNames";
import type { CeoOfficeView } from "./CeoOfficeCard";

type NeedsYouSection = { key: "reviews" | "decisions" | "actions"; type: CeoOfficeItemSummary["type"]; icon: ReactNode };

const SECTIONS: NeedsYouSection[] = [
  { key: "reviews", type: "approval_request", icon: <FileCheck2 aria-hidden="true" /> },
  { key: "decisions", type: "decision_request", icon: <Scale aria-hidden="true" /> },
  { key: "actions", type: "human_action", icon: <Hand aria-hidden="true" /> },
];

/** The cards "Needs you" lists: open reviews, decisions and Human Actions, and new plans to confirm. */
export function needsYouCards(items: CeoOfficeItemSummary[], replanProposals: ReplanProposalSummary[]) {
  return {
    items: items.filter((item) => item.actionBearing && SECTIONS.some((section) => section.type === item.type)),
    plans: replanProposals.filter((proposal) => proposal.status === "proposed" && !proposal.stale),
  };
}

/**
 * The "Needs you" column of CEO Office (dashboard ADR 0002): overview counts, then a card for each
 * review, decision, Human Action and new plan. What is waiting or stuck is counted, not listed: the
 * founder acts on those from the department page or Operations Diagnostics.
 */
export function NeedsYou({
  items,
  message,
  replanProposals,
  tasks,
  view,
  waitStates,
}: {
  items: CeoOfficeItemSummary[];
  message: string | null;
  replanProposals: ReplanProposalSummary[];
  tasks: TaskSummary[];
  view: CeoOfficeView;
  waitStates: WaitStateSummary[];
}) {
  const { t } = useLanguage();
  const cards = needsYouCards(items, replanProposals);
  const planned = tasks.filter((task) => task.taskKind !== "department_subtask");
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const counts: Array<{ key: TranslationKey; value: string; tone: string }> = [
    { key: "ceoOffice.countDone", value: `${planned.filter((task) => task.status === "complete").length}/${planned.length}`, tone: "text-emerald-700" },
    { key: "ceoOffice.countRunning", value: String(planned.filter((task) => task.status === "running" || task.status === "retrying").length), tone: "text-blue-700" },
    { key: "ceoOffice.countStuck", value: String(planned.filter((task) => task.status === "blocked" || task.status === "needs_replan" || task.status === "failed").length), tone: "text-amber-800" },
    { key: "ceoOffice.countWaitingFor", value: String(waitStates.length), tone: "text-slate-600" },
  ];
  const empty = cards.items.length === 0 && cards.plans.length === 0;

  return (
    <div className="grid content-start gap-4">
      <dl aria-label={t("ceoOffice.overview")} className="grid grid-cols-4 gap-2 lg:grid-cols-2">
        {counts.map((count) => (
          <div className="grid gap-0.5 rounded-md bg-muted/60 px-2.5 py-2" key={count.key}>
            <dt className="truncate text-xs text-muted-foreground">{t(count.key)}</dt>
            <dd className={`m-0 text-lg font-semibold ${count.tone}`}>{count.value}</dd>
          </div>
        ))}
      </dl>
      {message ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          {message}
        </p>
      ) : null}
      {empty ? <p className="text-sm text-muted-foreground">{t("ceoOffice.nothingNeedsYou")}</p> : null}
      {SECTIONS.map((section) => {
        const sectionItems = cards.items.filter((item) => item.type === section.type);
        if (sectionItems.length === 0) return null;
        return (
          <section aria-label={t(`ceoOffice.${section.key}` as TranslationKey)} className="grid gap-2" key={section.key}>
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-800 [&_svg]:size-3.5">
              {section.icon}
              {t(`ceoOffice.${section.key}` as TranslationKey)}
            </h3>
            {sectionItems.map((item) => (
              <NeedsYouCard item={item} key={item.id} view={view} />
            ))}
          </section>
        );
      })}
      {cards.plans.length > 0 ? (
        <section aria-label={t("ceoOffice.newPlans")} className="grid gap-2">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-800 [&_svg]:size-3.5">
            <GitBranchPlus aria-hidden="true" />
            {t("ceoOffice.newPlans")}
          </h3>
          {cards.plans.map((proposal) => {
            const task = tasksById.get(proposal.sourceTaskId);
            return (
              <article className="grid gap-2 rounded-lg border border-l-4 border-border/80 border-l-amber-400 bg-card p-3 shadow-workbench" key={proposal.id}>
                <p className="text-sm">{t("ceoOffice.newPlanCard").replace("{task}", task ? taskTitle(task, view.ctx.locale) : proposal.sourceTaskId)}</p>
                <Button className="justify-self-start" onClick={view.onOpenOperations} size="sm" variant="outline">
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
    <article className="grid gap-1 rounded-lg border border-l-4 border-border/80 border-l-amber-400 bg-card p-3 shadow-workbench">
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
