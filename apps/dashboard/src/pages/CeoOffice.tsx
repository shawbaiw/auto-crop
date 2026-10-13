import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AgentSummary,
  BusinessArtifactSummary,
  CeoOfficeItemSummary,
  CompanySummary,
  DepartmentSummary,
  FinalFounderReportSummary,
  KeyResultSummary,
  ObjectiveSummary,
  ProofSummary,
  ReplanProposalSummary,
  TaskSummary,
  VisionGapSummary,
  WaitStateSummary,
} from "../api/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { CeoComposer } from "../components/ceo-office/CeoComposer";
import { CeoOfficeItemDialog, type CeoOfficeActions } from "../components/ceo-office/CeoOfficeItemDialog";
import { CeoOutcomes, outcomeItems } from "../components/ceo-office/CeoOutcomes";
import { CeoPlanCanvas } from "../components/ceo-office/CeoPlanCanvas";
import { CeoTimeline } from "../components/ceo-office/CeoTimeline";
import { NeedsYou } from "../components/ceo-office/NeedsYou";
import { deriveNeedsYou, needsYouCount as countNeedsYou } from "../components/ceo-office/deriveNeedsYou";
import { isDepartmentIntakeItem, useOfficeView } from "../components/ceo-office/useOfficeView";
import { isUnseenSince, readOutcomesLastSeen, writeOutcomesLastSeen } from "../ui/ceoOutcomes/lastSeen";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useLanguage } from "../ui/language";

export type CeoOfficeProps = CeoOfficeActions & {
  agents: AgentSummary[];
  businessArtifacts: BusinessArtifactSummary[];
  ceoOfficeItems: CeoOfficeItemSummary[];
  company: CompanySummary;
  departments: DepartmentSummary[];
  finalFounderReport: FinalFounderReportSummary | null;
  finalFounderReportPreparing: boolean;
  keyResults: KeyResultSummary[];
  objectives: ObjectiveSummary[];
  onCreateCeoIntake?: (body: string) => Promise<void> | void;
  onOpenDepartment(departmentId: string): void;
  /** Opens a task on its department page. */
  onOpenTask(taskId: string): void;
  proof: ProofSummary[];
  replanProposals: ReplanProposalSummary[];
  tasks: TaskSummary[];
  visionGaps: VisionGapSummary[];
  waitStates: WaitStateSummary[];
};

type CeoOfficeTab = "timeline" | "plan" | "outcomes";

/**
 * CEO Office (dashboard ADR 0002): the timeline, plan and outcomes in the centre with the composer
 * docked below them, and what needs the founder on the right. On a narrow screen "Needs you" folds
 * into a section above the timeline. Every business text is shown in the company locale; the
 * interface language governs the chrome.
 */
