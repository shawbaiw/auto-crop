import { resolveBudgetSnapshot, systemExecutionClock, type BudgetPolicy, type ExecutionClock } from "./budgetPolicy";
import { BudgetInterrupted, RunBudget } from "./runBudget";
import { EXECUTION_BRIEF_TIMEOUT_MS, prepareExecutionBrief } from "./executionBrief";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLaunchableAdapter } from "../adapters/registry";
import type { AdapterLaunchSupport } from "../adapters/launchPolicy";
import type { AgentAdapter, AgentRunResult, RunObservationSink } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import { resolvePolicyForPermissionMode } from "../policies/defaults";
import {
  grantNeedsFounderApproval,
  resolveAgentCapabilityGrant,
  resolveTaskCapabilityNeeds,
  type AgentCapabilityGrant,
} from "../policies/capabilityGrant";
import {
  type AgentFailureReason,
  type BusinessArtifact,
  type Company,
  type DependencyInputRole,
  type Proof,
  type Task,
  type TaskEvent,
  type TaskProgressEvent,
  type TaskStatus,
} from "@auto-crop/core";
import {
  MAX_TASK_ATTEMPTS,
  retryExhaustedFailureMessage,
  taskAttemptCount,
  terminateAsRetryExhausted as terminateTaskAsRetryExhausted,
} from "./boundedRecovery";
import {
  captureBusinessArtifact,
  isReviewableBusinessArtifact,
  readEnvironmentBlockerClaim,
  verifyEnvironmentBlockerClaim,
} from "./businessArtifact";
import type { AgentSessionManager } from "./agentSessions";
import { repairBusinessArtifactSyntax, type ArtifactSyntaxRepair } from "./artifactSyntaxRepair";
import { projectCeoAttention } from "./ceoAttention";
import { classifyFinalFounderReport, isCompanyQuiescent } from "./companyQuiescence";
import { resolveDependencyReadiness, type TaskHandoff } from "./dependencyReadiness";
import { generateFinalFounderReport, hasWorkCompletedSinceReport } from "./finalFounderReport";
import { formatExecutionBudget, resolveEffectiveTimeout, resolveRetryTimeout } from "./executionProfile";
import { finalizeDelivery } from "./deliveryFinalization";
import { RunObserver } from "./executionObservation";
import { settleAgentRun, type RunOutcome } from "./executionSettlement";
export type { RunOutcome } from "./executionSettlement";
import { defaultExecutionRegistry, type ExecutionRegistry } from "./executionControl";
import { propagateParentTaskAggregation } from "./parentTaskAggregation";
import { createHandoffPackage } from "./proof";
import { buildProofContractInstructions } from "./proofContract";
import { reconcileReviewTasksForAutomaticAcceptance } from "./reviewReconciliation";
import { reconcileStaleRunningTasks } from "./taskRecovery";
import { recordTaskCompletionEvent } from "./taskCompletion";
import { buildTaskExecutionPrompt } from "./taskExecutionPrompt";
import { applyTaskTransition } from "./taskTransition";
import { pendingReworkFeedback } from "./verificationRework";
import {
  isVerifyingTask,
  prepareVerificationInputs,
  producesVerificationRequirements,
  resolveCaptureVerificationContext,
} from "./verificationContract";
import { cleanupGeneratedWorkspaceArtifacts, createTaskWorkspace } from "./workspace";

export type SchedulerFailureReason = AgentFailureReason;

export type SchedulerEvent = {
  type: TaskEvent["type"] | "company_report_ready";
  taskId?: string;
  companyId?: string;
  message: string;
  failureReason?: SchedulerFailureReason;
  failureMessage?: string;
  status?: TaskStatus;
  executionProfileName?: string;
  requestedTimeoutMs?: number;
  effectiveTimeoutMs?: number;
  dependencyNote?: string;
  artifactWorkspacePath?: string;
};

export type RunSchedulerOnceInput = {
  projectRoot: string;
  /** Internal opt-in; production defaults to observe until P4.2/P4.3 are complete. */
  executionBudget?: Partial<BudgetPolicy>;
  executionClock?: ExecutionClock;
  repositories: ReturnType<typeof createRepositories>;
  adapters: AgentAdapter[];
  workerId: string;
  maxTasks: number;
  now?: () => Date;
  createId?: (prefix: string) => string;
  /**
   * Whether this task needs Founder Approval before it may be dispatched. Optional, and the default
   * resolves the task's own company Permission Mode — every caller previously had to supply this and
   * the one that did got it wrong, pinning a hardcoded `balanced` policy so a `safe` company never
   * asked. Override it only in tests.
   */
  approvalRequired?: (task: Task) => boolean;
  proofCollector: (input: { task: Task; stdout: string; stderr: string; logPath: string }) => Proof[];
  /** Injectable fetch used to independently verify Environment-Blocked Blocker claims. Defaults to global fetch. */
  environmentBlockerFetch?: typeof fetch;
  /** Injectable session manager for the CEO Agent run that authors a Final Founder Report. */
  agentSessionManager?: AgentSessionManager;
  agentSessionEnv?: Record<string, string | undefined>;
  /**
   * How often the owner runner reports that it is still alive while a run is in flight.
   *
   * A heartbeat is the runner answering, never the agent's output arriving, so it needs a clock of
   * its own. Zero (the default) means only the deterministic beats at phase boundaries, which is what
   * tests want; the CLI passes a real interval so a long phase still reports in.
   *
   * Observation only: nothing reads a heartbeat to end a run yet (execution-health P1).
   */
  heartbeatIntervalMs?: number;
  /**
   * How long a task lock stays valid without renewal.
   *
   * A lock used to be permanent, so a dispatch that died holding one took its task out of service for
   * good. The holder renews while it works; silence past the lease is what lets another dispatch take
   * the task over, without anyone having to prove the dead worker is gone.
   */
  executionLeaseMs?: number;
  /**
   * Where live executions register so a stop request can reach the process, not only the row.
   * Defaults to the process-wide registry; tests pass their own.
   */
  executionRegistry?: ExecutionRegistry;
  emit: (event: SchedulerEvent) => void;
};

export type RunSchedulerOnceResult = {
  started: string[];
  completed: string[];
  blocked: string[];
  failed: string[];
};

