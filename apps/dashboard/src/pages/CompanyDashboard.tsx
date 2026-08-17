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
    <main className="page-shell dashboard-shell">
      <section className="topline">
        <div>
          <span className="eyebrow">{props.company.name}</span>
          <h1>Company Operating Dashboard</h1>
        </div>
        <div className="status-pill">
          <Activity size={16} aria-hidden="true" />
          {props.company.status}
        </div>
      </section>
      {props.isPaused ? <section className="alert-strip">Global pause active</section> : null}

      <section className="operations-grid">
        <div className="ops-panel ceo-panel">
          <Building2 size={18} aria-hidden="true" />
          <h2>CEO Office</h2>
          <p>Sets objectives, routes work, and reviews proof.</p>
        </div>
        <div className="ops-panel">
          <Flag size={18} aria-hidden="true" />
          <h2>OKR System</h2>
          {props.objectives.map((objective) => (
            <p key={objective.id}>{objective.title}</p>
          ))}
        </div>
        <div className="ops-panel">
          <ListChecks size={18} aria-hidden="true" />
          <h2>Active Tasks</h2>
          {props.tasks.map((task) => (
            <p key={task.id}>
              {task.title} <span className="muted">({task.status})</span>
            </p>
          ))}
        </div>
      </section>

      <section className="department-band">
        {props.departments.map((department) => (
          <article className="department-tile" key={department.id}>
            <ClipboardCheck size={18} aria-hidden="true" />
            <h2>{department.name}</h2>
            <p>{department.responsibility}</p>
            {(tasksByDepartment.get(department.id) ?? []).map((task) => (
              <span className="task-chip" key={task.id}>
                {task.title}
              </span>
            ))}
          </article>
        ))}
      </section>

      <section className="control-grid">
        <div className="ops-panel">
          <FileCheck2 size={18} aria-hidden="true" />
          <h2>Proof</h2>
          <button className="secondary-action" onClick={props.onLoadProof} type="button">
            Load Proof
          </button>
          {props.proof.length === 0 ? <p className="muted">Work evidence will appear here after task review.</p> : null}
          {props.proof.map((proof) => (
            <p key={proof.id}>
              {proof.uri} <span className="muted">{proof.summary}</span>
            </p>
          ))}
        </div>
        <div className="ops-panel">
          <ShieldAlert size={18} aria-hidden="true" />
          <h2>Approvals</h2>
          <p className="muted">Permission requests will pause here before risky actions.</p>
          <button className="danger-action" onClick={props.onKillSwitch} type="button">
            Kill Switch
          </button>
        </div>
        <div className="ops-panel">
          <TimerReset size={18} aria-hidden="true" />
          <h2>Review</h2>
          <button className="secondary-action" onClick={props.onLoadReviews} type="button">
            Load Review
          </button>
          {props.reviews.length === 0 ? <p className="muted">CEO Office review notes and OKR updates will appear here.</p> : null}
          {props.reviews.map((review) => (
            <p key={review.id}>{review.summary}</p>
          ))}
        </div>
      </section>

      <section className="event-log">
        <h2>Live Events</h2>
        {props.events.length === 0 ? <p className="muted">Waiting for agent activity.</p> : null}
        {props.events.map((event, index) => (
          <p key={`${event.type}-${event.taskId ?? "system"}-${index}`}>{event.message}</p>
        ))}
      </section>
    </main>
  );
}