export function CeoOffice({
  agents,
  businessArtifacts,
  ceoOfficeItems,
  company,
  departments,
  finalFounderReport,
  finalFounderReportPreparing,
  keyResults,
  objectives,
  onConfirmHumanAction,
  onCreateCeoIntake,
  onCreateCeoReviewDecision,
  onOpenDepartment,
  onOpenTask,
  onResolveFounderDecision,
  proof,
  replanProposals,
  tasks,
  visionGaps,
  waitStates,
}: CeoOfficeProps) {
  const { t } = useLanguage();
  const companyLocale = company.locale ?? "en";
  const wide = useMediaQuery("(min-width: 1024px)");
  const [tab, setTab] = useState<CeoOfficeTab>(company.status === "stopped" ? "outcomes" : "timeline");
  const [draft, setDraft] = useState("");
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The founder's last visit, read once per company before this visit is recorded, so "new" stays
  // stable while the page is open. Storage failures read as "nothing is new".
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  useEffect(() => {
    setLastSeen(readOutcomesLastSeen(company.id));
    writeOutcomesLastSeen(company.id, new Date().toISOString());
    setTab(company.status === "stopped" ? "outcomes" : "timeline");
    // Only a different company resets the page; a status change while it is open does not.
  }, [company.id]);

  const { items: allItems, view } = useOfficeView({
    company,
    ceoOfficeItems,
    departments,
    tasks,
    lastSeen,
    actions: {
      onOpenItem: (item) => {
        setMessage(null);
        setOpenItemId(item.id);
      },
      onOpenDepartment: (departmentId) => {
        setOpenItemId(null);
        onOpenDepartment(departmentId);
      },
      onOpenTask: (taskId) => {
        setOpenItemId(null);
        onOpenTask(taskId);
      },
      onOpenCeoOffice: () => setOpenItemId(null),
    },
  });
  // What the founder told one department stays on that department's page.
  const items = useMemo(() => allItems.filter((item) => !isDepartmentIntakeItem(item)), [allItems]);
  const openItem = openItemId ? items.find((item) => item.id === openItemId) ?? null : null;
  const needs = deriveNeedsYou(items, tasks, replanProposals);
  const needsYouCount = countNeedsYou(needs);
  const newOutcomes = outcomeItems(items).filter((item) => isUnseenSince(item.occurredAt, lastSeen)).length;
  const ceoAgent = agents.find((agent) => agent.id === company.selectedCeoAgentId);

  const needsYou = (
    <NeedsYou message={message} needs={needs} tasks={tasks} view={view} waitStates={waitStates} />
  );

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        {!wide ? (
          <details className="group shrink-0 rounded-lg border border-border/80 bg-card shadow-workbench">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-semibold">
              {t("ceoOffice.needsYouSummary").replace("{count}", String(needsYouCount))}
              <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="max-h-[40dvh] overflow-y-auto border-t border-border/70 p-3">{needsYou}</div>
          </details>
        ) : null}
        <Tabs className="flex min-h-0 flex-1 flex-col gap-3" onValueChange={(value) => setTab(value as CeoOfficeTab)} value={tab}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="timeline">{t("ceoOffice.timeline")}</TabsTrigger>
              <TabsTrigger value="plan">{t("ceoOffice.plan")}</TabsTrigger>
              <TabsTrigger value="outcomes">
                {t("ceoOffice.outcomes")}
                {newOutcomes > 0 ? <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">{newOutcomes}</span> : null}
              </TabsTrigger>
            </TabsList>
            {ceoAgent ? <p className="truncate text-xs text-muted-foreground">{t("ceoOffice.ceoAgent").replace("{agent}", ceoAgent.name)}</p> : null}
          </div>
          {company.founderVision ? (
            // Shown once here rather than on every Task Brief card.
            <p className="-mt-1 truncate text-xs text-muted-foreground" title={company.founderVision}>
              <span className="font-medium text-foreground/70">{t("ceoOffice.founderVision")}: </span>
              {company.founderVision}
            </p>
          ) : null}
          <TabsContent className="min-h-0 flex-1 data-[state=inactive]:hidden" value="timeline">
            <CeoTimeline companyId={company.id} items={items} view={view} />
          </TabsContent>
          <TabsContent className="min-h-0 flex-1 data-[state=inactive]:hidden" value="plan">
            <CeoPlanCanvas
              departments={departments}
              keyResults={keyResults}
              locale={companyLocale}
              objectives={objectives}
              onOpenDepartment={view.onOpenDepartment}
              tasks={tasks}
            />
          </TabsContent>
          <TabsContent className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden" value="outcomes">
            <CeoOutcomes
              items={items}
              report={finalFounderReport}
              reportPreparing={finalFounderReportPreparing}
              view={view}
              visionGaps={visionGaps}
            />
          </TabsContent>
        </Tabs>
        <CeoComposer companyStatus={company.status} draft={draft} onDraftChange={setDraft} onSubmit={onCreateCeoIntake} />
      </div>
      {wide ? (
        <aside aria-label={t("ceoOffice.needsYou")} className="hidden min-h-0 overflow-y-auto lg:block">
          <h2 className="mb-3 text-sm font-semibold">{t("ceoOffice.needsYou")}</h2>
          {needsYou}
        </aside>
      ) : null}
      <CeoOfficeItemDialog
        actions={{ onConfirmHumanAction, onCreateCeoReviewDecision, onResolveFounderDecision }}
        businessArtifacts={openItem?.taskId ? businessArtifacts.filter((artifact) => artifact.taskId === openItem.taskId) : []}
        item={openItem}
        onActed={(text) => {
          setOpenItemId(null);
          setMessage(text);
        }}
        onClose={() => setOpenItemId(null)}
        proofs={openItem?.taskId ? proof.filter((entry) => entry.taskId === openItem.taskId) : []}
        view={view}
      />
    </div>
  );
}