export async function runSchedulerOnce(input: RunSchedulerOnceInput): Promise<RunSchedulerOnceResult> {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const registry = input.executionRegistry ?? defaultExecutionRegistry;
  const approvalRequired = input.approvalRequired
    ?? ((task: Task) => requiresFounderApproval(input.repositories, task));
  const result: RunSchedulerOnceResult = {
    started: [],
    completed: [],
    blocked: [],
    failed: [],
  };

  if (input.repositories.isGlobalPaused()) {
    return result;
  }

  for (const company of input.repositories.listCompanies()) {
    reconcileStaleRunningTasks({
      repositories: input.repositories,
      companyId: company.id,
      now,
      createId,
    });
    // One-time migration pass (ADR 0017 §Migration): on the first tick after this company gets the
    // deterministic model, accept the `review` tasks it would have accepted. A per-company marker
    // makes every later call a no-op; any newly-queued downstream is picked up by
    // `fetchQueuedTasks` in this same tick.
    const reconciledReview = reconcileReviewTasksForAutomaticAcceptance({
      repositories: input.repositories,
      companyId: company.id,
      now,
      createId,
      requestSchedulerWake: () => undefined,
    });
    for (const event of reconciledReview.events) {
      emitTaskEvent(input, event);
    }
    // One-time upgrade pass (ADR 0018 §Upgrade regeneration): a company that finished before this
    // feature shipped gets its closing report enqueued once. Also per-company-marked; `runFinal
    // FounderReportJobs` (a later tick) authors it off this path.
    reconcileFinalFounderReportUpgrade(input, company, now, createId);
  }

  if (input.repositories.executionBudget.ownerBlocked(input.workerId)) return result;
  const queuedTasks = input.repositories.fetchQueuedTasks(Math.max(input.maxTasks * 5, 20));
  const dispatches: Array<Promise<void>> = [];

  for (const task of queuedTasks) {
    if (dispatches.length >= input.maxTasks) {
      break;
    }

    const dependencyDecision = resolveDependencyReadiness(input.repositories, task);
    if (dependencyDecision.kind === "waiting") {
      if (task.dependencyNote !== dependencyDecision.note || task.status !== "waiting_dependency") {
        applyTaskTransition({
          repositories: input.repositories,
          task,
          status: "waiting_dependency",
          executionSummary: { dependencyNote: dependencyDecision.note },
          // An upstream parked on an unresolved Founder Decision is not an ordinary dependency
          // wait: the founder owns it, so the Hold points at the decision and offers resolving it.
          hold: dependencyDecision.waitingOnDecision
            ? {
              kind: "awaiting_founder_decision",
              resolver: "founder",
              subjectKind: "founder_decision",
              subjectId: dependencyDecision.founderDecisionId ?? null,
              reason: dependencyDecision.note,
            }
            : {
              kind: "awaiting_dependency_artifact",
              resolver: "upstream_task",
              subjectKind: "task",
              subjectId: dependencyDecision.dependency.id,
              reason: dependencyDecision.note,
            },
          now,
          createId,
        });
        appendAndEmitTaskEvent(input, {
          task,
          type: "dependency_waiting",
          message: dependencyDecision.note,
          status: "waiting_dependency",
          dependencyNote: dependencyDecision.note,
        });
      }
      continue;
    }

    if (dependencyDecision.kind === "missing_deliverable") {
      blockTaskForMissingDeliverable(input, task, dependencyDecision.dependency, dependencyDecision.note);
      result.blocked.push(task.id);
      continue;
    }

    if (dependencyDecision.kind === "blocked") {
      blockTaskForDependency(input, task, dependencyDecision.dependency, dependencyDecision.reason, dependencyDecision.note);
      result.blocked.push(task.id);
      continue;
    }

    const assessmentDecision = assessDepartmentTask(input, task);
    if (assessmentDecision === "deferred") {
      continue;
    }

    dispatches.push(
      (async (handoffs: TaskHandoff[]) => {
        const existingBudget = input.repositories.executionBudget.getTask(task.id);
        // Rollback to observe must not mint new time for a task that already has an authorization.
        if (existingBudget && (input.executionBudget === undefined
          || existingBudget.authorizedMs <= existingBudget.consumedMs + existingBudget.reservedMs)) return;
        const acquiredAt = now().toISOString();

        if (
          !input.repositories.acquireTaskLock(task.id, input.workerId, acquiredAt, {
            expiresAt: leaseExpiryFrom(now(), input.executionLeaseMs),
            now: acquiredAt,
          })
        ) {
          return;
        }

        let taskWorkspaceRoot: string | null = null;
        // Which run this dispatch's lock is held for. Null until a run exists, which is the window
        // a crash can leave a lock bound to nothing; the release matches on the same value either way.
        let heldForRunId: string | null = null;
        // Observation state lives outside the try: the `finally` has to flush and close it however
        // the dispatch ends.
        let observer: RunObserver | null = null;
        let budget: RunBudget | null = null;
        function settleRun(...args: Parameters<typeof settleObservedRun>): boolean {
          if (budget) args[2] = { ...args[2], budgetCheck: () => budget!.settlementUsage(args[2].status === "complete") };
          const lengths = { completed: result.completed.length, failed: result.failed.length, blocked: result.blocked.length };
          try { return settleObservedRun(...args); }
          catch (error) {
            // The final budget check may reject a prepared success inside the transaction. Its
            // database writes and buffered announcements roll back; so must the returned tick result.
            result.completed.length = lengths.completed;
            result.failed.length = lengths.failed;
            result.blocked.length = lengths.blocked;
            throw error;
          }
        }
        let heartbeat: { stop: () => void } | null = null;
        // The ownership generation this dispatch is executing under. Null until the run exists.
        let ownerEpoch: number | null = null;
        let stopper: AbortController | null = null;
        let stopHandle: { stopReason: string | null } | null = null;
        let releaseHandle: (() => void) | null = null;
        // The directory this dispatch claimed and the run it claimed it for, so the release names the
        // same pair it took rather than whatever happens to be there when it unwinds.
        let heldWorkspacePath: string | null = null;
        let heldWorkspaceRunId: string | null = null;
        try {
          if (approvalRequired(task)) {
            const approvalId = createId("approval");
            input.repositories.createApproval({
              id: approvalId,
              companyId: task.companyId,
              taskId: task.id,
              actionType: "run_safe_command",
              riskLevel: task.riskLevel,
              status: "pending",
              requestedAt: acquiredAt,
            });
            applyTaskTransition({
              repositories: input.repositories,
              task,
              status: "blocked",
              hold: {
                kind: "awaiting_founder_approval",
                resolver: "founder",
                subjectKind: "approval",
                subjectId: approvalId,
                reason: `${task.title} needs Founder Approval before it can run.`,
              },
              now,
              createId,
            });
            appendAndEmitTaskEvent(input, {
              task,
              type: "task_blocked",
              message: "Task requires approval.",
              status: "blocked",
            });
            result.blocked.push(task.id);
            return;
          }

          const grant = resolveTaskAgentGrant(input.repositories, task);

          // Reached the recovery ceiling without a qualifying reset (a new accepted upstream
          // Business Artifact or a CEO replan): terminate instead of dispatching another run.
          if (atRetryCeiling(input, task)) {
            // No run exists yet, so there is no claim to win: this terminates the task on its own.
            terminateAtRetryCeiling(input, result, task, resolveEffectiveTimeout(task, process.env, grant), now, createId);
            return;
          }

          // Decided before the task is marked running: a task whose adapters cannot launch stays where it
          // is rather than failing on a CLI's unknown-option error.
          const launch = await resolveLaunchableAdapter(adapterCandidates(input.adapters, task));
          if (!launch.launchable) {
            appendLaunchUnavailableWarningOnce(input, task, launch.unavailable);
            return;
          }
          const adapter = launch.adapter;
          const launchWarnings = launch.support?.warnings ?? [];

          const initialTimeoutResolution = resolveEffectiveTimeout(task, process.env, grant);
          const budgetSnapshot = input.executionBudget === undefined ? null
            : resolveBudgetSnapshot(input.executionBudget, initialTimeoutResolution);
          if (budgetSnapshot && budgetSnapshot.persistMs * 3 >= (input.executionLeaseMs ?? DEFAULT_EXECUTION_LEASE_MS)) {
            throw new Error("Budget persistMs must be less than one third of the execution lease");
          }
          // Dispatch resolves whatever parked this task: the runtime owns it again.
          const markRunning = () => applyTaskTransition({
            repositories: input.repositories,
            task,
            status: "running",
            executionSummary: {
              latestFailureReason: null,
              latestFailureMessage: null,
              latestExecutionProfileName: initialTimeoutResolution.executionProfile.name,
              latestRequestedTimeoutMs: initialTimeoutResolution.requestedTimeoutMs,
              latestEffectiveTimeoutMs: initialTimeoutResolution.effectiveTimeoutMs,
              dependencyNote: null,
            },
            resolution: "cleared",
            now,
            createId,
          });
          if (!budgetSnapshot) { markRunning(); result.started.push(task.id); }
          // Compatible launch isolation still dispatches (Auto-Crop is local-first), but the downgrade is
          // recorded on the task, not only in server stdout.
          for (const warning of [...launchWarnings, ...initialTimeoutResolution.warnings]) {
            appendAndEmitTaskEvent(input, {
              task,
              type: "task_warning",
              message: `Task warning: ${task.title} / ${warning}`,
              status: "queued",
              executionProfileName: initialTimeoutResolution.executionProfile.name,
              requestedTimeoutMs: initialTimeoutResolution.requestedTimeoutMs,
              effectiveTimeoutMs: initialTimeoutResolution.effectiveTimeoutMs,
            });
          }

          const taskWorkspace = task.workspacePath
            ? { root: task.workspacePath }
            : createTaskWorkspace(input.projectRoot, task.id);
          taskWorkspaceRoot = taskWorkspace.root;
          if (!task.workspacePath) {
            input.repositories.updateTaskWorkspacePath(task.id, taskWorkspace.root);
          }
          const verifying = isVerifyingTask(input.repositories, task);
          const runWorkspacePath = verifying
            ? taskWorkspace.root
            : resolveRunWorkspace(input.repositories, task) ?? taskWorkspace.root;
          const verificationPreparation = prepareVerificationInputs({
            repositories: input.repositories,
            task,
            workspacePath: runWorkspacePath,
            now,
          });
          if (verificationPreparation.kind === "handoff_failed") {
            // A verifier started on missing input would report on an empty directory and exit cleanly.
            // Stop before the run, naming the producer whose output could not be handed over.
            blockTaskForMissingDeliverable(input, task, verificationPreparation.producer, verificationPreparation.message);
            result.blocked.push(task.id);
            return;
          }
          const verificationPromptContext = {
            producesRequirements: producesVerificationRequirements(input.repositories, task),
            inputs: verificationPreparation.kind === "ready" ? verificationPreparation.inputs : null,
          };

          const logPath = createLogPath(input.projectRoot, task);
          let timeoutResolution = initialTimeoutResolution;
          let agentRunId = "";
          let agentResult: AgentRunResult | null = null;
          let preparationFailed = false;
          let preparationTimeoutMs = EXECUTION_BRIEF_TIMEOUT_MS;

          while (true) {
            // A settled attempt releases its task lock atomically. A retry must acquire it again;
            // another dispatcher may have won in between, in which case this dispatch stops here.
            if (agentRunId && !input.repositories.acquireTaskLock(task.id, input.workerId, now().toISOString(), {
              expiresAt: leaseExpiryFrom(now(), input.executionLeaseMs), now: now().toISOString(),
            })) return;
            agentRunId = createId("agent_run");
            heldForRunId = null;
            // The run, its ownership generation and the lock's binding to both are established
            // together. Apart, a crash in between left a lock bound to no run — invisible to a
            // reconciler indexed by running runs, and permanent (execution-health P2b).
            // A retry is a new run, so it takes the directory afresh — after giving back what this
            // dispatch's previous run held, which is otherwise a dispatch blocking itself.
            if (heldWorkspacePath && heldWorkspaceRunId) {
              input.repositories.releaseWorkspaceClaim(heldWorkspacePath, heldWorkspaceRunId);
              heldWorkspacePath = null;
              heldWorkspaceRunId = null;
            }
            const budgetClock = input.executionClock ?? systemExecutionClock;
            const originMono = budgetClock.monotonicMs();
            const originUtc = budgetClock.utcNow().getTime();
            const claimed = input.repositories.transaction(() => {
              // The directory this run will write, claimed with the run itself. Two different tasks
              // legitimately share one — a consumer continues in its producer's artifact workspace —
              // so the task lock cannot express this and never did.
              if (
                !input.repositories.acquireWorkspaceClaim({
                  workspacePath: runWorkspacePath,
                  taskId: task.id,
                  runId: agentRunId,
                  ownerId: input.workerId,
                  ownerEpoch: null,
                  acquiredAt: now().toISOString(),
                  leaseExpiresAt: leaseExpiryFrom(now(), input.executionLeaseMs),
                  now: now().toISOString(),
                })
              ) {
                return null;
              }
              const epoch = input.repositories.nextExecutionEpoch(task.id);
              input.repositories.createAgentRun({
                id: agentRunId,
                taskId: task.id,
                agentId: adapter.id,
                status: "running",
                logPath,
                startedAt: now().toISOString(),
                finishedAt: null,
                executionProfileName: timeoutResolution.executionProfile.name,
                requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
                effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
                failureReason: null,
                failureMessage: null,
                ownerEpoch: epoch,
              });
              // Ownership is durable before the transaction commits, including the window before
              // observation or an adapter invocation starts.
              input.repositories.updateAgentRunObservation(agentRunId, { ownerId: input.workerId });
              // Each attempt binds the newly acquired lock to its own run and epoch.
              input.repositories.bindTaskLockToRun(task.id, input.workerId, agentRunId, epoch);
              if (budgetSnapshot) {
                input.repositories.executionBudget.reserve(agentRunId, task.id, epoch, budgetSnapshot, now().toISOString());
                markRunning();
              }
              return epoch;
            });

            if (claimed === null) {
              // Someone else is writing this directory, or it is isolated pending confirmation that a
              // previous run's process is gone. Put the task back rather than run a second writer into
              // it; the next tick tries again.
              requeueForBusyWorkspace(input, task, runWorkspacePath, now, createId);
              return;
            }
            if (budgetSnapshot) result.started.push(task.id);
            heldForRunId = agentRunId;
            ownerEpoch = claimed;
            heldWorkspacePath = runWorkspacePath;
            heldWorkspaceRunId = agentRunId;

            // A retry is a new run, so it observes into a new observer; the previous one is closed
            // by the settlement that ended it.
            observer = new RunObserver({
              repositories: input.repositories,
              runId: agentRunId,
              ownerId: input.workerId,
              now,
              createId,
            });
            const observe: RunObservationSink = {
              output: (channel, bytes) => observer?.recordOutput(channel, bytes),
            };
            /**
             * One beat: the run records that its owner answered, and the lock's lease moves out.
             *
             * Renewal lives here rather than in the observer because observation is forbidden from
             * touching locks — seeing a run and holding one are different powers, and a module that
             * had both would be one edit away from ending a run it found quiet.
             */
            const beat = () => {
              observer?.beat();
              if (ownerEpoch !== null) {
                const expiresAt = leaseExpiryFrom(now(), input.executionLeaseMs);
                input.repositories.renewTaskLock(task.id, input.workerId, agentRunId, ownerEpoch, expiresAt);
                if (heldWorkspacePath) {
                  input.repositories.renewWorkspaceClaim(heldWorkspacePath, agentRunId, expiresAt);
                }
              }
            };
            heartbeat?.stop();
            heartbeat = startHeartbeat(beat, budgetSnapshot ? 0 : input.heartbeatIntervalMs);

            // Publish a way to stop this run while it runs. Without it, "stop the company" was a
            // status change that left the agent processes running and spending.
            releaseHandle?.();
            stopper = new AbortController();
            const handle = {
              taskId: task.id,
              companyId: task.companyId,
              runId: agentRunId,
              ownerEpoch,
              stopReason: null as string | null,
              requestStop: (reason: string) => {
                handle.stopReason = reason;
                stopper?.abort();
              },
            };
            releaseHandle = registry.register(handle);
            stopHandle = handle;
            if (budgetSnapshot) budget = new RunBudget({
              repositories: input.repositories, runId: agentRunId, snapshot: budgetSnapshot,
              reservedMs: input.repositories.executionBudget.getRun(agentRunId)!.reserved_ms,
              clock: budgetClock, originMono, originUtc, abort: () => stopper?.abort(), renewOwnership: beat,
            });
            const controlledAdapter: AgentAdapter = budget ? { ...adapter, run: async (request) => {
              const timeoutMs = budget!.beginInvocation();
              const returned = await adapter.run({ ...request, timeoutMs, signal: stopper!.signal });
              return budget!.returned(returned, stopHandle?.stopReason !== null);
            } } : adapter;

            const company = input.repositories.getCompany(task.companyId);
            if (!company) {
              throw new Error(`Company not found for task ${task.id}: ${task.companyId}`);
            }
            const request = {
              taskId: task.id,
              prompt: "",
              promptPath: "",
              workspacePath: runWorkspacePath,
              metadata: { departmentId: task.departmentId, proofSchemaId: task.proofSchemaId },
              timeoutMs: timeoutResolution.effectiveTimeoutMs,
              grant,
              observe,
            };
            const preparationStartedAt = now().getTime();
            preparationTimeoutMs = Math.min(request.timeoutMs, EXECUTION_BRIEF_TIMEOUT_MS);
            budget?.enter("preparing_brief");
            observer.enterPhase("preparing_brief");
            beat();
            const preparation = await prepareExecutionBrief({ adapter: controlledAdapter, request: { ...request, timeoutMs: preparationTimeoutMs }, company, task, handoffs });
            const remainingMs = budget ? (budget.reason ? 0 : budget.remainingMs())
              : request.timeoutMs - Math.max(0, now().getTime() - preparationStartedAt);
            if (preparation.brief && remainingMs > 0) {
              appendAndEmitTaskEvent(input, {
                task, type: "task_started", status: "running",
                message: `Task started: ${task.title}`,
                executionBrief: { ...preparation.brief, title: task.titleText ?? { [company.locale]: task.title } },
                executionProfileName: timeoutResolution.executionProfile.name,
                requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
                effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
              });
              appendTaskProgressEvent(input, {
                task, step: "executing", status: "current",
                label: `Task ${task.position + 1} (${task.title}) in progress`, subjectTaskId: task.id,
              });
              budget?.enter("executing");
              observer.enterPhase("executing", "brief_returned");
              beat();
              agentResult = await controlledAdapter.run({
                ...request,
                signal: stopper.signal,
                timeoutMs: remainingMs,
                prompt: buildTaskExecutionPrompt({
                  task,
                  company,
                  handoffs,
                  grant,
                  verification: verificationPromptContext,
                  rework: pendingReworkFeedback(input.repositories, task),
                }) +
                  `\n\n## Your announced execution plan\n${JSON.stringify(preparation.brief)}\nCarry out this plan. Explain material deviations in the final report.`,
              });
            } else {
              // Preparation failed, so substantive work was never dispatched. Its budget is the
              // preparation cap, not the task's: reporting the task's budget sent the next reader to
              // a run that never happened, and escalating to a longer task budget bought a second
              // failure at the same 60s cap (ADR 0032).
              agentResult = {
                ...preparation.result,
                status: "failed",
                failureReason: budget?.reason ?? (remainingMs <= 0 ? "timeout" : (preparation.result.failureReason ?? "agent_failed")),
                stderr: preparation.result.stderr.trim()
                  || `The execution brief did not complete within ${formatExecutionBudget(preparationTimeoutMs)}; substantive work was not dispatched.`,
              };
              preparationFailed = true;
            }
            const logContent = [
              `# Agent Run ${agentRunId}`,
              "",
              `status: ${agentResult.status}`,
              `exitCode: ${agentResult.exitCode ?? ""}`,
              `launchIsolation: ${launch.support?.isolationLevel ?? "unclaimed"}`,
              ...launchWarnings.map((warning) => `launchWarning: ${warning}`),
              "",
              "## Preparation",
              preparation.result.stdout,
              "",
              "## stdout",
              agentResult.stdout,
              "",
              "## stderr",
              agentResult.stderr,
              "",
            ].join("\n");
            writeFileSync(logPath, logContent, "utf8");

            const failureReason =
              agentResult.status !== "complete" ? (agentResult.failureReason ?? "agent_failed") : null;
            // A preparation timeout is capped by the brief's own budget, so a longer task budget
            // cannot change its outcome; only a substantive run earns an escalation.
            const retryTimeoutResolution =
              !budget && failureReason === "timeout" && !preparationFailed && agentResult.terminationConfirmed !== false ? resolveRetryTimeout(timeoutResolution) : null;

            if (!retryTimeoutResolution) {
              break;
            }

            const failure = failureMessage(task, "timeout", timeoutResolution.effectiveTimeoutMs);
            const timedOutAfterMs = timeoutResolution.effectiveTimeoutMs;
            const escalated = retryTimeoutResolution;
            if (
              !settleRun(input, agentRunId, { status: "failed", failureReason: "timeout", failureMessage: failure, terminationConfirmed: agentResult.terminationConfirmed }, now, (settled) => {
                applyTaskTransition({
                  repositories: settled.repositories,
                  task,
                  status: "retrying",
                  executionSummary: {
                    latestExecutionProfileName: escalated.executionProfile.name,
                    latestRequestedTimeoutMs: escalated.requestedTimeoutMs,
                    latestEffectiveTimeoutMs: escalated.effectiveTimeoutMs,
                  },
                  resolution: "cleared",
                  now,
                  createId,
                });
                appendAndEmitTaskEvent(settled, {
                  task,
                  type: "task_retrying",
                  message: `Task warning: ${task.title} / timed out after ${formatExecutionBudget(
                    timedOutAfterMs,
                  )}; retrying with ${escalated.executionProfile.name} budget ${formatExecutionBudget(
                    escalated.effectiveTimeoutMs,
                  )}.`,
                  status: "running",
                  executionProfileName: escalated.executionProfile.name,
                  requestedTimeoutMs: escalated.requestedTimeoutMs,
                  effectiveTimeoutMs: escalated.effectiveTimeoutMs,
                });
              })
            ) {
              return;
            }
            timeoutResolution = escalated;
          }

          if (!agentResult) {
            throw new Error(`No agent result produced for task ${task.id}`);
          }

          // A delivery whose artifact file does not parse gets one narrow syntax repair before capture,
          // so everything downstream — proof, validation, finalization — reads the file it leaves.
          if (agentResult.status === "complete") {
            budget?.enter("repairing_artifact");
            observer?.enterPhase("repairing_artifact", "work_returned");
            observer?.beat();
            const repairAdapter: AgentAdapter = budget ? { ...adapter, run: async (request) => {
              const timeoutMs = budget!.beginInvocation();
              const returned = await adapter.run({ ...request, timeoutMs, signal: stopper!.signal });
              return budget!.returned(returned, stopHandle?.stopReason !== null);
            } } : adapter;
            const repair = await repairBusinessArtifactSyntax({
              adapter: repairAdapter,
              request: {
                taskId: task.id,
                promptPath: "",
                workspacePath: runWorkspacePath,
                metadata: { departmentId: task.departmentId, proofSchemaId: task.proofSchemaId },
                observe: { output: (channel, bytes) => observer?.recordOutput(channel, bytes) },
              },
              grant,
            });
            if (budget?.reason) throw new BudgetInterrupted(`Execution stopped: ${budget.reason}`);
            if (repair) {
              appendFileSync(
                logPath,
                ["## Artifact syntax repair", `outcome: ${repair.outcome}`, `syntaxError: ${repair.syntaxError}`, "", repair.result.stdout, repair.result.stderr, ""].join("\n"),
                "utf8",
              );
              appendAndEmitTaskEvent(input, {
                task,
                type: "task_warning",
                message: artifactSyntaxRepairMessage(task, repair),
                status: "running",
              });
            }
          }

          if (budget && !budget.reason) {
            budget.enter("finalizing");
            observer?.enterPhase("finalizing", agentResult.status === "complete" ? "work_complete" : "work_failed");
            observer?.beat();
          }
          let proof: Proof[] = [];
          if (agentResult.status === "complete") {
            try {
              proof = input.proofCollector({
                task: { ...task, workspacePath: runWorkspacePath },
                stdout: agentResult.stdout,
                stderr: agentResult.stderr,
                logPath,
              });
            } catch (error) {
              const failureReason = "proof_capture_failed";
              const failure = `Task failed: ${task.title} / proof_capture_failed / ${(error as Error).message}`;
              const ceiling = atRetryCeiling(input, task);
              settleRun(
                input,
                agentRunId,
                { ...(ceiling ? retryCeilingOutcome(task) : { status: "failed" as const, failureReason, failureMessage: failure }), terminationConfirmed: agentResult.terminationConfirmed },
                now,
                (settled) => {
                  if (ceiling) {
                    terminateAtRetryCeiling(settled, result, task, timeoutResolution, now, createId);
                    return;
                  }
                  applyTaskTransition({
                    repositories: settled.repositories,
                    task,
                    status: "failed",
                    executionSummary: {
                      latestFailureReason: failureReason,
                      latestFailureMessage: failure,
                    },
                    hold: {
                      kind: "invalid_business_artifact",
                      subjectKind: "agent_run",
                      subjectId: agentRunId,
                      reason: failure,
                    },
                    now,
                    createId,
                  });
                  appendAndEmitTaskEvent(settled, {
                    task,
                    type: "task_failed",
                    failureReason,
                    failureMessage: failure,
                    message: failure,
                    status: "failed",
                  });
                  result.blocked.push(...blockDirectDependencyConsumers(settled, task));
                  emitParentTaskAggregationEvents(settled, task);
                  result.failed.push(task.id);
                },
              );
              return;
            }
          }

          // Everything from here is the runtime's own work on the run's output. It is still the run's
          // time, and it is the phase a settlement is interrupted in, so it is observed like the rest.
          if (!budget || budget.reason) {
            observer?.enterPhase("finalizing", agentResult.status === "complete" ? "work_complete" : "work_failed");
            observer?.beat();
          }

          let businessArtifact: BusinessArtifact | null = null;
          let environmentBlockerDegraded = false;
          let refutedCapability: string | null = null;
          const hasBusinessArtifactFile = existsSync(
            join(runWorkspacePath, ".auto-crop", "business-artifact.json"),
          );
          if (proof.length > 0 || hasBusinessArtifactFile) {
            // An Environment-Blocked Blocker with a runtime-checkable claim is verified independently
            // (never on the agent's word). A passing check degrades the blocker to a deliverable.
            const environmentBlockerClaim =
              agentResult.status === "complete"
                ? readEnvironmentBlockerClaim(runWorkspacePath, proof)
                : null;
            const environmentBlockerVerification = environmentBlockerClaim
              ? await verifyEnvironmentBlockerClaim({
                  claim: environmentBlockerClaim,
                  fetchImpl: input.environmentBlockerFetch,
                  grant,
                })
              : undefined;
            if (environmentBlockerVerification?.reason === "refuted_by_grant") {
              refutedCapability = environmentBlockerVerification.capability;
            }
            businessArtifact = captureBusinessArtifact({
              requireExecutionDetails: true,
              task: { ...task, workspacePath: runWorkspacePath },
              proofs: proof,
              workspacePath: runWorkspacePath,
              locale: input.repositories.getCompany(task.companyId)?.locale ?? "en",
              environmentBlockerVerification,
              verificationContext: resolveCaptureVerificationContext(input.repositories, task, runWorkspacePath),
              now,
              createId,
            });
            environmentBlockerDegraded = Boolean(
              environmentBlockerVerification?.verified && businessArtifact.artifactKind !== "blocker",
            );
            // Persisted by whichever branch settles this run, after it has claimed it: a delivery that
            // lost the claim must leave nothing behind (ADR 0034).
          }
          /**
           * Everything a settlement records about what this run produced, whatever its outcome.
           *
           * Proof rows and the delivery used to be written on the way to the claim, so a dispatch that
           * lost the run still left them behind for the winner's Task to carry. They belong to the
           * writer that owns the run, so they are written from inside the settlement transaction.
           */
          const recordRunOutput = (settled: RunSchedulerOnceInput): void => {
            for (const item of proof) {
              settled.repositories.appendProof(item);
            }
            persistArtifact(settled, businessArtifact);
          };
          /**
           * Publish the handoff package the next task reads as this task's output.
           *
           * Files cannot be rolled back with the transaction, so this runs after a settlement commits
           * and only for the writer that won it: a loser that published would hand the next task the
           * output of a run that was declared dead.
           */
          const publishHandoff = (): void => {
            createHandoffPackage({
              task: { ...task, workspacePath: runWorkspacePath },
              proofs: proof,
              workspacePath: runWorkspacePath,
              logPath,
            });
          };

          if ((agentResult.status !== "complete" || proof.length === 0) && !environmentBlockerDegraded) {
            const failureReason = agentResult.status !== "complete" ? (agentResult.failureReason ?? "agent_failed") : "no_proof";
            // A brief that timed out says nothing about whether the task fits its budget, so it is
            // not evidence for a replan either.
            if (!budget && failureReason === "timeout" && agentResult.terminationConfirmed !== false && !preparationFailed && timeoutResolution.executionProfile.name === "long" && !task.artifactWorkspacePath) {
              const failure = replanMessage(task, timeoutResolution.effectiveTimeoutMs);
              if (
                settleRun(input, agentRunId, { status: "failed", failureReason: "timeout", failureMessage: failure, terminationConfirmed: agentResult.terminationConfirmed }, now, (settled) => {
                  recordRunOutput(settled);
                  applyTaskTransition({
                    repositories: settled.repositories,
                    task,
                    status: "needs_replan",
                    executionSummary: {
                      latestFailureReason: "needs_replan",
                      latestFailureMessage: failure,
                      latestExecutionProfileName: timeoutResolution.executionProfile.name,
                      latestRequestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
                      latestEffectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
                    },
                    hold: { kind: "needs_replan", reason: failure },
                    now,
                    createId,
                  });
                  appendAndEmitTaskEvent(settled, {
                    task,
                    type: "task_needs_replan",
                    failureReason: "needs_replan",
                    failureMessage: failure,
                    message: failure,
                    status: "needs_replan",
                    executionProfileName: timeoutResolution.executionProfile.name,
                    requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
                    effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
                  });
                  recordTaskCompletionEvent({
                    repositories: settled.repositories,
                    task,
                    outcome: "needs_replan",
                    now,
                    createId,
                  });
                  emitParentTaskAggregationEvents(settled, task);
                  result.blocked.push(task.id);
                })
              ) {
                publishHandoff();
              }
              return;
            }
            const failure = preparationFailed
              ? `Task failed: ${task.title} / ${failureReason} / the execution brief did not complete within ${formatExecutionBudget(preparationTimeoutMs)}; substantive work was not dispatched.`
              : failureMessage(task, failureReason, timeoutResolution.effectiveTimeoutMs, refutedCapability);
            // A run we asked to stop and never saw exit may still be writing to the workspace. That
            // outranks whatever else went wrong: the task cannot be run again there, so it is not a
            // failure to retry but a directory to isolate until someone says the process is gone.
            const unconfirmed = agentResult.terminationConfirmed === false;
            const cancelled = failureReason === "cancelled";
            const ceiling = !unconfirmed && !cancelled && atRetryCeiling(input, task);
            if (
              settleRun(
                input,
                agentRunId,
                { ...(ceiling
                  ? retryCeilingOutcome(task)
                  : unconfirmed
                    ? { status: "failed" as const, failureReason: "termination_unconfirmed" as const, failureMessage: unconfirmedTerminationMessage(task, runWorkspacePath) }
                    : { status: cancelled ? "cancelled" as const : "failed" as const, failureReason, failureMessage: failure }), terminationConfirmed: agentResult.terminationConfirmed },
                now,
                (settled) => {
                  if (ceiling) {
                    terminateAtRetryCeiling(settled, result, task, timeoutResolution, now, createId);
                    return;
                  }
                  if (unconfirmed) {
                    isolateForUnconfirmedTermination(settled, result, task, agentRunId, runWorkspacePath, now, createId);
                    return;
                  }
                  if (cancelled) {
                    applyTaskTransition({ repositories: settled.repositories, task, status: "cancelled",
                      executionSummary: { latestFailureReason: "cancelled", latestFailureMessage: failure },
                      resolution: "cancelled", now, createId });
                    appendAndEmitTaskEvent(settled, { task, type: "task_warning", status: "cancelled",
                      failureReason: "cancelled", failureMessage: failure, message: `Task cancelled: ${task.title}.` });
                    return;
                  }
                  recordRunOutput(settled);
                  applyTaskTransition({
                    repositories: settled.repositories,
                    task,
                    status: "failed",
                    executionSummary: {
                      latestFailureReason: failureReason,
                      latestFailureMessage: failure,
                    },
                    // No declared kind: `deriveTaskHold` reads the failure reason just recorded, so a
                    // reason added later still parks the task on an owned Hold.
                    now,
                    createId,
                  });
                  appendAndEmitTaskEvent(settled, {
                    task,
                    type: "task_failed",
                    failureReason,
                    failureMessage: failure,
                    message: failure,
                    status: "failed",
                    executionProfileName: timeoutResolution.executionProfile.name,
                    requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
                    effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
                  });
                  if (task.artifactWorkspacePath) {
                    appendAndEmitTaskEvent(settled, {
                      task,
                      type: "partial_output",
                      message: `Partial Output: ${task.artifactWorkspacePath} (not Proof).`,
                      status: "failed",
                      artifactWorkspacePath: task.artifactWorkspacePath,
                    });
                  }
                  const followUpTask = createPartialOutputFollowUpTask(settled, task, failureReason, failure, logPath);
                  if (!followUpTask) {
                    result.blocked.push(...blockDirectDependencyConsumers(settled, task));
                  }
                  emitParentTaskAggregationEvents(settled, task);
                  result.failed.push(task.id);
                },
              )
            ) {
              if (!unconfirmed && !cancelled) publishHandoff();
            }
            return;
          }

          // A valid report whose verification verdict did not pass is a delivery with an outcome, not an
          // artifact to recapture: it goes to finalization like any other delivery.
          const deliveredWithVerdict = Boolean(
            businessArtifact?.verification && businessArtifact.validationStatus === "valid",
          );
          if (!businessArtifact || (!isReviewableBusinessArtifact(businessArtifact) && !deliveredWithVerdict)) {
            const failureReason = businessArtifactFailureReason(businessArtifact);
            const failure = businessArtifactFailureMessage(task, businessArtifact);
            const ceiling = atRetryCeiling(input, task);
            if (
              settleRun(
                input,
                agentRunId,
                { ...(ceiling ? retryCeilingOutcome(task) : { status: "failed" as const, failureReason, failureMessage: failure }), terminationConfirmed: agentResult.terminationConfirmed },
                now,
                (settled) => {
                  if (ceiling) {
                    terminateAtRetryCeiling(settled, result, task, timeoutResolution, now, createId);
                    return;
                  }
                  recordRunOutput(settled);
                  applyTaskTransition({
                    repositories: settled.repositories,
                    task,
                    status: "blocked",
                    executionSummary: {
                      latestFailureReason: failureReason,
                      latestFailureMessage: failure,
                    },
                    hold: {
                      kind: "invalid_business_artifact",
                      subjectKind: businessArtifact ? "business_artifact" : "agent_run",
                      subjectId: businessArtifact?.id ?? agentRunId,
                      reason: failure,
                    },
                    now,
                    createId,
                  });
                  appendAndEmitTaskEvent(settled, {
                    task,
                    type: "task_blocked",
                    failureReason,
                    failureMessage: failure,
                    message: failure,
                    status: "blocked",
                    executionProfileName: timeoutResolution.executionProfile.name,
                    requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
                    effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
                  });
                  appendTaskProgressEvent(settled, {
                    task,
                    step: "blocked",
                    status: "blocked",
                    label: "Business artifact is not reviewable",
                    detail: failure,
                    subjectTaskId: task.id,
                  });
                  const blockedConsumerIds = blockDirectDependencyConsumers(settled, task);
                  recordTaskCompletionEvent({
                    repositories: settled.repositories,
                    task,
                    businessArtifact,
                    outcome: "failed_to_review",
                    dependencyImpact: { blockedTaskIds: blockedConsumerIds },
                    now,
                    createId,
                  });
                  result.blocked.push(...blockedConsumerIds);
                  emitParentTaskAggregationEvents(settled, task);
                  result.failed.push(task.id);
                },
              )
            ) {
              publishHandoff();
            }
            return;
          }

          // The run did its job whatever the delivery's outcome — a failed verdict included. Claiming it
          // first is what keeps a delivery and a timeout declaration from both landing (ADR 0034); the
          // rest of the settlement rides in the same transaction, so a delivery is recorded whole or
          // not at all.
          if (
            settleRun(input, agentRunId, { status: "complete", terminationConfirmed: agentResult.terminationConfirmed }, now, (settled) => {
              if (task.artifactWorkspacePath && task.artifactWorkspacePath !== runWorkspacePath) {
                settled.repositories.updateTaskArtifactWorkspacePath(task.id, runWorkspacePath);
              }
              recordRunOutput(settled);
              const finalized = finalizeDelivery({
                repositories: settled.repositories,
                task,
                artifact: businessArtifact,
                source: "agent_run",
                now,
                createId,
              });
              for (const event of finalized.events) {
                emitTaskEvent(settled, event);
              }
              if (finalized.outcome === "verification_failed") {
                result.blocked.push(task.id, ...blockDirectDependencyConsumers(settled, task));
              } else {
                result.completed.push(task.id);
              }
              emitParentTaskAggregationEvents(settled, task);
            })
          ) {
            publishHandoff();
          }
        } catch (error) {
          if (budget) stopper?.abort();
          if (!budget || !(error instanceof BudgetInterrupted) || !heldForRunId) throw error;
          const reason = budget.reason ?? "clock_untrusted";
          const failure = `Task stopped: ${task.title} / ${reason}.`;
          settleRun(input, heldForRunId, {
            status: "failed", failureReason: budget.activeInvocation ? "termination_unconfirmed" : reason,
            failureMessage: failure, terminationConfirmed: budget.activeInvocation ? false : undefined,
          }, now, (settled) => {
            if (budget!.activeInvocation && heldWorkspacePath) {
              isolateForUnconfirmedTermination(settled, result, task, heldForRunId!, heldWorkspacePath, now, createId);
            } else {
              applyTaskTransition({ repositories: settled.repositories, task, status: "failed",
                executionSummary: { latestFailureReason: reason, latestFailureMessage: failure }, now, createId });
              appendAndEmitTaskEvent(settled, { task, type: "task_failed", status: "failed", message: failure,
                failureReason: reason, failureMessage: failure });
              result.failed.push(task.id);
            }
          });
        } finally {
          budget?.close();
          try {
            if (taskWorkspaceRoot) {
              try {
                cleanupGeneratedWorkspaceArtifacts({
                  projectRoot: input.projectRoot,
                  workspacePath: taskWorkspaceRoot,
                });
              } catch (error) {
                appendAndEmitTaskEvent(input, {
                  task,
                  type: "task_warning",
                  message: `Task warning: ${task.title} / workspace cleanup skipped / ${(error as Error).message}`,
                });
              }
            }
          } finally {
            heartbeat?.stop();
            releaseHandle?.();
            const unsettled = heldForRunId !== null && input.repositories.listRunningAgentRuns(task.companyId)
              .some((run) => run.id === heldForRunId);
            // A rolled-back settlement retains its claims for reconciliation. A winning settlement
            // keeps its directory until post-commit handoff publication finishes; never unlock it
            // while that filesystem work is still in flight.
            if (!unsettled && heldWorkspacePath && heldWorkspaceRunId) {
              // Isolation outlives the run on purpose, so a release that names an isolated claim
              // leaves it standing: `releaseWorkspaceClaim` only clears one that is not isolated.
              input.repositories.releaseWorkspaceClaim(heldWorkspacePath, heldWorkspaceRunId);
            }
            // Flush whatever the last phase observed. Nothing here judges the run: an observation
            // that failed to land leaves the run unknown, which is not the same as failed.
            observer?.close("dispatch_ended");
            reportObservationFailures(input, task, observer);
            // Only this dispatch's own lock. One process dispatches under one `workerId`, so without
            // the run id an unwinding dispatch released whatever lock its successor had just taken.
            if (!unsettled) input.repositories.releaseTaskLock(task.id, input.workerId, heldForRunId);
          }
        }
      })(dependencyDecision.handoffs),
    );
  }

  await Promise.all(dispatches);

  // Task state for every company has settled for this tick. Sweep for Company Quiescence and, on the
  // first quiescent tick with no existing report and no in-flight job, enqueue a tracked async
  // generation job. The tick does not run the CEO Agent — `runFinalFounderReportJobs` (a later tick,
  // fire-and-forget from the scheduler loop) authors the report off this tick's path.
  for (const company of input.repositories.listCompanies()) {
    maybeEnqueueFinalFounderReportJob(input, company, now, createId);
  }

  return result;
}

