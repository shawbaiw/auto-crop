import type { Company, CompanyStatus } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { defaultExecutionRegistry, type ExecutionRegistry } from "./executionControl";

/**
 * The stop reasons a company operation hands to its live runs. The scheduler reads them when the
 * stopped process exits: a paused run's task goes back to the queue, a stopped run's is cancelled.
 */
export const COMPANY_PAUSED_STOP_REASON = "company_paused";
export const COMPANY_STOPPED_STOP_REASON = "company_stopped";

type Repositories = ReturnType<typeof createRepositories>;

export type CompanyOperationInput = {
  companyId: string;
  repositories: Repositories;
  now?: () => Date;
  createId?: (prefix: string) => string;
  /** Where live executions are registered, so a stop reaches the processes. */
  executionRegistry?: ExecutionRegistry;
  stopCompanySessions?: (companyId: string, reason: string) => string[];
};

export type CompanyOperationResult =
  | {
      ok: true;
      company: Company;
      /** Tasks whose live run this process asked to stop. They settle when the process exits. */
      interruptedTasks: string[];
      /** Tasks recorded as running whose run this process cannot reach, because another worker owns it. */
      unreachableTasks: string[];
      stoppedSessions: string[];
    }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_status"; status: CompanyStatus };

/**
 * Pause Operating (ADR 0044): stop one company's dispatch and its live runs, until it is resumed.
 *
 * The status changes first, so no new run starts while the old ones wind down. The live runs are
 * only asked to stop: the scheduler settles each one when its process actually exits, and puts the
 * task back in the queue. Rewriting the task here, under a process that may still be writing to the
 * task's workspace, would let the next dispatch start in a directory something else is writing.
 */
export function pauseCompany(input: CompanyOperationInput): CompanyOperationResult {
  return endOperation(input, ["active"], "paused", COMPANY_PAUSED_STOP_REASON);
}

/** Resume Operating: a paused company dispatches again, including the tasks its pause requeued. */
export function resumeCompany(input: CompanyOperationInput): CompanyOperationResult {
  const company = input.repositories.getCompany(input.companyId);
  if (!company) return { ok: false, reason: "not_found" };
  if (company.status !== "paused") return { ok: false, reason: "invalid_status", status: company.status };

  const at = (input.now ?? (() => new Date()))().toISOString();
  input.repositories.updateCompanyStatus(company.id, "active", at);
  return { ok: true, company: { ...company, status: "active", updatedAt: at }, interruptedTasks: [], unreachableTasks: [], stoppedSessions: [] };
}

/**
 * Stop Operating (ADR 0044): end a company for good.
 *
 * Its live runs are stopped as for a pause, but their tasks are cancelled when the processes exit.
 * A company with work to report on gets a Final Founder Report authored in the background. A company
 * whose creation failed has no blueprint, so it has nothing to report.
 */
export function stopCompany(input: CompanyOperationInput): CompanyOperationResult {
  const result = endOperation(input, ["active", "paused", "creation_failed"], "stopped", COMPANY_STOPPED_STOP_REASON);
  if (result.ok && input.repositories.listTasksForCompany(input.companyId).length > 0) {
    queueFinalFounderReport(input);
  }
  return result;
}

function endOperation(
  input: CompanyOperationInput,
  from: CompanyStatus[],
  to: CompanyStatus,
  stopReason: string,
): CompanyOperationResult {
  const company = input.repositories.getCompany(input.companyId);
  if (!company) return { ok: false, reason: "not_found" };
  if (!from.includes(company.status)) return { ok: false, reason: "invalid_status", status: company.status };

  const at = (input.now ?? (() => new Date()))().toISOString();
  input.repositories.updateCompanyStatus(company.id, to, at);

  const registry = input.executionRegistry ?? defaultExecutionRegistry;
  const interruptedTasks = registry.requestStopForCompany(company.id, stopReason);
  const running = [...new Set(input.repositories.listRunningAgentRuns(company.id).map((run) => run.taskId))];
  const stoppedSessions = input.stopCompanySessions?.(company.id, stopReason) ?? [];

  return {
    ok: true,
    company: { ...company, status: to, updatedAt: at },
    interruptedTasks,
    unreachableTasks: running.filter((taskId) => !interruptedTasks.includes(taskId)),
    stoppedSessions,
  };
}

function queueFinalFounderReport(input: CompanyOperationInput): void {
  if (input.repositories.getActiveFinalFounderReportJob(input.companyId)) return;
  const at = (input.now ?? (() => new Date()))().toISOString();
  const createId = input.createId ?? ((prefix: string) => `${prefix}_${crypto.randomUUID()}`);
  input.repositories.createFinalFounderReportJob({
    id: createId("founder_report_job"),
    companyId: input.companyId,
    status: "preparing",
    createdAt: at,
    updatedAt: at,
    finishedAt: null,
    failureMessage: null,
  });
}
