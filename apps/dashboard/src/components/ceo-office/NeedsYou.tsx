import { ChevronDown, CircleArrowRight, Eye, GitBranchPlus, Hand, Scale } from "lucide-react";
import type { ReactNode } from "react";
import type { CeoOfficeItemSummary, TaskSummary, WaitStateSummary } from "../../api/client";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { taskStatusTone, taskStatusToneIcon, taskStatusToneIconClassName } from "../task/taskStatusTone";
import { useLanguage, type TranslationKey } from "../../ui/language";
import { departmentName, taskTitle } from "../../ui/language/localizedNames";
import type { CeoOfficeView } from "./CeoOfficeCard";
import type { NeedsYou as NeedsYouList } from "./deriveNeedsYou";

type NeedsYouSection = { key: "reviews" | "decisions" | "actions"; type: CeoOfficeItemSummary["type"]; icon: ReactNode };

const SECTIONS: NeedsYouSection[] = [
  { key: "reviews", type: "approval_request", icon: <Eye aria-hidden="true" /> },
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
          <div className="grid gap-0.5 rounded-[var(--r-reading)] bg-muted/60 px-2.5 py-2" key={count.key}>
            <dt className="truncate text-xs text-muted-foreground">{t(count.key)}</dt>
            <dd className="m-0 flex items-center gap-1.5 text-lg font-semibold text-foreground">
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-[var(--r-pill)] ${count.dot}`} />
              {count.value}
            </dd>
          </div>
        ))}
      </dl>
      {message ? (
        <p className="rounded-[var(--r-reading)] bg-status-success-bg px-3 py-2 text-sm text-status-success" role="status">
          {message}
        </p>
      ) : null}
      {empty ? <p className="text-sm text-muted-foreground">{t("ceoOffice.nothingNeedsYou")}</p> : null}
      {SECTIONS.map((section) => {
        const sectionItems = cards.items.filter((item) => item.type === section.type);
        if (sectionItems.length === 0) return null;
        return (
          <section aria-label={t(`ceoOffice.${section.key}` as TranslationKey)} className="grid gap-2" key={section.key}>
            <h3 className={sectionHeading}>
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
          <h3 className={sectionHeading}>
            <CircleArrowRight aria-hidden="true" />
            {t("ceoOffice.waitsOnYou")}
          </h3>
          {cards.tasks.map(({ task, kind }) => {
            const department = view.departmentsById.get(task.departmentId);
            return (
              <article className={row} key={task.id}>
                <p className="flex items-start gap-2 text-sm font-medium leading-snug">
                  <TaskIcon status={task.status} />
                  {taskTitle(task, view.ctx.locale)}
                </p>
                {department ? <p className="text-xs text-muted-foreground">{departmentName(department, view.ctx.locale)}</p> : null}
                <p className="text-sm text-muted-foreground">{t(`ceoOffice.waitsOnYouReason.${kind}` as TranslationKey)}</p>
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
          <h3 className={sectionHeading}>
            <GitBranchPlus aria-hidden="true" />
            {t("ceoOffice.newPlans")}
          </h3>
          {cards.plans.map((proposal) => {
            const task = tasksById.get(proposal.sourceTaskId);
            return (
              <article className={cn(row, "gap-2")} key={proposal.id}>
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

/** Each thing that needs the founder: a lighter reading surface in the panel, never a bordered card in a card. */
const row = "grid gap-1 rounded-[var(--r-reading)] bg-[color:var(--surface-reading)] p-3";
const sectionHeading = "flex items-center gap-2 text-[13px] font-semibold text-foreground [&_svg]:size-4";

/** A task's state as a bare icon: your turn in charcoal, a failure in coral, so the column is never all alarm. */
function TaskIcon({ status }: { status: string }) {
  const tone = taskStatusTone(status);
  const Icon = taskStatusToneIcon[tone];
  return <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", taskStatusToneIconClassName[tone], tone === "running" && "im-spin")} />;
}

/**
 * Where "Needs you" sits on a page: a panel beside the work on wide screens (spec §4, --aside-width),
 * folded above it on narrow ones so the work keeps the screen.
 */
export function NeedsYouFrame({ children, count, wide }: { children: ReactNode; count: number; wide: boolean }) {
  const { t } = useLanguage();
  if (wide) {
    return (
      <aside aria-label={t("ceoOffice.needsYou")} className={cn(panel, "min-h-0 overflow-y-auto p-5")}>
        <h2 className="mb-4 text-[17px] font-semibold leading-tight">{t("ceoOffice.needsYou")}</h2>
        {children}
      </aside>
    );
  }
  return (
    <details className={cn(panel, "group shrink-0")}>
      <summary className="flex min-h-[var(--hit-min)] cursor-pointer list-none items-center justify-between rounded-[var(--r-panel)] px-4 text-sm font-semibold outline-none focus-visible:shadow-[var(--focus-ring)]">
        {t("ceoOffice.needsYouSummary").replace("{count}", String(count))}
        <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="max-h-[40dvh] overflow-y-auto border-t border-[color:var(--edge-divider)] p-3">{children}</div>
    </details>
  );
}

const panel = "rounded-[var(--r-panel)] border border-[color:var(--edge-highlight)] bg-[color:var(--surface-panel)]";

function NeedsYouCard({ item, view }: { item: CeoOfficeItemSummary; view: CeoOfficeView }) {
  const { t } = useLanguage();
  const title = view.ctx.localize(item.titleText, item.title);
  const department = item.departmentId ? view.departmentsById.get(item.departmentId) : undefined;
  return (
    <article className={row}>
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