/** Inputs for {@link runFinalFounderReportJobs} — the report-authoring half of the scheduler. */
export type RunFinalFounderReportJobsInput = Pick<
  RunSchedulerOnceInput,
  | "projectRoot"
  | "repositories"
  | "adapters"
  | "now"
  | "createId"
  | "agentSessionManager"
  | "agentSessionEnv"
  | "emit"
>;

type FinalFounderReportContext = {
  quiescent: boolean;
  /** Build the full authoring input. Only called once the company is confirmed quiescent. */
  buildGenerateInput: () => Parameters<typeof generateFinalFounderReport>[0];
};

/**
 * Decide whether the company is quiescent and, if so, how to author its Final Founder Report. Shared
 * by the enqueue check on the scheduler tick and the job runner, so both see the same derivation.
 * Returns `null` when a report can never be authored for this company right now (not `active`, no
 * tasks, or no CEO Agent adapter available). The heavy repository reads for the authoring input are
 * deferred to `buildGenerateInput` so the common not-quiescent sweep stays cheap.
 */
function gatherFinalFounderReportContext(
  input: RunFinalFounderReportJobsInput,
  company: Company,
  now: () => Date,
  createId: (prefix: string) => string,
): FinalFounderReportContext | null {
  const repositories = input.repositories;
  // Only a running company with real work can be quiescent. A `creating` / `creation_failed` /
  // `draft` / `paused` company is not "done", it just is not going yet.
  if (company.status !== "active") {
    return null;
  }

  const tasks = repositories.listTasksForCompany(company.id);
  if (tasks.length === 0) {
    return null;
  }
  const ceoAgent = input.adapters.find((adapter) => adapter.id === company.selectedCeoAgentId);
  if (!ceoAgent) {
    // The company's selected CEO Agent adapter is not registered with this runtime. Neither the
    // authored run nor the deterministic fallback can execute without it, so no job is enqueued and
    // no "preparing" indicator shows. In practice the scheduler loop always carries the same adapter
    // set the company was created against, so this is a misconfiguration guard, not a normal path.
    return null;
  }

  const keyResults = repositories.listKeyResults(company.id);
  const taskDependencies = repositories.listTaskDependenciesForCompany(company.id);
  const taskCompletionEvents = repositories.listTaskCompletionEventsForCompany(company.id);

  const attention = projectCeoAttention({
    company,
    keyResults,
    tasks,
    taskCompletionEvents,
    taskDependencies,
    humanActionConfirmations: repositories.listHumanActionConfirmationsForCompany(company.id),
    founderDecisionResolutions: repositories.listFounderDecisionResolutionsForCompany(company.id),
    now,
  });

  const quiescent = isCompanyQuiescent({
    tasks,
    waitStates: attention.waitStates,
    humanActions: attention.humanActions,
    founderDecisions: attention.founderDecisions,
    now,
  });

  return {
    quiescent,
    buildGenerateInput: () => ({
      projectRoot: input.projectRoot,
      repositories,
      company,
      classification: classifyFinalFounderReport({
        keyResults,
        waitStates: attention.waitStates,
        humanActions: attention.humanActions,
        founderDecisions: attention.founderDecisions,
      }),
      ceoAgent,
      tasks,
      departments: repositories.listDepartments(company.id),
      objectives: repositories.listObjectives(company.id),
      keyResults,
      taskCompletionEvents,
      businessArtifacts: repositories.listBusinessArtifactsForCompany(company.id),
      taskDependencies,
      visionGaps: attention.visionGaps,
      waitStates: attention.waitStates,
      humanActions: attention.humanActions,
      founderDecisions: attention.founderDecisions,
      agentSessionManager: input.agentSessionManager,
      agentSessionEnv: input.agentSessionEnv,
      now,
      createId,
    }),
  };
}

