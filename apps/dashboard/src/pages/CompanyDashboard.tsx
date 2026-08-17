import { Activity, Building2, ClipboardCheck, FileCheck2, Flag, ListChecks, ShieldAlert, TimerReset } from "lucide-react";
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
import { AppShell, PageHeader, Workspace } from "../ui/layout";
import { RetroBadge, RetroButton, RetroPanel } from "../ui/retro";

export type CompanyDashboardProps = {
  company: CompanySummary;
  departments: DepartmentSummary[];
  objectives: ObjectiveSummary[];
  tasks: TaskSummary[];
  events: ServerEvent[];
  proof: ProofSummary[];
  reviews: ReviewSummary[];
  isPaused: boolean;
  onLoadProof(): void;
  onLoadReviews(): void;
  onKillSwitch(): void;
};

export function CompanyDashboard(props: CompanyDashboardProps) {
  const tasksByDepartment = new Map(props.departments.map((department) => [department.id, [] as TaskSummary[]]));
  for (const task of props.tasks) {
    tasksByDepartment.get(task.departmentId)?.push(task);
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow={props.company.name}
        status={props.company.status}
        statusIcon={<Activity size={16} aria-hidden="true" />}
        title="Company Operating Dashboard"
      />
      {props.isPaused ? <section className="system-message system-message--danger">Global pause active</section> : null}

      <Workspace className="operations-grid">
        <RetroPanel icon={<Building2 size={18} aria-hidden="true" />} title="CEO Office" variant="inverted">
          <p>Sets objectives, routes work, and reviews proof.</p>
          <VideotexKeyValue items={[{ label: "STATE", value: props.company.status }, { label: "PLAYBOOK", value: props.company.playbookId }]} />
        </RetroPanel>
        <RetroPanel icon={<Flag size={18} aria-hidden="true" />} title="OKR System">
          <VideotexLog emptyMessage="No objectives queued." rows={props.objectives.map((objective) => objective.title)} />
        </RetroPanel>
        <RetroPanel icon={<ListChecks size={18} aria-hidden="true" />} title="Active Tasks">
          <VideotexLog
            emptyMessage="No active tasks."
            rows={props.tasks.map((task) => `${task.title} / ${task.status.toUpperCase()}`)}
          />
        </RetroPanel>
      </Workspace>

      <Workspace className="department-band">
        {props.departments.map((department) => (
          <RetroPanel icon={<ClipboardCheck size={18} aria-hidden="true" />} key={department.id} title={department.name}>
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
        <RetroPanel icon={<FileCheck2 size={18} aria-hidden="true" />} title="Proof">
          <RetroButton onClick={props.onLoadProof}>
            Load Proof
          </RetroButton>
          {props.proof.length === 0 ? <p className="muted">Work evidence will appear here after task review.</p> : null}
          {props.proof.map((proof) => (
            <p key={proof.id}>
              {proof.uri} <span className="muted">{proof.summary}</span>
            </p>
          ))}
        </RetroPanel>
        <RetroPanel icon={<ShieldAlert size={18} aria-hidden="true" />} title="Approvals">
          <p className="muted">Permission requests will pause here before risky actions.</p>
          <RetroButton onClick={props.onKillSwitch} variant="danger">
            Kill Switch
          </RetroButton>
        </RetroPanel>
        <RetroPanel icon={<TimerReset size={18} aria-hidden="true" />} title="Review">
          <RetroButton onClick={props.onLoadReviews}>
            Load Review
          </RetroButton>
          {props.reviews.length === 0 ? <p className="muted">CEO Office review notes and OKR updates will appear here.</p> : null}
          {props.reviews.map((review) => (
            <p key={review.id}>{review.summary}</p>
          ))}
        </RetroPanel>
      </Workspace>

      <RetroPanel title="Live Events">
        <VideotexLog emptyMessage="Waiting for agent activity." rows={props.events.map((event) => event.message)} />
      </RetroPanel>
    </AppShell>
  );
}
