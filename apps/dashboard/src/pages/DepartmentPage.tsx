import { useEffect, useMemo, useState } from "react";
import type {
  AgentSummary,
  BusinessArtifactSummary,
  CeoOfficeItemSummary,
  CompanySummary,
  DepartmentSummary,
  ProofSummary,
  ReplanProposalSummary,
  TaskProgressEventSummary,
  TaskSummary,
  WaitStateSummary,
} from "../api/client";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { CeoComposer } from "../components/ceo-office/CeoComposer";
import { CeoOfficeCard } from "../components/ceo-office/CeoOfficeCard";
import { CeoOfficeItemDialog, type CeoOfficeActions } from "../components/ceo-office/CeoOfficeItemDialog";
import { deriveNeedsYou, needsYouCount, needsYouForDepartment } from "../components/ceo-office/deriveNeedsYou";
import { NeedsYou, NeedsYouFrame } from "../components/ceo-office/NeedsYou";
import { useOfficeView } from "../components/ceo-office/useOfficeView";
import { ExecutionTrace, type ReplanHandlers } from "../components/department-page/ExecutionTrace";
import type { TaskActionHandlers } from "../components/department-page/TaskActions";
import { expandedByDefault, traceState } from "../components/department-page/traceModel";
import { AgentIcon } from "../components/workbench/AgentIcon";
import { useLanguage } from "../ui/language";
import { departmentName, departmentResponsibility } from "../ui/language/localizedNames";
import { resolveLocalizedValue } from "../ui/language/localizedText";

export type DepartmentPageProps = CeoOfficeActions & TaskActionHandlers & ReplanHandlers & {
  agents: AgentSummary[];
  businessArtifacts: BusinessArtifactSummary[];
  ceoOfficeItems: CeoOfficeItemSummary[];
  company: CompanySummary;
  departmentId: string;
  departments: DepartmentSummary[];
  /** A task to bring into view when the page opens, such as one whose new plan the founder followed. */
  focusTaskId: string | null;
  onCreateDepartmentIntake(departmentId: string, body: string): Promise<void> | void;
  onFocusHandled(): void;
  onOpenCeoOffice(): void;
  onOpenDepartment(departmentId: string): void;
  onOpenTask(taskId: string): void;
  progressEvents: TaskProgressEventSummary[];
  proof: ProofSummary[];
  replanProposals: ReplanProposalSummary[];
  tasks: TaskSummary[];
  waitStates: WaitStateSummary[];
};

/**
 * A department's page (dashboard ADR 0002): its responsibility and working agents; each task as an
 * Execution Trace; a composer that sends a Department Intake (root ADR 0046); and what in this
 * department needs the founder. New plans are requested, reviewed and confirmed here.
 */