/**
 * Does the company's standing `isCurrent` Final Founder Report still cover everything, so a fresh one
 * would be redundant? True when a report exists and no Task Completion Event post-dates it — a
 * repeated quiescent tick or a bare Wait State check-in. Non-Wait-State work completing since the
 * report is what releases this, so the next report supersedes the standing one. Shared by the enqueue
 * check and the job runner so both gate on the same rule.
 */
function standingReportCoversCompany(
  repositories: ReturnType<typeof createRepositories>,
  companyId: string,
): boolean {
  const currentReport = repositories.getCurrentFinalFounderReport(companyId);
  return (
    currentReport !== null &&
    !hasWorkCompletedSinceReport(
      repositories.listTaskCompletionEventsForCompany(companyId),
      currentReport,
    )
  );
}

/**
 * One-time upgrade pass (ADR 0018 §Upgrade regeneration), run on the scheduler tick alongside the
 * ADR 0017 review reconciliation. A company that finished before the Final Founder Report shipped —
 * quiescent, every task `complete`, no report — gets exactly one report generation job enqueued
 * here. `runFinalFounderReportJobs` then authors it from the accepted Business Artifacts that already
 * exist, falling back deterministically if the CEO Agent run fails. No task is re-run and no per-task
 * Task Outcome Summary is synthesized for old work. A per-company marker in `runtime_state` makes
 * every later tick a no-op.
 *
 * Companies with a non-`complete` task are left to `maybeEnqueueFinalFounderReportJob`, which gives
 * them a normal report on their next quiescent tick; companies that already have a report (or an
 * in-flight job) are left alone. Safe to run more than once before the marker is set — the standing
 * report / job checks stop a duplicate.
 */
