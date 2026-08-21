import { Activity, Building2, ClipboardCheck, FileCheck2, Flag, ListChecks, ShieldAlert, TimerReset } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type {
  CompanySummary,
  DepartmentSummary,
  ObjectiveSummary,
  ProofSummary,
  ReviewSummary,
  ServerEvent,
  TaskSummary,
} from "../api/client";
import { VideotexKeyValue, VideotexLog } from "../ui/data";
import { useLanguage } from "../ui/language";
import { AppShell, PageHeader, Workspace } from "../ui/layout";
import { RetroBadge, RetroButton, RetroPanel } from "../ui/retro";
import { formatTaskStatus } from "../ui/tasks/formatTaskStatus";

export type DashboardFocusSection = "tasks" | "departments" | "proof" | "review" | "evidence";

export type DashboardFocusTarget = {
  section: DashboardFocusSection;
  version: number;
};

export type CompanyDashboardProps = {
  company: CompanySummary;
  departments: DepartmentSummary[];
  objectives: ObjectiveSummary[];
  tasks: TaskSummary[];
  events: ServerEvent[];
  focusTarget: DashboardFocusTarget | null;
  proof: ProofSummary[];
  reviews: ReviewSummary[];
  isPaused: boolean;
  menuBar?: ReactNode;
  onLoadProof(): void;
  onLoadReviews(): void;
  onKillSwitch(): void;
};

export function CompanyDashboard(props: CompanyDashboardProps) {
  const { t } = useLanguage();
  const sectionRefs = {
    departments: useRef<HTMLElement>(null),
    evidence: useRef<HTMLParagraphElement>(null),
    proof: useRef<HTMLElement>(null),
    review: useRef<HTMLElement>(null),
    tasks: useRef<HTMLElement>(null),
  };
  const tasksByDepartment = new Map(props.departments.map((department) => [department.id, [] as TaskSummary[]]));
  for (const task of props.tasks) {
    tasksByDepartment.get(task.departmentId)?.push(task);
  }

  useEffect(() => {
    if (!props.focusTarget) {
      return;
    }

    const section =
      props.focusTarget.section === "evidence"
        ? (sectionRefs.evidence.current ?? sectionRefs.proof.current)
        : sectionRefs[props.focusTarget.section].current;
    section?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    section?.focus({ preventScroll: true });
  }, [props.focusTarget?.version]);

  return (
    <AppShell className="app-shell--workbench" menuBar={props.menuBar}>
      <PageHeader
        eyebrow={props.company.name}
        status={props.company.status}
        statusIcon={<Activity size={16} aria-hidden="true" />}
        title={t("dashboard.title")}
      />
      {props.isPaused ? <section className="system-message system-message--danger">{t("app.globalPause")}</section> : null}

      <Workspace className="operations-grid">
        <RetroPanel icon={<Building2 size={18} aria-hidden="true" />} title={t("dashboard.ceoOffice")} variant="inverted">
          <p>{t("dashboard.ceoOfficeDescription")}</p>
          <VideotexKeyValue items={[{ label: t("dashboard.state"), value: props.company.status }, { label: t("dashboard.playbook"), value: props.company.playbookId }]} />
        </RetroPanel>
        <RetroPanel icon={<Flag size={18} aria-hidden="true" />} title={t("dashboard.okrSystem")}>
          <VideotexLog emptyMessage={t("dashboard.noObjectives")} rows={props.objectives.map((objective) => objective.title)} />
        </RetroPanel>
        <RetroPanel
          icon={<ListChecks size={18} aria-hidden="true" />}
          id="active-tasks"
          ref={sectionRefs.tasks}
          tabIndex={-1}
          title={t("dashboard.activeTasks")}
        >
          <VideotexLog
            emptyMessage={t("dashboard.noActiveTasks")}
            rows={props.tasks.map((task) => `${task.title} / ${formatTaskStatus(task, t).toUpperCase()}`)}
          />
        </RetroPanel>
      </Workspace>

      <Workspace className="department-band" id="departments">
        {props.departments.map((department) => (
          <RetroPanel
            icon={<ClipboardCheck size={18} aria-hidden="true" />}
            key={department.id}
            ref={department.id === props.departments[0]?.id ? sectionRefs.departments : undefined}
            tabIndex={department.id === props.departments[0]?.id ? -1 : undefined}
            title={department.name}
          >
            <p>{department.responsibility}</p>
            {(tasksByDepartment.get(department.id) ?? []).map((task) => (
              <RetroBadge key={task.id} tone="signal">
                {task.title}
              </RetroBadge>
            ))}
          </RetroPanel>
        ))}
      </Workspace>

      <Workspace className="control-grid">
        <RetroPanel icon={<FileCheck2 size={18} aria-hidden="true" />} id="proof" ref={sectionRefs.proof} tabIndex={-1} title={t("dashboard.proof")}>
          <RetroButton onClick={props.onLoadProof}>
            {t("menu.loadProof")}
          </RetroButton>
          {props.proof.length === 0 ? <p className="muted">{t("dashboard.workEvidence")}</p> : null}
          {props.proof.map((proof, index) => (
            <p
              className="proof-evidence-row"
              id={index === 0 ? "first-evidence" : undefined}
              key={proof.id}
              ref={index === 0 ? sectionRefs.evidence : undefined}
              tabIndex={index === 0 ? -1 : undefined}
            >
              {proof.uri} <span className="muted">{proof.summary}</span>
            </p>
          ))}
        </RetroPanel>
        <RetroPanel icon={<ShieldAlert size={18} aria-hidden="true" />} title={t("dashboard.approvals")}>
          <p className="muted">{t("dashboard.permissionRequests")}</p>
          <RetroButton onClick={props.onKillSwitch} variant="danger">
            {t("menu.killSwitch")}
          </RetroButton>
        </RetroPanel>
        <RetroPanel icon={<TimerReset size={18} aria-hidden="true" />} id="review" ref={sectionRefs.review} tabIndex={-1} title={t("dashboard.review")}>
          <RetroButton onClick={props.onLoadReviews}>
            {t("menu.loadReview")}
          </RetroButton>
          {props.reviews.length === 0 ? <p className="muted">{t("dashboard.reviewNotes")}</p> : null}
          {props.reviews.map((review) => (
            <p key={review.id}>{review.summary}</p>
          ))}
        </RetroPanel>
      </Workspace>

      <RetroPanel title={t("dashboard.liveEvents")}>
        <VideotexLog emptyMessage={t("dashboard.waitingActivity")} rows={props.events.map((event) => event.message)} />
      </RetroPanel>
    </AppShell>
  );
}