export function DepartmentPage(props: DepartmentPageProps) {
  const { agents, company, departmentId, departments, focusTaskId, onFocusHandled, progressEvents, replanProposals, tasks, waitStates } = props;
  const { language, t } = useLanguage();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [draft, setDraft] = useState("");
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // A founder's own open or fold of a trace holds while the page is open; live updates never reset it.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [replanForms, setReplanForms] = useState<Set<string>>(new Set());
  const now = useNow();

  const { items, view } = useOfficeView({
    company,
    ceoOfficeItems: props.ceoOfficeItems,
    departments,
    tasks,
    lastSeen: null,
    actions: {
      onOpenItem: (item) => {
        setMessage(null);
        setOpenItemId(item.id);
      },
      onOpenDepartment: (id) => {
        setOpenItemId(null);
        props.onOpenDepartment(id);
      },
      onOpenTask: (taskId) => {
        setOpenItemId(null);
        props.onOpenTask(taskId);
      },
      onOpenCeoOffice: () => {
        setOpenItemId(null);
        props.onOpenCeoOffice();
      },
    },
  });
  const department = departments.find((candidate) => candidate.id === departmentId) ?? null;
  const departmentTasks = useMemo(
    () => tasks.filter((task) => task.departmentId === departmentId && task.taskKind !== "department_subtask"),
    [departmentId, tasks],
  );
  const messages = items.filter((item) => (item.type === "founder_intake" || item.type === "intake_outcome") && item.departmentId === departmentId);
  const needs = needsYouForDepartment(deriveNeedsYou(items, tasks, replanProposals), departmentId, tasks);
  const departmentWaits = waitStates.filter((waitState) => waitState.departmentId === departmentId);
  const openItem = openItemId ? items.find((item) => item.id === openItemId) ?? null : null;

  useEffect(() => {
    if (!focusTaskId) return;
    setOverrides((current) => new Map(current).set(focusTaskId, true));
    // After the trace has opened.
    const frame = requestAnimationFrame(() => document.getElementById(`trace-${focusTaskId}`)?.scrollIntoView?.({ block: "start", behavior: "smooth" }));
    const done = setTimeout(onFocusHandled, 2000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(done);
    };
  }, [focusTaskId, onFocusHandled]);

  if (!department) return null;
  const name = departmentName(department, view.ctx.locale);
  const working = departmentTasks.filter((task) => task.status === "running" || task.status === "retrying");

  const needsYou = (
    <NeedsYou message={message} needs={needs} tasks={departmentTasks} view={view} waitStates={departmentWaits} />
  );

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)] gap-[var(--module-gap)] lg:grid-cols-[minmax(0,1fr)_var(--aside-width)]">
      <div className="flex min-h-0 min-w-0 flex-col gap-4">
        {/* The work summary lies open on the workspace (spec §5.3): what the department is for, and who works now. */}
        <div className="grid shrink-0 gap-2">
          <p className="max-w-[72ch] text-[15px] leading-relaxed">
            <span className="font-medium text-muted-foreground">{t("departmentPage.responsibility")}: </span>
            {departmentResponsibility(department, view.ctx.locale)}
          </p>
          <div aria-label={t("departmentPage.working")} className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" role="group">
            {working.length === 0 ? <span className="text-muted-foreground">{t("departmentPage.nobodyWorking")}</span> : null}
            {working.map((task) => {
              const agent = agents.find((candidate) => candidate.id === task.assigneeAgentId);
              const agentName = agent?.name ?? task.assigneeAgentId ?? "";
              const latest = progressEvents.filter((event) => event.parentTaskId === task.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
              const started = progressEvents
                .filter((event) => event.parentTaskId === task.id && event.step === "executing" && event.status === "current")
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .at(-1)?.createdAt;
              const minutes = started ? Math.max(0, Math.floor((now - Date.parse(started)) / 60_000)) : null;
              return (
                <span className="inline-flex min-w-0 items-center gap-1.5" key={task.id}>
                  <AgentIcon agentId={task.assigneeAgentId ?? ""} className="size-4" decorative name={agentName} />
                  <span className="truncate">
                    {t("departmentPage.agentActivity")
                      .replace("{agent}", agentName)
                      .replace("{activity}", latest ? resolveLocalizedValue(latest.labelText, language, latest.label) : t("departmentPage.starting"))}
                  </span>
                  {minutes !== null ? <span className="text-[13px] font-medium text-muted-foreground">{t("departmentPage.elapsed").replace("{minutes}", String(minutes))}</span> : null}
                </span>
              );
            })}
          </div>
        </div>
        {!wide ? (
          <NeedsYouFrame count={needsYouCount(needs)} wide={false}>
            {needsYou}
          </NeedsYouFrame>
        ) : null}
        <div aria-label={t("departmentPage.tasks")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1" role="region" tabIndex={0}>
          <div className="grid content-start gap-3 pb-2">
            {departmentTasks.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t("departmentPage.noTasks")}</p> : null}
            {departmentTasks.map((task) => (
              <ExecutionTrace
                actions={props}
                expanded={overrides.get(task.id) ?? expandedByDefault(traceState(task))}
                focused={task.id === focusTaskId}
                items={items}
                key={task.id}
                onReplanFormChange={(open) =>
                  setReplanForms((current) => {
                    const next = new Set(current);
                    if (open) next.add(task.id);
                    else next.delete(task.id);
                    return next;
                  })}
                onToggle={() =>
                  setOverrides((current) => new Map(current).set(task.id, !(current.get(task.id) ?? expandedByDefault(traceState(task)))))}
                progressEvents={progressEvents}
                proposals={replanProposals.filter((proposal) => proposal.sourceTaskId === task.id)}
                replan={props}
                replanFormOpen={replanForms.has(task.id)}
                task={task}
                tasks={tasks}
                view={view}
                waitStates={departmentWaits}
              />
            ))}
            {messages.length > 0 ? (
              <section aria-label={t("departmentPage.messages")} className="grid gap-3 pt-2">
                <h2 className="text-[13px] font-medium normal-case text-muted-foreground">{t("departmentPage.messages")}</h2>
                {messages.map((item) => (
                  <CeoOfficeCard item={item} key={item.id} view={view} />
                ))}
              </section>
            ) : null}
          </div>
        </div>
        <CeoComposer
          companyStatus={company.status}
          copy={{
            label: t("departmentPage.composerLabel").replace("{department}", name),
            placeholder: t("departmentPage.composerPlaceholder"),
            hint: t("departmentPage.composerHint").replace("{department}", name),
          }}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={(body) => props.onCreateDepartmentIntake(departmentId, body)}
        />
      </div>
      {wide ? (
        <NeedsYouFrame count={needsYouCount(needs)} wide>
          {needsYou}
        </NeedsYouFrame>
      ) : null}
      <CeoOfficeItemDialog
        actions={{ onConfirmHumanAction: props.onConfirmHumanAction, onCreateCeoReviewDecision: props.onCreateCeoReviewDecision, onResolveFounderDecision: props.onResolveFounderDecision }}
        businessArtifacts={openItem?.taskId ? props.businessArtifacts.filter((artifact) => artifact.taskId === openItem.taskId) : []}
        item={openItem}
        onActed={(text) => {
          setOpenItemId(null);
          setMessage(text);
        }}
        onClose={() => setOpenItemId(null)}
        proofs={openItem?.taskId ? props.proof.filter((entry) => entry.taskId === openItem.taskId) : []}
        view={view}
      />
    </div>
  );
}

/** The current time, moving on every half minute, for elapsed times. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