export function reconcileFinalFounderReportUpgrade(
  input: RunSchedulerOnceInput,
  company: Company,
  now: () => Date,
  createId: (prefix: string) => string,
): void {
  const repositories = input.repositories;
  if (repositories.hasFinalFounderReportUpgradeRun(company.id)) {
    return;
  }

  const tasks = repositories.listTasksForCompany(company.id);
  const everyTaskComplete = tasks.length > 0 && tasks.every((task) => task.status === "complete");
  const alreadyReported =
    repositories.getCurrentFinalFounderReport(company.id) !== null ||
    repositories.getActiveFinalFounderReportJob(company.id) !== null;

  if (everyTaskComplete && !alreadyReported) {
    const context = gatherFinalFounderReportContext(input, company, now, createId);
    if (context?.quiescent) {
      const timestamp = now().toISOString();
      repositories.createFinalFounderReportJob({
        id: createId("founder_report_job"),
        companyId: company.id,
        status: "preparing",
        createdAt: timestamp,
        updatedAt: timestamp,
        finishedAt: null,
        failureMessage: null,
      });
    }
  }

  repositories.markFinalFounderReportUpgradeRun(company.id, now().toISOString());
}

function maybeEnqueueFinalFounderReportJob(
  input: RunSchedulerOnceInput,
  company: Company,
  now: () => Date,
  createId: (prefix: string) => string,
): void {
  const repositories = input.repositories;
  if (standingReportCoversCompany(repositories, company.id)) {
    return;
  }
  if (repositories.getActiveFinalFounderReportJob(company.id)) {
    return;
  }

  const context = gatherFinalFounderReportContext(input, company, now, createId);
  if (!context || !context.quiescent) {
    return;
  }

  const timestamp = now().toISOString();
  repositories.createFinalFounderReportJob({
    id: createId("founder_report_job"),
    companyId: company.id,
    status: "preparing",
    createdAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    failureMessage: null,
  });
}

/**
 * Author the Final Founder Report for every `preparing` job. Runs the CEO Agent authoring path
 * (`generateFinalFounderReport`, which retries to a ceiling then falls back to a deterministic
 * report) off the scheduler tick that enqueued the job, then marks the job `complete` and publishes
 * a `company_report_ready` event so the dashboard refetches. A job whose company is no longer
 * quiescent, or an unexpected failure, marks the job `failed`; the next quiescent tick re-enqueues.
 */
export async function runFinalFounderReportJobs(input: RunFinalFounderReportJobsInput): Promise<void> {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const repositories = input.repositories;

  for (const job of repositories.listPendingFinalFounderReportJobs()) {
    const company = repositories.getCompany(job.companyId);

    if (company && standingReportCoversCompany(repositories, company.id)) {
      // A report already stands and nothing has completed since (two jobs raced, or one was enqueued
      // twice). Close this one without regenerating. When work has completed the job falls through
      // and `generateFinalFounderReport` supersedes the standing report.
      repositories.updateFinalFounderReportJobStatus(job.id, "complete", now().toISOString());
      continue;
    }

    const context = company ? gatherFinalFounderReportContext(input, company, now, createId) : null;
    if (!context || !context.quiescent) {
      repositories.updateFinalFounderReportJobStatus(
        job.id,
        "failed",
        now().toISOString(),
        "Company was no longer quiescent when the report job ran.",
      );
      continue;
    }

    try {
      await generateFinalFounderReport(context.buildGenerateInput());
      repositories.updateFinalFounderReportJobStatus(job.id, "complete", now().toISOString());
      input.emit({
        type: "company_report_ready",
        companyId: job.companyId,
        message: "Final Founder Report ready.",
      });
    } catch (error) {
      // `generateFinalFounderReport` persists a report on any agent outcome (retry then deterministic
      // fallback), so this only fires on an unexpected failure such as the DB write.
      repositories.updateFinalFounderReportJobStatus(
        job.id,
        "failed",
        now().toISOString(),
        (error as Error).message,
      );
    }
  }
}

function assessDepartmentTask(input: RunSchedulerOnceInput, task: Task): "ready" | "deferred" {
  if ((task.taskKind ?? "parent") !== "parent" || hasAssessment(input.repositories, task.id)) {
    return "ready";
  }

  appendTaskProgressEvent(input, {
    task,
    step: "received",
    status: "complete",
    label: "Received CEO task",
    subjectTaskId: null,
  });
  appendTaskProgressEvent(input, {
    task,
    step: "assessment_complete",
    status: "complete",
    label: "Assessment complete",
    subjectTaskId: null,
  });

  // A verifying task is never split: its targets and requirements belong to it, and a split template
  // would hand them to subtasks as plain context.
  // Splitting is the plan's decision, declared per task; the runtime does not read it out of the
  // task's wording (ADR 0029). The verifier check stays as a floor: a verification task is never split.
  if (!task.decomposition || isVerifyingTask(input.repositories, task)) {
    appendTaskProgressEvent(input, {
      task,
      step: "no_split_needed",
      status: "complete",
      label: "No split needed",
      subjectTaskId: task.id,
    });
    return "ready";
  }

  const subtasks = createDepartmentSubtasks(input, task);
  const dependencyNote = `Waiting for department subtasks: ${subtasks.map((subtask) => subtask.title).join(", ")}.`;
  applyTaskTransition({
    repositories: input.repositories,
    task,
    status: "waiting_dependency",
    executionSummary: { dependencyNote },
    hold: {
      kind: "awaiting_dependency_artifact",
      resolver: "upstream_task",
      subjectKind: "task",
      subjectId: subtasks[0]?.id ?? null,
      reason: dependencyNote,
    },
    now: input.now,
    createId: input.createId,
  });
  appendTaskProgressEvent(input, {
    task,
    step: "split_complete",
    status: "complete",
    label: "Split complete",
    subjectTaskId: null,
  });
  appendTaskProgressEvent(input, {
    task,
    step: "executing",
    status: "current",
    label: `Task 1 (${subtasks[0].title}) waiting`,
    subjectTaskId: subtasks[0].id,
  });

  return "deferred";
}

function hasAssessment(repositories: ReturnType<typeof createRepositories>, taskId: string): boolean {
  return repositories
    .listTaskProgressEventsForParentTask(taskId)
    .some((event) => event.step === "assessment_complete");
}

/**
 * The department split template. Each stage declares the sibling outputs it consumes and in what role,
 * so the execution order and the verification handoff are dependency edges — not array order, titles,
 * or whichever stage happens to be dispatched first. Every stage also inherits the parent's own
 * upstream dependencies as context.
 */
type DepartmentSubtaskStage = "define" | "execute" | "validate";

type DepartmentSubtaskBlueprint = {
  stage: DepartmentSubtaskStage;
  title: string;
  description: string;
  proofSchemaId: string;
  inputs: Array<{ stage: DepartmentSubtaskStage; role: DependencyInputRole; handoffContract: string }>;
};

function createDepartmentSubtasks(input: RunSchedulerOnceInput, parentTask: Task): Task[] {
  const createId = input.createId ?? defaultCreateId;
  const inheritedDependencies = input.repositories.listTaskDependencies(parentTask.id);
  const subtaskBlueprints: DepartmentSubtaskBlueprint[] = [
    {
      stage: "define",
      title: `Define executable slice for ${parentTask.title}`,
      description: `Assess scope, dependencies, and proof criteria for the parent task: ${parentTask.title}.`,
      proofSchemaId: "product-brief",
      inputs: [],
    },
    {
      stage: "execute",
      title: `Execute ${parentTask.title}`,
      description: parentTask.description,
      proofSchemaId: parentTask.proofSchemaId,
      inputs: [
        { stage: "define", role: "context", handoffContract: "Implement the executable slice and scope defined upstream." },
      ],
    },
    {
      stage: "validate",
      title: `Validate proof for ${parentTask.title}`,
      description: `Validate the output and prepare parent-task proof for: ${parentTask.title}.`,
      proofSchemaId: "test-output",
      inputs: [
        { stage: "define", role: "verification_requirements", handoffContract: "Verify every requirement declared upstream." },
        { stage: "execute", role: "verification_target", handoffContract: "Verify the snapshot of the executed output." },
      ],
    },
  ];

  const subtasksByStage = new Map<DepartmentSubtaskStage, Task>();
  for (const blueprint of subtaskBlueprints) {
    const subtaskId = createId("department_subtask");
    const taskWorkspace = createTaskWorkspace(input.projectRoot, subtaskId);
    const subtask: Task = {
      id: subtaskId,
      companyId: parentTask.companyId,
      departmentId: parentTask.departmentId,
      keyResultId: parentTask.keyResultId,
      title: blueprint.title,
      description: blueprint.description,
      assigneeAgentId: parentTask.assigneeAgentId,
      requiredCapabilities: parentTask.requiredCapabilities,
      proofSchemaId: blueprint.proofSchemaId,
      workspacePath: taskWorkspace.root,
      artifactWorkspacePath: blueprint.proofSchemaId === parentTask.proofSchemaId ? taskWorkspace.root : null,
      status: "queued",
      riskLevel: parentTask.riskLevel,
      position: input.repositories.getNextTaskPosition(parentTask.companyId),
      latestFailureReason: null,
      latestFailureMessage: null,
      latestExecutionProfileName: null,
      latestRequestedTimeoutMs: null,
      latestEffectiveTimeoutMs: null,
      dependencyNote: null,
      parentTaskId: parentTask.id,
      taskKind: "department_subtask",
      source: "department",
    };
    input.repositories.createTask(subtask);
    for (const dependency of inheritedDependencies) {
      input.repositories.createTaskDependency({
        taskId: subtask.id,
        dependsOnTaskId: dependency.dependsOnTaskId,
        handoffContract: dependency.handoffContract,
        handoffContractText: dependency.handoffContractText,
      });
    }
    for (const declared of blueprint.inputs) {
      const producer = subtasksByStage.get(declared.stage);
      if (!producer) {
        throw new Error(`Department subtask ${blueprint.stage} consumes ${declared.stage}, which is not created before it.`);
      }
      input.repositories.createTaskDependency({
        taskId: subtask.id,
        dependsOnTaskId: producer.id,
        handoffContract: declared.handoffContract,
        inputRole: declared.role,
      });
    }
    input.repositories.createTaskDependency({
      taskId: parentTask.id,
      dependsOnTaskId: subtask.id,
      handoffContract: "Contribute to the parent task proof summary.",
    });
    subtasksByStage.set(blueprint.stage, subtask);
  }

  return [...subtasksByStage.values()];
}

function appendTaskProgressEvent(
  input: RunSchedulerOnceInput,
  event: {
    task: Task;
    step: TaskProgressEvent["step"];
    status: TaskProgressEvent["status"];
    label: string;
    detail?: string | null;
    subjectTaskId: string | null;
  },
): void {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const parentTaskId = event.task.parentTaskId ?? event.task.id;
  const existing = input.repositories
    .listTaskProgressEventsForParentTask(parentTaskId)
    .some(
      (candidate) =>
        candidate.step === event.step &&
        candidate.subjectTaskId === event.subjectTaskId &&
        candidate.label === event.label,
    );

  if (existing) {
    return;
  }

  input.repositories.appendTaskProgressEvent({
    id: createId("task_progress"),
    companyId: event.task.companyId,
    departmentId: event.task.departmentId,
    parentTaskId,
    subjectTaskId: event.subjectTaskId,
    step: event.step,
    status: event.status,
    label: event.label,
    detail: event.detail ?? null,
    createdAt: now().toISOString(),
  });
}

function resolveRunWorkspace(repositories: ReturnType<typeof createRepositories>, task: Task): string | null {
  // Only context inputs continue in a producer's workspace. A verifier works on a runtime snapshot in
  // its own workspace (see prepareVerificationInputs), so it cannot alter the output it judges.
  const dependencies = repositories
    .listTaskDependencies(task.id)
    .filter((dependency) => (dependency.inputRole ?? "context") === "context");
  const producer = dependencies
    .map((dependency) => repositories.getTask(dependency.dependsOnTaskId))
    .find((dependency): dependency is Task => Boolean(dependency?.artifactWorkspacePath));

  return producer?.artifactWorkspacePath ?? null;
}

function blockDirectDependencyConsumers(input: RunSchedulerOnceInput, failedTask: Task): string[] {
  const blocked: string[] = [];
  for (const consumer of input.repositories.listDependencyConsumers(failedTask.id)) {
    if (consumer.status !== "queued") {
      continue;
    }
    blockTaskForDependency(input, consumer, failedTask, "dependency_failed", `Blocked by failed dependency: ${failedTask.title}.`);
    blocked.push(consumer.id);
  }
  return blocked;
}

function createPartialOutputFollowUpTask(
  input: RunSchedulerOnceInput,
  failedTask: Task,
  failureReason: SchedulerFailureReason,
  failureMessage: string,
  logPath: string,
): Task | null {
  if (!failedTask.artifactWorkspacePath || isPartialOutputFollowUpTask(failedTask)) {
    return null;
  }

  const existingFollowUp = input.repositories
    .listTasksForCompany(failedTask.companyId)
    .find((task) => task.description.includes(partialOutputSourceMarker(failedTask.id)));

  if (existingFollowUp) {
    input.repositories.replaceDependencyConsumers(failedTask.id, existingFollowUp.id);
    return existingFollowUp;
  }

  const createId = input.createId ?? defaultCreateId;
  const followUpTask: Task = {
    id: createId("follow_up_task"),
    companyId: failedTask.companyId,
    departmentId: failedTask.departmentId,
    keyResultId: failedTask.keyResultId,
    title: `Continue from Partial Output: ${failedTask.title}`,
    description: buildPartialOutputFollowUpDescription(failedTask, failureReason, failureMessage, logPath),
    assigneeAgentId: failedTask.assigneeAgentId,
    requiredCapabilities: failedTask.requiredCapabilities,
    proofSchemaId: failedTask.proofSchemaId,
    workspacePath: failedTask.artifactWorkspacePath,
    artifactWorkspacePath: failedTask.artifactWorkspacePath,
    status: "queued",
    riskLevel: failedTask.riskLevel,
    position: input.repositories.getNextTaskPosition(failedTask.companyId),
    latestFailureReason: null,
    latestFailureMessage: null,
    latestExecutionProfileName: null,
    latestRequestedTimeoutMs: null,
    latestEffectiveTimeoutMs: null,
    dependencyNote: null,
  };

  input.repositories.createTask(followUpTask);
  input.repositories.replaceDependencyConsumers(failedTask.id, followUpTask.id);
  appendAndEmitTaskEvent(input, {
    task: failedTask,
    type: "task_warning",
    message: `Follow-up task created: ${followUpTask.title} will continue from Partial Output at ${failedTask.artifactWorkspacePath}.`,
    status: "failed",
    artifactWorkspacePath: failedTask.artifactWorkspacePath,
  });

  return followUpTask;
}

function isPartialOutputFollowUpTask(task: Task): boolean {
  return task.description.includes("Partial Output Source Task:");
}

function partialOutputSourceMarker(taskId: string): string {
  return `Partial Output Source Task: ${taskId}`;
}

function buildPartialOutputFollowUpDescription(
  failedTask: Task,
  failureReason: SchedulerFailureReason,
  failureMessage: string,
  logPath: string,
): string {
  return [
    "Continue the failed task from its Partial Output and produce valid Proof for the original proof schema.",
    "",
    partialOutputSourceMarker(failedTask.id),
    `Original Task: ${failedTask.title}`,
    `Original Proof Schema: ${failedTask.proofSchemaId}`,
    `Failure Reason: ${failureReason}`,
    `Failure Message: ${failureMessage}`,
    `Partial Output Workspace: ${failedTask.artifactWorkspacePath}`,
    `Agent Log: ${logPath}`,
    "",
    "Partial Output is not Proof. Inspect and improve the existing files, keep useful work, and finish the missing deliverable.",
    ...buildProofContractInstructions(failedTask),
    "Do not mark the task complete unless you leave proof that satisfies the original proof schema.",
  ].join("\n");
}

/**
 * Whether dispatching this task needs Founder Approval under its own company's Permission Mode.
 *
 * Deliberately coarse: one pre-dispatch question, using `run_safe_command` as the proxy for the
 * whole task, because the runtime does not yet know which actions an Agent Run will take. Per-action
 * approval during execution is a separate, larger change; what matters here is that the company's
 * Permission Mode is the input, not a hardcoded default.
 */
export function requiresFounderApproval(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
): boolean {
  return grantNeedsFounderApproval({
    needs: resolveTaskCapabilityNeeds(task),
    policy: policyForTask(repositories, task),
  });
}

/**
 * What this task's Agent Run is permitted to do: what the deliverable needs, narrowed by the
 * company's Permission Mode. Resolved here, once, so no adapter has to look at a task (ADR 0021).
 */
export function resolveTaskAgentGrant(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
): AgentCapabilityGrant {
  return resolveAgentCapabilityGrant({
    needs: resolveTaskCapabilityNeeds(task),
    policy: policyForTask(repositories, task),
  });
}

function policyForTask(repositories: ReturnType<typeof createRepositories>, task: Task) {
  return resolvePolicyForPermissionMode(repositories.getCompany(task.companyId)?.permissionMode ?? null);
}

function blockTaskForDependency(
  input: RunSchedulerOnceInput,
  task: Task,
  dependency: Task,
  failureReason: Extract<SchedulerFailureReason, "dependency_failed" | "needs_replan">,
  dependencyNote: string,
): void {
  const failureMessage = `Task blocked: ${task.title} / ${failureReason} / ${dependency.title} is ${dependency.status}.`;
  applyTaskTransition({
    repositories: input.repositories,
    task,
    status: "blocked",
    executionSummary: {
      latestFailureReason: failureReason,
      latestFailureMessage: failureMessage,
      dependencyNote,
    },
    hold: {
      kind: "awaiting_dependency_artifact",
      resolver: "upstream_task",
      subjectKind: "task",
      subjectId: dependency.id,
      reason: dependencyNote,
    },
    now: input.now,
    createId: input.createId,
  });
  appendAndEmitTaskEvent(input, {
    task,
    type: "task_blocked",
    message: failureMessage,
    status: "blocked",
    failureReason,
    failureMessage,
    dependencyNote,
    blockedByTaskId: dependency.id,
  });
  recordTaskCompletionEvent({
    repositories: input.repositories,
    task,
    outcome: "blocked",
    dependencyImpact: {
      blockedByTaskId: dependency.id,
      reason: failureReason,
    },
    now: input.now,
    createId: input.createId,
  });
}

function blockTaskForMissingDeliverable(
  input: RunSchedulerOnceInput,
  task: Task,
  dependency: Task,
  dependencyNote: string,
): void {
  const failureReason = "missing_deliverable";
  const failureMessage = `Task blocked: ${task.title} / missing_deliverable / ${dependency.title} has no accepted business artifact.`;
  applyTaskTransition({
    repositories: input.repositories,
    task,
    status: "blocked",
    executionSummary: {
      latestFailureReason: failureReason,
      latestFailureMessage: failureMessage,
      dependencyNote,
    },
    hold: {
      kind: "awaiting_dependency_artifact",
      resolver: "upstream_task",
      subjectKind: "task",
      subjectId: dependency.id,
      reason: dependencyNote,
    },
    now: input.now,
    createId: input.createId,
  });
  appendAndEmitTaskEvent(input, {
    task,
    type: "deliverable_missing",
    message: failureMessage,
    status: "blocked",
    failureReason,
    failureMessage,
    dependencyNote,
    blockedByTaskId: dependency.id,
  });
  recordTaskCompletionEvent({
    repositories: input.repositories,
    task,
    outcome: "blocked",
    dependencyImpact: {
      blockedByTaskId: dependency.id,
      reason: failureReason,
    },
    now: input.now,
    createId: input.createId,
  });
}

function unconfirmedTerminationMessage(task: Task, workspacePath: string): string {
  return `Task stopped: ${task.title} / termination_unconfirmed / the run was signalled to stop and never seen to exit, so ${workspacePath} may still have a writer in it.`;
}

/**
 * Park a task whose run could not be confirmed dead, and keep its workspace out of use.
 *
 * The ordinary failure path offers recovery, which re-runs the work in the same directory — the one
 * thing that must not happen while a process may still be writing there. So the claim survives the
 * run that took it, and only a person saying the process is gone releases it. An unconfirmed
 * termination also does not count against the Bounded Recovery ceiling: nothing was attempted and
 * failed, the runtime simply lost track.
 */
function isolateForUnconfirmedTermination(
  settled: RunSchedulerOnceInput,
  result: RunSchedulerOnceResult,
  task: Task,
  agentRunId: string,
  workspacePath: string,
  now: () => Date,
  createId: (prefix: string) => string,
): void {
  const message = unconfirmedTerminationMessage(task, workspacePath);
  settled.repositories.isolateWorkspaceClaim(workspacePath, agentRunId, message);
  applyTaskTransition({
    repositories: settled.repositories,
    task,
    status: "blocked",
    executionSummary: {
      latestFailureReason: "termination_unconfirmed",
      latestFailureMessage: message,
    },
    hold: {
      kind: "termination_unconfirmed",
      resolver: "founder",
      subjectKind: "agent_run",
      subjectId: agentRunId,
      reason: message,
    },
    now,
    createId,
  });
  appendAndEmitTaskEvent(settled, {
    task,
    type: "task_blocked",
    failureReason: "termination_unconfirmed",
    failureMessage: message,
    message,
    status: "blocked",
  });
  result.blocked.push(task.id, ...blockDirectDependencyConsumers(settled, task));
  emitParentTaskAggregationEvents(settled, task);
}

/** Whether this task's next failure is its last: the Bounded Recovery ceiling is reached. */
function atRetryCeiling(input: RunSchedulerOnceInput, task: Task): boolean {
  return taskAttemptCount(input.repositories, task.id) >= MAX_TASK_ATTEMPTS;
}

/** How a run settles when its task has reached the ceiling: the reason is the ceiling, not the failure. */
function retryCeilingOutcome(task: Task): RunOutcome {
  return { status: "failed", failureReason: "retry_exhausted", failureMessage: retryExhaustedFailureMessage(task) };
}

/**
 * Terminate a task that has hit the Bounded Recovery ceiling as `blocked` / `retry_exhausted` and
 * route it to the CEO Blocked Queue.
 *
 * Only ever called from inside a settlement that has already claimed the run: this writes the Task,
 * its Hold and its completion event, and a caller that does not own the run must write none of them.
 * It used to settle the run itself, with an unconditional update, which let a dispatch that had
 * already lost overwrite the winner's outcome and leave the task carrying both writers' Holds.
 */
function terminateAtRetryCeiling(
  settled: RunSchedulerOnceInput,
  result: RunSchedulerOnceResult,
  task: Task,
  timeoutResolution: ReturnType<typeof resolveEffectiveTimeout>,
  now: () => Date,
  createId: (prefix: string) => string,
): void {
  result.blocked.push(task.id, ...terminateAsRetryExhausted(settled, task, timeoutResolution, now, createId));
}

/**
 * How long a lock stays valid without renewal, when the caller names no other value.
 *
 * Comfortably longer than the heartbeat that renews it, so an ordinary pause — a slow write, a busy
 * event loop — never costs a live dispatch its task. It is a liveness window, not a budget: a run
 * that outlives it while renewing is untouched.
 */
export const DEFAULT_EXECUTION_LEASE_MS = 90_000;

/**
 * Put a task back because the directory it needs is being written by someone else.
 *
 * Not a failure and not a Hold: nothing is wrong with the task, and nobody has to act. It waits for
 * the directory the way it waits for a dependency, and the next tick tries again.
 */
function requeueForBusyWorkspace(
  input: RunSchedulerOnceInput,
  task: Task,
  workspacePath: string,
  now: () => Date,
  createId: (prefix: string) => string,
): void {
  const claim = input.repositories.listWorkspaceClaims().find((held) => held.workspacePath === workspacePath);
  const note = claim?.isolatedReason
    ? `Workspace ${workspacePath} is isolated: ${claim.isolatedReason}`
    : `Workspace ${workspacePath} is being written by another run.`;
  applyTaskTransition({
    repositories: input.repositories,
    task,
    status: "queued",
    executionSummary: { dependencyNote: note },
    resolution: "cleared",
    now,
    createId,
  });
  appendAndEmitTaskEvent(input, {
    task,
    type: "task_warning",
    message: `Task warning: ${task.title} / ${note}`,
    status: "queued",
    dependencyNote: note,
  });
}

function leaseExpiryFrom(now: Date, leaseMs: number | undefined): string {
  return new Date(now.getTime() + (leaseMs ?? DEFAULT_EXECUTION_LEASE_MS)).toISOString();
}

/**
 * Beat on a clock of the runtime's own, so a heartbeat can never be mistaken for the agent's output.
 *
 * Unreferenced, so an interval outliving its dispatch cannot hold the process open; `stop` is called
 * from the dispatch's `finally` either way. An interval of zero means the deterministic beats at
 * phase boundaries are the only ones, which is what tests run with.
 */
function startHeartbeat(beat: () => void, intervalMs: number | undefined): { stop: () => void } {
  if (!intervalMs || intervalMs <= 0) {
    return { stop: () => undefined };
  }
  const timer = setInterval(beat, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

/**
 * Surface observation that did not land, without letting it decide anything.
 *
 * A database that refused a log line says the run is unobserved, not that it failed. It is reported
 * as a task warning so a reader knows this run's activity is incomplete rather than quiet.
 */
function reportObservationFailures(
  input: RunSchedulerOnceInput,
  task: Task,
  observer: RunObserver | null,
): void {
  const failures = observer?.observationFailures() ?? [];
  if (failures.length === 0) {
    return;
  }
  appendAndEmitTaskEvent(input, {
    task,
    type: "task_warning",
    message: `Task warning: ${task.title} / execution observation incomplete (${failures.length} write${
      failures.length === 1 ? "" : "s"
    } failed) / ${failures[0].message}`,
  });
}

/**
 * Settle a run and everything that settlement owns, or leave the database exactly as it was.
 *
 * Two writers reach every run: the dispatch settling its delivery, and whoever declares the run timed
 * out (`reconcileStaleRunningTasks`, called by supervision, scheduling or explicit recovery). Claiming the run is a
 * conditional update that lands only while it is still `running`, so the loser learns it lost before
 * writing anything (ADR 0034).
 *
 * The claim alone was not enough, because a settlement is not one write. The Business Artifact, the
 * proof rows, the artifact pointer, the Task transition, the Hold and the completion events are
 * separate statements after it, and anything that interrupted the sequence left a run recorded as
 * finished beside a task still recorded as running — a state no reconcile could see, because
 * reconciliation reads `running` runs and this one was settled. So the claim and every write it
 * authorises are one transaction: they all land or none do.
 *
 * The claim is deliberately the transaction's *first* statement. A transaction that reads before it
 * writes holds only a read snapshot, and under a second connection the upgrade to a write fails
 * outright once anyone else has committed — `busy_timeout` does not help, because the snapshot is
 * stale rather than the lock busy. Claiming first takes the write lock up front, which is also
 * exactly the order ADR 0034 requires. `multiConnection.test.ts` pins both halves.
 *
 * `commit` receives a scheduler input whose `emit` is buffered: events reach subscribers only once
 * the transaction has committed, so a settlement that rolls back never announces itself. Persisting
 * those events is still part of the transaction.
 */
function settleObservedRun(
  input: RunSchedulerOnceInput,
  agentRunId: string,
  outcome: RunOutcome,
  now: () => Date,
  commit: (settled: RunSchedulerOnceInput) => void = () => undefined,
): boolean {
  const announcements: SchedulerEvent[] = [];
  const settled: RunSchedulerOnceInput = { ...input, emit: (event) => announcements.push(event) };

  const won = settleAgentRun({
    repositories: input.repositories, runId: agentRunId, outcome,
    at: now().toISOString(), createId: input.createId ?? defaultCreateId,
    commit: () => commit(settled),
  });

  if (won) {
    for (const announcement of announcements) {
      input.emit(announcement);
    }
  }
  return won;
}

/** Record the delivery this settlement captured, once its run is claimed. */
function persistArtifact(input: RunSchedulerOnceInput, artifact: BusinessArtifact | null): void {
  if (artifact) {
    input.repositories.createBusinessArtifact(artifact);
  }
}

function terminateAsRetryExhausted(
  input: RunSchedulerOnceInput,
  task: Task,
  timeoutResolution: ReturnType<typeof resolveEffectiveTimeout>,
  now: () => Date,
  createId: (prefix: string) => string,
): string[] {
  const blockedConsumerIds = blockDirectDependencyConsumers(input, task);
  const termination = terminateTaskAsRetryExhausted({
    repositories: input.repositories,
    task,
    executionProfileName: timeoutResolution.executionProfile.name,
    requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
    effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
    dependencyImpact: { blockedTaskIds: blockedConsumerIds, reason: "retry_exhausted" },
    now,
    createId,
  });
  if (termination) {
    emitTaskEvent(input, termination.taskEvent);
  }
  emitParentTaskAggregationEvents(input, task);
  return blockedConsumerIds;
}

function artifactSyntaxRepairMessage(task: Task, repair: ArtifactSyntaxRepair): string {
  const prefix = `Business artifact of ${task.title} was not valid JSON (${repair.syntaxError})`;
  switch (repair.outcome) {
    case "repaired":
      return `${prefix}; its syntax was repaired without changing content.`;
    case "still_invalid":
      return `${prefix}; a syntax repair did not make it parse.`;
    case "content_changed":
      return `${prefix}; a syntax repair changed its content and was discarded.`;
    case "run_failed":
      return `${prefix}; the syntax repair run did not complete.`;
  }
}

function appendAndEmitTaskEvent(
  input: RunSchedulerOnceInput,
  event: {
    task: Task;
    type: TaskEvent["type"];
    message: string;
    status?: TaskStatus;
    failureReason?: SchedulerFailureReason;
    failureMessage?: string;
    executionProfileName?: string;
    requestedTimeoutMs?: number;
    effectiveTimeoutMs?: number;
    dependencyNote?: string;
    artifactWorkspacePath?: string;
    executionBrief?: TaskEvent["executionBrief"];
    blockedByTaskId?: string;
  },
): void {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const record: TaskEvent = {
    id: createId("task_event"),
    companyId: event.task.companyId,
    taskId: event.task.id,
    type: event.type,
    executionBrief: event.executionBrief,
    blockedByTaskId: event.blockedByTaskId,
    message: event.message,
    createdAt: now().toISOString(),
    status: event.status ?? null,
    failureReason: event.failureReason ?? null,
    failureMessage: event.failureMessage ?? null,
    executionProfileName: event.executionProfileName ?? null,
    requestedTimeoutMs: event.requestedTimeoutMs ?? null,
    effectiveTimeoutMs: event.effectiveTimeoutMs ?? null,
    dependencyNote: event.dependencyNote ?? null,
    artifactWorkspacePath: event.artifactWorkspacePath ?? null,
  };
  input.repositories.appendTaskEvent(record);
  emitTaskEvent(input, record);
}

function emitParentTaskAggregationEvents(input: RunSchedulerOnceInput, task: Task): void {
  if ((task.taskKind ?? "parent") !== "department_subtask") {
    return;
  }

  const aggregation = propagateParentTaskAggregation({
    repositories: input.repositories,
    sourceSubtaskId: task.id,
    now: input.now,
    createId: input.createId,
  });
  for (const update of aggregation.updatedTasks) {
    if (update.event) {
      emitTaskEvent(input, update.event);
    }
  }
}

function emitTaskEvent(input: RunSchedulerOnceInput, record: TaskEvent): void {
  input.emit({
    type: record.type,
    taskId: record.taskId,
    message: record.message,
    status: record.status ?? undefined,
    failureReason: record.failureReason ?? undefined,
    failureMessage: record.failureMessage ?? undefined,
    executionProfileName: record.executionProfileName ?? undefined,
    requestedTimeoutMs: record.requestedTimeoutMs ?? undefined,
    effectiveTimeoutMs: record.effectiveTimeoutMs ?? undefined,
    dependencyNote: record.dependencyNote ?? undefined,
    artifactWorkspacePath: record.artifactWorkspacePath ?? undefined,
  });
}

/** Adapters that may run `task`, most preferred first: its assignee, then capability matches. */
function adapterCandidates(adapters: AgentAdapter[], task: Task): AgentAdapter[] {
  const byAssignee = adapters.filter((adapter) => adapter.id === task.assigneeAgentId);
  const byCapability = adapters.filter(
    (adapter) =>
      adapter.id !== task.assigneeAgentId &&
      task.requiredCapabilities.every((capability) => adapter.capabilities.includes(capability)),
  );
  const candidates = [...byAssignee, ...byCapability];

  if (candidates.length === 0) {
    throw new Error(`No adapter available for task ${task.id}`);
  }

  return candidates;
}

/**
 * Records why a task is not being dispatched. The scheduler re-checks every tick, so the warning is
 * appended only when it differs from the task's latest event.
 */
function appendLaunchUnavailableWarningOnce(
  input: RunSchedulerOnceInput,
  task: Task,
  unavailable: AdapterLaunchSupport[],
): void {
  const reasons = unavailable.flatMap((support) => support.warnings).join(" ");
  const message = `Task warning: ${task.title} / not dispatched: no agent adapter can launch it / ${reasons}`;
  const latest = input.repositories
    .listTaskEventsForCompany(task.companyId)
    .filter((event) => event.taskId === task.id)
    .at(-1);
  if (latest?.message === message) {
    return;
  }
  appendAndEmitTaskEvent(input, { task, type: "task_warning", message });
}

function createLogPath(projectRoot: string, task: Task): string {
  const logsDir = join(projectRoot, ".auto-crop", "companies", task.companyId, "logs");
  mkdirSync(logsDir, { recursive: true });
  return join(logsDir, `${task.id}.log`);
}

function businessArtifactFailureReason(artifact: BusinessArtifact | null): SchedulerFailureReason {
  if (!artifact) {
    return "missing_business_artifact";
  }
  if (artifact.validationStatus === "invalid_drift") {
    return "direction_drift";
  }
  if (artifact.validationStatus === "stale" || !artifact.isCurrent) {
    return "stale_business_artifact";
  }
  if (artifact.validationStatus !== "valid") {
    return hasArtifactReason(artifact, "missing_business_artifact_file")
      ? "missing_business_artifact"
      : "invalid_business_artifact";
  }
  return "non_reviewable_artifact";
}

function businessArtifactFailureMessage(task: Task, artifact: BusinessArtifact | null): string {
  if (!artifact) {
    return `Task blocked: ${task.title} / missing_business_artifact.`;
  }
  const errors = artifact.validationErrors.length > 0 ? ` / ${JSON.stringify(artifact.validationErrors)}` : "";
  return `Task blocked: ${task.title} / ${businessArtifactFailureReason(artifact)} / ${artifact.artifactKind}/${artifact.artifactRole}/${artifact.artifactSubtype}${errors}.`;
}

function hasArtifactReason(artifact: BusinessArtifact, reason: string): boolean {
  return (
    typeof artifact.payload === "object" &&
    artifact.payload !== null &&
    !Array.isArray(artifact.payload) &&
    "reason" in artifact.payload &&
    artifact.payload.reason === reason
  );
}

function replanMessage(task: Task, timeoutMs: number): string {
  return `Task needs replanning: ${task.title} / exceeded long budget ${formatExecutionBudget(timeoutMs)}.`;
}

function failureMessage(
  task: Task,
  failureReason: SchedulerFailureReason,
  timeoutMs: number,
  refutedCapability?: string | null,
): string {
  // A refuted capability claim explains the failure better than the generic reason does: the agent
  // reported an environment limit the runtime knows it did not impose (ADR 0021).
  if (refutedCapability) {
    return `Task failed: ${task.title} / ${failureReason} / the run reported \`${refutedCapability}\` as unavailable, but it was granted.`;
  }

  if (failureReason === "timeout") {
    return `Task failed: ${task.title} / timeout after ${formatExecutionBudget(timeoutMs)}.`;
  }

  if (failureReason === "no_proof") {
    if (task.proofSchemaId === "repo-diff") {
      return `Task failed: ${task.title} / no_proof / repo-diff proof missing: expected .auto-crop-proof/*.diff or a top-level workspace *.diff/*.patch file; .auto-crop/business-artifact.json is not diff proof.`;
    }
    return `Task failed: ${task.title} / no_proof.`;
  }

  if (failureReason === "proof_capture_failed") {
    return `Task failed: ${task.title} / proof_capture_failed.`;
  }

  if (failureReason === "invalid_agent_output") {
    return `Task failed: ${task.title} / invalid_agent_output / the agent replied but the runtime could not read it; substantive work was not dispatched.`;
  }

  return `Task failed: ${task.title} / agent_failed.`;
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
