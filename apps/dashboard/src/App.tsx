import { ExecutionActionsContext } from "./ui/tasks/TaskExecutionPanel";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createApiClient,
  type AgentSummary,
  type ApiClient,
  type BusinessArtifactSummary,
  type CeoIntakeSummary,
  type CeoOfficeItemSummary,
  type CompanyEventSummary,
  type CompanyListItem,
  type CreateCompanyResponse,
  type FounderDecisionSummary,
  type HumanActionSummary,
  type ProofSummary,
  type ReplanMode,
  type ReplanProposalSummary,
  type ReviewSummary,
  type ServerEvent,
  type TaskCompletionEventSummary,
  type TaskProgressEventSummary,
  type TaskSummary,
  type TaskUpdateBatchSummary,
  type VisionGapSummary,
  type WaitStateSummary,
} from "./api/client";
import { StartupScreen } from "./components/company-flow";
import { operatingCommand, workbenchCommands } from "./components/workbench/workbenchCommands";
import { WorkbenchFrame } from "./components/workbench/WorkbenchFrame";
import {
  ceoOfficeLocation,
  parseLocation,
  serializeLocation,
  type WorkbenchLocation,
} from "./components/workbench/workbenchLocation";
import { CompanyCreationLoading } from "./pages/CompanyCreationLoading";
import { Deliverables } from "./pages/Deliverables";
import { CeoOffice } from "./pages/CeoOffice";
import { DepartmentPage } from "./pages/DepartmentPage";
import { Onboarding, type OnboardingStep } from "./pages/Onboarding";
import { OperationsDiagnostics } from "./pages/OperationsDiagnostics";
import { Settings } from "./pages/Settings";
import { isLanguageId, LanguageProvider, readCurrentLanguage, type LanguageId } from "./ui/language";
import "./styles.css";

export type AppProps = {
  apiClient?: ApiClient;
};

type AgentLoadState = "idle" | "loading" | "ready" | "failed";
type CompanyListLoadState = "loading" | "ready" | "failed";
/** `starting` finds the company to open; `workbench` is every page of an open company. */
type AppView = "starting" | "onboarding" | "creating" | "workbench";
const currentCompanyStorageKey = "auto-crop.currentCompanyId";
const currentViewStorageKey = "auto-crop.currentView";
const creationIdempotencyKeyStorageKey = "auto-crop.creationIdempotencyKey";

export default function App({ apiClient }: AppProps) {
  const client = useMemo(() => apiClient ?? createApiClient(), [apiClient]);
  const defaultLanguage = useMemo(() => getInitialLanguage(), []);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentLoadState, setAgentLoadState] = useState<AgentLoadState>("idle");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyNameError, setCompanyNameError] = useState<string | null>(null);
  const [agentSelectionError, setAgentSelectionError] = useState<string | null>(null);
  const [founderVision, setFounderVision] = useState("");
  const [founderVisionError, setFounderVisionError] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState("balanced");
  const [blueprint, setBlueprint] = useState<CreateCompanyResponse | null>(null);
  // Read by the event-stream callbacks, which outlive the render that subscribed them: the stream
  // stays open across view changes, because events published while it reconnects are lost.
  const companyStatusRef = useRef<string | null>(null);
  companyStatusRef.current = blueprint?.company.status ?? null;
  const companyIdRef = useRef<string | null>(null);
  companyIdRef.current = blueprint?.company.id ?? null;
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [creationEvents, setCreationEvents] = useState<CompanyEventSummary[]>([]);
  const [taskProgressEvents, setTaskProgressEvents] = useState<TaskProgressEventSummary[]>([]);
  const [taskCompletionEvents, setTaskCompletionEvents] = useState<TaskCompletionEventSummary[]>([]);
  const [founderDecisions, setFounderDecisions] = useState<FounderDecisionSummary[]>([]);
  const [ceoIntakes, setCeoIntakes] = useState<CeoIntakeSummary[]>([]);
  const [proof, setProof] = useState<ProofSummary[]>([]);
  const [businessArtifacts, setBusinessArtifacts] = useState<BusinessArtifactSummary[]>([]);
  const [replanProposals, setReplanProposals] = useState<ReplanProposalSummary[]>([]);
  const [humanActions, setHumanActions] = useState<HumanActionSummary[]>([]);
  const [visionGaps, setVisionGaps] = useState<VisionGapSummary[]>([]);
  const [waitStates, setWaitStates] = useState<WaitStateSummary[]>([]);
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [companyListLoadState, setCompanyListLoadState] = useState<CompanyListLoadState>("loading");
  const [companyListLoadError, setCompanyListLoadError] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [view, setView] = useState<AppView>("starting");
  const viewRef = useRef(view);
  viewRef.current = view;
  const [location, setLocation] = useState<WorkbenchLocation>(ceoOfficeLocation);
  // A task the founder followed a link to, brought into view when its department page opens.
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const clearFocusTask = useCallback(() => setFocusTaskId(null), []);
  const locationRef = useRef(location);
  locationRef.current = location;
  // The company the founder left to create a new one, so the Onboarding Wizard can go back to it.
  const [returnCompanyId, setReturnCompanyId] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("company");

  useEffect(() => {
    const companyId = readCurrentCompanyId();
    let cancelled = false;

    if (companyId) {
      void client
        .getCompanyState(companyId)
        .then((response) => {
          if (cancelled) {
            return;
          }
          applyCompanyState(response, readCurrentLocation() ?? ceoOfficeLocation);
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          clearCurrentCompanyId();
          void openStartupCompany({ isCancelled: () => cancelled });
        });
    } else {
      void openStartupCompany({ isCancelled: () => cancelled });
    }

    return () => {
      cancelled = true;
    };
  }, [client]);

  /**
   * With no remembered company, open the most recently updated `active` company, else the most
   * recently updated one, else the Onboarding Wizard (dashboard ADR 0002). There is no picker page.
   */
  async function openStartupCompany(options?: { isCancelled(): boolean }) {
    setView("starting");
    setStartupError(null);
    const list = await loadCompanies(options);
    if (options?.isCancelled?.() || !list) {
      return;
    }
    const companyToOpen = pickStartupCompany(list);
    if (companyToOpen) {
      await openCompany(companyToOpen.id);
    } else {
      setView("onboarding");
    }
  }

  async function loadCompanies(options?: { isCancelled(): boolean }): Promise<CompanyListItem[] | null> {
    setCompanyListLoadState("loading");
    setCompanyListLoadError(null);
    try {
      const response = await client.listCompanies();
      if (options?.isCancelled?.()) {
        return null;
      }
      setCompanies(response.companies);
      setCompanyListLoadState("ready");
      return response.companies;
    } catch (error) {
      if (options?.isCancelled?.()) {
        return null;
      }
      const message = formatErrorMessage(error);
      setCompanies([]);
      setCompanyListLoadError(message);
      setCompanyListLoadState("failed");
      setStartupError(message);
      return null;
    }
  }

  async function openCompany(companyId: string) {
    try {
      const response = await client.getCompanyState(companyId);
      writeCurrentCompanyId(companyId);
      setReturnCompanyId(null);
      applyCompanyState(response, ceoOfficeLocation);
    } catch (error) {
      setStartupError(formatErrorMessage(error));
      setView("starting");
    }
  }

  /**
   * Keeps the live activity stream and task status just received over SSE, and refreshes the
   * authoritative business projection around them without replacing them with a snapshot in flight.
   */
  function adoptBusinessProjection(response: CreateCompanyResponse) {
    setBlueprint(current => current ? { ...current, tasks: adoptSettledTasks(current.tasks, response.tasks),
      // A key result's status follows its tasks on the server (ADR 0048), and a CEO Intake can add
      // goals' tasks, so both come with every snapshot.
      objectives: response.objectives ?? current.objectives, keyResults: response.keyResults ?? current.keyResults,
      ceoOfficeItems: response.ceoOfficeItems,
      finalFounderReport: response.finalFounderReport, finalFounderReportPreparing: response.finalFounderReportPreparing } : current);
    setTaskCompletionEvents(response.taskCompletionEvents ?? []);
    setFounderDecisions(response.founderDecisions ?? []);
    setHumanActions(response.humanActions ?? []);
    setWaitStates(response.waitStates ?? []);
    setVisionGaps(response.visionGaps ?? []);
    setCeoIntakes(response.ceoIntakes ?? []);
    // A task that moved makes its pending proposal stale; the server says so on every read.
    setReplanProposals(response.replanProposals ?? []);
    // Deliverables reads these with nothing to load by hand, so they follow each snapshot.
    setProof(response.proof ?? []);
    setBusinessArtifacts(response.businessArtifacts ?? []);
    setReviews(response.reviews ?? []);
  }

  /** Adopts a company snapshot. Creation shows its own page; a created company opens its Workbench. */
  function applyCompanyState(response: CreateCompanyResponse, nextLocation: WorkbenchLocation = locationRef.current) {
    setBlueprint(response);
    setProof(response.proof ?? []);
    setBusinessArtifacts(response.businessArtifacts ?? []);
    setReviews(response.reviews ?? []);
    setEvents(response.activity ?? []);
    setCreationEvents(response.creationEvents ?? []);
    setTaskProgressEvents(response.taskProgressEvents ?? []);
    setTaskCompletionEvents(response.taskCompletionEvents ?? []);
    setFounderDecisions(response.founderDecisions ?? []);
    setCeoIntakes(response.ceoIntakes ?? []);
    setReplanProposals(response.replanProposals ?? []);
    setHumanActions(response.humanActions ?? []);
    setVisionGaps(response.visionGaps ?? []);
    setWaitStates(response.waitStates ?? []);
    setSelectedAgentId(response.company.selectedCeoAgentId ?? "");
    if (response.company.status !== "creating") {
      clearCreationIdempotencyKey();
    }
    const isCreationStatus = response.company.status === "creating" || response.company.status === "creation_failed";
    setLocation(
      nextLocation.page === "department" && !response.departments.some((department) => department.id === nextLocation.departmentId)
        ? ceoOfficeLocation
        : nextLocation,
    );
    setView(isCreationStatus ? "creating" : "workbench");
  }

  useEffect(() => {
    if (!blueprint || view !== "workbench") {
      return;
    }

    writeCurrentLocation(location);
  }, [blueprint, view, location]);

  // A failed creation offers a way back to another company, so it needs to know which exist.
  const creationFailed = view === "creating" && blueprint?.company.status === "creation_failed";
  useEffect(() => {
    if (creationFailed) void loadCompanies();
  }, [creationFailed]);

  // Deliverables loads by itself (dashboard ADR 0002). Some of what it shows, such as a company
  // review written from the CLI, arrives with no event, so opening the page reads it fresh.
  const companyId = blueprint?.company.id;
  useEffect(() => {
    if (!companyId || view !== "workbench" || location.page !== "deliverables") {
      return;
    }

    let cancelled = false;
    void client
      .getCompanyState(companyId)
      .then((response) => {
        if (cancelled) return;
        setProof(response.proof ?? []);
        setBusinessArtifacts(response.businessArtifacts ?? []);
        setReviews(response.reviews ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, companyId, view, location.page]);

  useEffect(() => {
    // The creation view names the CEO; after a refresh straight into it the agents were never listed.
    // The Workbench names each department's agent.
    const needsAgents = (view === "onboarding" && onboardingStep === "agents") || view === "creating" || view === "workbench";
    if (needsAgents && agentLoadState === "idle") {
      void detectAgents();
    }
  }, [agentLoadState, onboardingStep, view]);

  async function detectAgents() {
    setAgentLoadState("loading");
    setAgentSelectionError(null);

    try {
      const response = await client.listAgents();
      setAgents(response.agents);
      setAgentLoadState("ready");
      const detectedCodex = response.agents.find((agent) => agent.id === "codex" && agent.detected);
      const firstDetected = response.agents.find((agent) => agent.detected);
      setSelectedAgentId((current) => current || ((detectedCodex ?? firstDetected)?.id ?? ""));
    } catch {
      setAgents([]);
      setSelectedAgentId("");
      setAgentLoadState("failed");
    }
  }

  useEffect(() => {
    if (!blueprint?.company.id) {
      return;
    }

    let cancelled = false;
    let revision = 0;
    const unsubscribe = client.subscribeEvents(blueprint.company.id, (event) => {
      setEvents((current) => [...current.slice(-49), event]);
      if (event.type.startsWith("company_creation_") && event.companyId) {
        setCreationEvents((current) => [...current, event as CompanyEventSummary]);
      }
      setBlueprint((current) => updateBlueprintTaskStatus(current, event));

      if (shouldReloadCompanyStateAfterEvent(event)) {
        const requestRevision = ++revision;
        void client
          .getCompanyState(blueprint.company.id)
          .then((response) => {
            if (cancelled || requestRevision !== revision) return;
            if (["task_review", "company_creation_completed", "company_creation_failed", "company_report_ready"].includes(event.type)) {
              applyCompanyState(response, event.type.startsWith("company_creation_") ? ceoOfficeLocation : locationRef.current);
            } else {
              adoptBusinessProjection(response);
            }
          })
          .catch(() => undefined);
      }
    }, () => {
      // The stream does not replay. Whatever happened before it first connected, or while it was
      // reconnecting, reached no one — a creation that already finished, a task that moved — so the
      // live view is known to be stale here and the snapshot is the newer truth. A later event's
      // reload bumps the revision and supersedes this one.
      // The setup form shows no company state, and re-entering it would reset the wizard step.
      if (viewRef.current === "onboarding") return;
      const requestRevision = ++revision;
      void client
        .getCompanyState(blueprint.company.id)
        .then((response) => {
          if (cancelled || requestRevision !== revision) return;
          if (companyStatusRef.current === "creating") {
            if (response.company.status !== "creating") {
              applyCompanyState(response, ceoOfficeLocation);
            }
            return;
          }
          applyCompanyState(response);
        })
        .catch(() => undefined);
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [blueprint?.company.id, client]);

  const commands = workbenchCommands({
    canCreateCompany: view === "onboarding" && onboardingStep === "vision",
    isCreating,
    companyStatus: blueprint?.company.status ?? null,
    onCreateCompany: handleCreateCompany,
    onPauseOperating: handlePauseOperating,
    onResumeOperating: handleResumeOperating,
    onStopOperating: handleStopOperating,
  });

  // Two shortcuts remain, and both ask the command model whether they can run.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isCommandShortcut(event) || isEditingText(event.target)) {
        return;
      }

      if (event.key === "Enter" && view === "onboarding" && !isCreating) {
        event.preventDefault();
        if (onboardingStep === "vision") {
          const createCommand = commands["create-company"];
          if (createCommand.enabled) void createCommand.run();
        } else {
          goToNextStep();
        }
        return;
      }

      const command = operatingCommand(commands);
      if (event.key.toLowerCase() === "k" && event.shiftKey && command.enabled) {
        event.preventDefault();
        void command.run();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  async function handleCreateCompany() {
    if (!validateCompanyName() || !validateSelectedAgent() || !validateFounderVision()) {
      return;
    }

    setIsCreating(true);
    setView("creating");
    setCreateError(null);
    setBlueprint(null);
    setProof([]);
    setBusinessArtifacts([]);
    setReplanProposals([]);
    setHumanActions([]);
    setVisionGaps([]);
    setWaitStates([]);
    setReviews([]);
    setEvents([]);
    setCreationEvents([]);
    setTaskProgressEvents([]);
    setTaskCompletionEvents([]);
    setFounderDecisions([]);
    setCeoIntakes([]);
    try {
      const response = await client.createCompany({
        companyName: companyName.trim(),
        founderVision: founderVision.trim(),
        locale: readCurrentLanguage() ?? defaultLanguage,
        selectedCeoAgentId: selectedAgentId,
        permissionMode,
        assets: [],
        creationIdempotencyKey: getOrCreateCreationIdempotencyKey(),
      });
      writeCurrentCompanyId(response.company.id);
      setReturnCompanyId(null);
      applyCompanyState(response, ceoOfficeLocation);
    } catch (error) {
      setView("onboarding");
      setOnboardingStep("vision");
      setCreateError((error as Error).message);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRetryCompanyCreation() {
    const companyId = blueprint?.company.id;
    if (!companyId) {
      return;
    }

    setIsCreating(true);
    try {
      const response = await client.retryCompanyCreation(companyId);
      applyCompanyState(response, ceoOfficeLocation);
    } catch (error) {
      setCreateError((error as Error).message);
    } finally {
      setIsCreating(false);
    }
  }

  function handleCompanyNameChange(value: string) {
    setCompanyName(value);
    if (value.trim()) {
      setCompanyNameError(null);
    }
  }

  function handleFounderVisionChange(value: string) {
    setFounderVision(value);
    if (value.trim()) {
      setFounderVisionError(null);
    }
  }

  function handleSelectAgent(agentId: string) {
    setSelectedAgentId(agentId);
    setAgentSelectionError(null);
  }

  function validateCompanyName() {
    if (companyName.trim()) {
      setCompanyNameError(null);
      return true;
    }

    setCompanyNameError("Company name is required.");
    return false;
  }

  function validateSelectedAgent() {
    const selectedAgent = agents.find((agent) => agent.id === selectedAgentId && agent.detected);

    if (selectedAgent) {
      setAgentSelectionError(null);
      return true;
    }

    setAgentSelectionError("Select one detected CEO Agent.");
    return false;
  }

  function validateFounderVision() {
    if (founderVision.trim()) {
      setFounderVisionError(null);
      return true;
    }

    setFounderVisionError("Founder vision is required.");
    return false;
  }

  function goToNextStep() {
    if (isCreating || view === "creating") {
      return;
    }

    if (onboardingStep === "company") {
      if (validateCompanyName()) {
        setOnboardingStep("agents");
      }
      return;
    }

    if (onboardingStep === "agents") {
      if (validateSelectedAgent()) {
        setOnboardingStep("vision");
      }
      return;
    }

    void handleCreateCompany();
  }

  function goToPreviousStep() {
    if (isCreating || view === "creating") {
      return;
    }

    setCreateError(null);
    if (onboardingStep === "vision") {
      setOnboardingStep("agents");
    } else if (onboardingStep === "agents") {
      setOnboardingStep("company");
    }
  }

  // Pause, Resume and Stop Operating (ADR 0044). The company's own status is what says it is paused.
  async function handlePauseOperating() {
    if (!blueprint) return;
    const response = await client.pauseCompany(blueprint.company.id);
    setBlueprint((current) => (current ? { ...current, company: response.company } : current));
  }

  async function handleResumeOperating() {
    if (!blueprint) return;
    const response = await client.resumeCompany(blueprint.company.id);
    setBlueprint((current) => (current ? { ...current, company: response.company } : current));
  }

  /** Final. Settings confirms it by the company name first; a refusal reaches the founder there. */
  async function handleStopOperating() {
    if (!blueprint) return;
    const response = await client.stopCompany(blueprint.company.id);
    setBlueprint((current) => (current ? { ...current, company: response.company } : current));
  }

  /**
   * Re-read proposals (and the task affordances that offer them) from the server after a replan action.
   * A new request dismisses the proposal it replaces, and whether a proposal is stale is derived from
   * the task's current state; both are the server's to say, never re-derived here (ADR 0043).
   */
  async function reloadReplanState() {
    const companyId = blueprint?.company.id;
    if (!companyId) return;
    const response = await client.getCompanyState(companyId);
    setReplanProposals(response.replanProposals ?? []);
    setBlueprint((current) => current ? { ...current, tasks: adoptSettledTasks(current.tasks, response.tasks) } : current);
  }

  async function handleCreateReplanProposal(taskId: string, request?: { mode: ReplanMode | null; note: string | null }) {
    const response = request ? await client.createReplanProposal(taskId, request) : await client.createReplanProposal(taskId);
    setReplanProposals((current) => upsertReplanProposal(current, response.proposal));
    await reloadReplanState().catch(() => undefined);
  }

  async function handleConfirmReplanProposal(proposalId: string) {
    try {
      const response = await client.confirmReplanProposal(proposalId);
      setReplanProposals((current) => upsertReplanProposal(current, response.proposal));
      setBlueprint((current) => updateBlueprintTasksAfterReplan(current, response.sourceTask, response.createdTasks));
      applyTaskUpdateBatchResponse(response.dependencyCascade, "Dependency cascade warning");
    } finally {
      // A refusal (the proposal went stale) is shown as stale once re-read; a success refreshes the rest.
      await reloadReplanState().catch(() => undefined);
    }
  }

  async function handleRejectReplanProposal(proposalId: string, note: string | null) {
    const response = await client.rejectReplanProposal(proposalId, note);
    setReplanProposals((current) => upsertReplanProposal(current, response.proposal));
    await reloadReplanState().catch(() => undefined);
  }

  async function handleConfirmHumanAction(humanActionId: string, evidence: Record<string, string>) {
    if (!blueprint) {
      return;
    }

    const response = await client.confirmHumanAction(blueprint.company.id, humanActionId, { evidence });
    setHumanActions((current) => upsertHumanAction(current, response.humanAction));
    setBlueprint((current) => updateBlueprintTasks(current, response.updatedTasks));
    setBlueprint((current) => clearCeoOfficeItemActionBearing(current, `human_action:${humanActionId}`));
    if (response.events.length > 0) {
      setEvents((current) => [...current.slice(-49), ...response.events]);
    }
  }

  async function handleRefreshTask(taskId: string) {
    const response = await client.refreshTask(taskId);
    setBlueprint((current) => updateBlueprintTask(current, response.task));
    setEvents((current) => [...current.slice(-49), response.event]);
    if (response.progressEvent) {
      setTaskProgressEvents((current) => [...current, response.progressEvent!]);
    }
    if (response.proof) {
      setProof((current) => upsertProofs(current, response.proof ?? []));
    }
    if (response.businessArtifacts) {
      setBusinessArtifacts((current) => upsertBusinessArtifacts(current, response.businessArtifacts ?? []));
      setBlueprint((current) => upsertCeoOfficeItems(
        current,
        (response.businessArtifacts ?? []).flatMap((artifact) => createApprovalRequestItemFromArtifact(artifact, response.task)),
      ));
    }
    applyTaskUpdateBatchResponse(response.parentAggregation, "Parent aggregation warning");
    return response;
  }

  async function handleDecideFounderApproval(approvalId: string, decision: "approved" | "denied") {
    const response = await client.decideFounderApproval(approvalId, { decision });
    if (response.task) {
      setBlueprint((current) => updateBlueprintTask(current, response.task!));
    }
    if (response.event) {
      setEvents((current) => [...current.slice(-49), response.event!]);
    }
    return response;
  }

  /**
   * The founder says the process holding this task's workspace is gone.
   *
   * Nothing else can release an isolated workspace: the runtime asked a run to stop and never saw it
   * exit, and only a person can look and settle that. Confirming frees the directory and leaves the
   * task on an ordinary interrupted-run Hold, which does offer recovery.
   */
  async function handleConfirmTaskTermination(taskId: string) {
    const response = await client.confirmTaskTermination(taskId);
    setBlueprint((current) => updateBlueprintTask(current, response.task));
  }

  async function handleRecoverTask(taskId: string) {
    const response = await client.recoverTask(taskId);
    setBlueprint((current) => updateBlueprintTasksAfterRecovery(current, response.task, response.followUpTask));
    setEvents((current) => [...current.slice(-49), response.event]);
    if (response.progressEvent) {
      setTaskProgressEvents((current) => [...current, response.progressEvent!]);
    }
    if (response.proof) {
      setProof((current) => upsertProofs(current, response.proof ?? []));
    }
    if (response.businessArtifacts) {
      setBusinessArtifacts((current) => upsertBusinessArtifacts(current, response.businessArtifacts ?? []));
      setBlueprint((current) => upsertCeoOfficeItems(
        current,
        (response.businessArtifacts ?? []).flatMap((artifact) => createApprovalRequestItemFromArtifact(artifact, response.task)),
      ));
    }
    applyTaskUpdateBatchResponse(response.parentAggregation, "Parent aggregation warning");
    return response;
  }

  async function handleCreateCeoIntake(body: string) {
    if (!blueprint) {
      return;
    }

    const companyId = blueprint.company.id;
    const response = await client.createCeoIntake(companyId, { body });
    setCeoIntakes((current) => upsertCeoIntake(current, response.intake));
    // The founder's message is a card in the server's projection; read it back so it shows at once.
    void client.getCompanyState(companyId).then((state) => {
      if (companyIdRef.current === companyId) adoptBusinessProjection(state);
    }).catch(() => undefined);
  }

  async function handleCreateDepartmentIntake(departmentId: string, body: string) {
    if (!blueprint) {
      return;
    }

    const companyId = blueprint.company.id;
    const response = await client.createDepartmentIntake(companyId, departmentId, { body });
    setCeoIntakes((current) => upsertCeoIntake(current, response.intake));
    // The message is a card in the server's projection; read it back so it shows at once.
    void client.getCompanyState(companyId).then((state) => {
      if (companyIdRef.current === companyId) adoptBusinessProjection(state);
    }).catch(() => undefined);
  }

  /** Opens a task on its department page and brings its trace into view. */
  function openTask(taskId: string) {
    const task = blueprint?.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    setFocusTaskId(taskId);
    setLocation({ page: "department", departmentId: task.departmentId });
  }

  async function handleCreateCeoReviewDecision(input: Parameters<ApiClient["createCeoReviewDecision"]>[0]) {
    const response = await client.createCeoReviewDecision(input);
    setBlueprint((current) => updateBlueprintTask(current, response.task));
    setBlueprint((current) => clearCeoReviewRequestItemsForTask(current, input.taskId));
    if (response.event) {
      setEvents((current) => [...current.slice(-49), response.event!]);
    }
    if (response.progressEvent) {
      setTaskProgressEvents((current) => [...current, response.progressEvent!]);
    }
    if (response.businessArtifacts) {
      setBusinessArtifacts((current) => upsertBusinessArtifacts(current, response.businessArtifacts ?? []));
    }
    applyTaskUpdateBatchResponse(response.dependencyCascade, "Dependency cascade warning");
    return response;
  }

  async function handleResolveFounderDecision(input: Parameters<ApiClient["resolveFounderDecision"]>[0]) {
    const response = await client.resolveFounderDecision(input);
    setFounderDecisions((current) =>
      current.map((decision) => (decision.id === response.founderDecision.id ? response.founderDecision : decision)),
    );
    setBlueprint((current) => updateBlueprintTask(current, response.task));
    setBlueprint((current) => clearCeoOfficeItemActionBearing(current, `decision_request:${input.founderDecisionId}`));
    if (response.event) {
      setEvents((current) => [...current.slice(-49), response.event!]);
    }
    if (response.progressEvent) {
      setTaskProgressEvents((current) => [...current, response.progressEvent!]);
    }
    if (response.businessArtifacts) {
      setBusinessArtifacts((current) => upsertBusinessArtifacts(current, response.businessArtifacts ?? []));
    }
    applyTaskUpdateBatchResponse(response.dependencyCascade, "Dependency cascade warning");
    return response;
  }

  function applyTaskUpdateBatchResponse(batch: TaskUpdateBatchSummary | undefined, warningLabel: string) {
    if (!batch) {
      return;
    }

    setBlueprint((current) => updateBlueprintTasks(current, batch.updatedTasks));
    if (batch.events.length > 0) {
      setEvents((current) => [...current.slice(-49), ...batch.events]);
    }
    if (batch.progressEvents.length > 0) {
      setTaskProgressEvents((current) => [...current, ...batch.progressEvents]);
    }
    if (batch.errors?.length) {
      setEvents((current) => [
        ...current.slice(-49),
        ...batch.errors!.map((error) => ({
          type: "task_warning",
          taskId: error.taskId,
          message: `${warningLabel}: ${error.message}`,
        })),
      ]);
    }
  }

  /**
   * Leaves a failed creation, whether or not the founder stopped it first: for the best other company,
   * else the Onboarding Wizard. There is nothing to cancel back to, so the wizard offers no way back.
   */
  function leaveFailedCreation() {
    const failedCompanyId = blueprint?.company.id;
    const otherCompany = pickStartupCompany(companies.filter((company) => company.id !== failedCompanyId));
    if (otherCompany) {
      void openCompany(otherCompany.id);
    } else {
      handleCreateNewCompany({ returnable: false });
    }
  }

  function handleCreateNewCompany({ returnable = true }: { returnable?: boolean } = {}) {
    setReturnCompanyId(returnable ? (blueprint?.company.id ?? null) : null);
    clearCurrentCompanyId();
    setBlueprint(null);
    setProof([]);
    setBusinessArtifacts([]);
    setReviews([]);
    setEvents([]);
    setTaskProgressEvents([]);
    setTaskCompletionEvents([]);
    setFounderDecisions([]);
    setCeoIntakes([]);
    setReplanProposals([]);
    setHumanActions([]);
    setVisionGaps([]);
    setWaitStates([]);
    setCompanyName("");
    setCompanyNameError(null);
    setFounderVision("");
    setFounderVisionError(null);
    setAgentSelectionError(null);
    setOnboardingStep("company");
    setView("onboarding");
  }

  // LanguageProvider stays the root element of every view, modern or legacy, so React keeps one
  // instance across navigation and a language chosen on one view survives the move to the next.
  function renderModernAppFrame(children: ReactNode) {
    return (
      <LanguageProvider defaultLanguage={defaultLanguage} syncLocale={blueprint?.company.locale ?? null}>
        {children}
      </LanguageProvider>
    );
  }

  if (view === "starting") {
    return renderModernAppFrame(
      <StartupScreen error={startupError} failed={startupError !== null} onRetry={() => void openStartupCompany()} />,
    );
  }

  if (view === "creating") {
    // After a refresh the setup form is empty; the company being created knows its own choices.
    const creatingAgentId = blueprint?.company.selectedCeoAgentId ?? selectedAgentId;
    const otherCompany = pickStartupCompany(companies.filter((company) => company.id !== blueprint?.company.id));
    const selectedAgent = agents.find((agent) => agent.id === creatingAgentId) ?? null;

    return renderModernAppFrame(
      <CompanyCreationLoading
        companyName={blueprint?.company.name ?? companyName.trim()}
        events={creationEvents}
        isFailed={blueprint?.company.status === "creation_failed"}
        isRetrying={isCreating}
        onRetry={handleRetryCompanyCreation}
        permissionMode={blueprint?.company.permissionMode ?? permissionMode}
        selectedAgent={selectedAgent}
        selectedAgentId={creatingAgentId || undefined}
        stopCommand={blueprint ? commands["stop-operating"] : undefined}
        onStopped={leaveFailedCreation}
        leave={blueprint ? { kind: otherCompany ? "other" : "new", run: leaveFailedCreation } : undefined}
      />,
    );
  }

  if (view === "workbench" && blueprint) {
    return renderModernAppFrame(
      <WorkbenchFrame
        agents={agents}
        ceoOfficeItems={(blueprint.ceoOfficeItems ?? []) as CeoOfficeItemSummary[]}
        commands={commands}
        company={blueprint.company}
        departments={blueprint.departments}
        location={location}
        onNavigate={setLocation}
        replanProposals={replanProposals}
        tasks={blueprint.tasks}
      >
        {renderWorkbenchPage(blueprint)}
      </WorkbenchFrame>,
    );
  }

  function renderWorkbenchPage(company: CreateCompanyResponse) {
    if (location.page === "operations") {
      return (
        <OperationsDiagnostics events={events} humanActions={humanActions} tasks={company.tasks} waitStates={waitStates} />
      );
    }

    if (location.page === "deliverables") {
      return <Deliverables businessArtifacts={businessArtifacts} proof={proof} reviews={reviews} tasks={company.tasks} />;
    }

    if (location.page === "settings") {
      return (
        <Settings
          companies={companies}
          companiesLoadError={companyListLoadError}
          companiesLoadState={companyListLoadState}
          company={company.company}
          onCreateNewCompany={() => handleCreateNewCompany()}
          onLoadCompanies={() => void loadCompanies()}
          onOpenCompany={(companyId) => void openCompany(companyId)}
          stopCommand={commands["stop-operating"]}
        />
      );
    }

    if (location.page === "ceo-office") {
      return (
        <CeoOffice
          agents={agents}
          businessArtifacts={businessArtifacts}
          ceoOfficeItems={(company.ceoOfficeItems ?? []) as CeoOfficeItemSummary[]}
          company={company.company}
          departments={company.departments}
          finalFounderReport={company.finalFounderReport ?? null}
          finalFounderReportPreparing={company.finalFounderReportPreparing ?? false}
          keyResults={company.keyResults ?? []}
          objectives={company.objectives}
          onConfirmHumanAction={handleConfirmHumanAction}
          onCreateCeoIntake={handleCreateCeoIntake}
          onCreateCeoReviewDecision={handleCreateCeoReviewDecision}
          onOpenDepartment={(departmentId) => setLocation({ page: "department", departmentId })}
          onOpenTask={openTask}
          onResolveFounderDecision={handleResolveFounderDecision}
          proof={proof}
          replanProposals={replanProposals}
          tasks={company.tasks}
          visionGaps={visionGaps}
          waitStates={waitStates}
        />
      );
    }

    return (
      <ExecutionActionsContext.Provider value={{ client, update: task => setBlueprint(current => updateBlueprintTask(current, task)) }}>
        <DepartmentPage
          agents={agents}
          businessArtifacts={businessArtifacts}
          ceoOfficeItems={(company.ceoOfficeItems ?? []) as CeoOfficeItemSummary[]}
          company={company.company}
          departmentId={location.departmentId}
          departments={company.departments}
          focusTaskId={focusTaskId}
          key={location.departmentId}
          onConfirmHumanAction={handleConfirmHumanAction}
          onConfirmReplanProposal={handleConfirmReplanProposal}
          onConfirmTaskTermination={handleConfirmTaskTermination}
          onCreateCeoReviewDecision={handleCreateCeoReviewDecision}
          onCreateDepartmentIntake={handleCreateDepartmentIntake}
          onCreateReplanProposal={handleCreateReplanProposal}
          onDecideFounderApproval={handleDecideFounderApproval}
          onFocusHandled={clearFocusTask}
          onOpenCeoOffice={() => setLocation(ceoOfficeLocation)}
          onOpenDepartment={(departmentId) => setLocation({ page: "department", departmentId })}
          onOpenTask={openTask}
          onRecoverTask={handleRecoverTask}
          onRefreshTask={handleRefreshTask}
          onRejectReplanProposal={handleRejectReplanProposal}
          onResolveFounderDecision={handleResolveFounderDecision}
          progressEvents={taskProgressEvents}
          proof={proof}
          replanProposals={replanProposals}
          tasks={company.tasks}
          waitStates={waitStates}
        />
      </ExecutionActionsContext.Provider>
    );
  }

  return renderModernAppFrame(
    <Onboarding
      agents={agents}
      agentLoadState={agentLoadState}
      agentSelectionError={agentSelectionError}
      companyName={companyName}
      companyNameError={companyNameError}
      createError={createError}
      founderVision={founderVision}
      founderVisionError={founderVisionError}
      isCreating={isCreating}
      onBack={goToPreviousStep}
      onCancel={returnCompanyId ? () => void openCompany(returnCompanyId) : undefined}
      onCompanyNameChange={handleCompanyNameChange}
      onCreateCompany={handleCreateCompany}
      onNext={goToNextStep}
      onPermissionModeChange={setPermissionMode}
      onRetryAgents={detectAgents}
      onSelectAgent={handleSelectAgent}
      onVisionChange={handleFounderVisionChange}
      permissionMode={permissionMode}
      selectedAgentId={selectedAgentId}
      step={onboardingStep}
    />,
  );
}

function upsertCeoIntake(intakes: CeoIntakeSummary[], intake: CeoIntakeSummary): CeoIntakeSummary[] {
  return upsertById(intakes, intake);
}

function upsertProofs(proofs: ProofSummary[], nextProofs: ProofSummary[]): ProofSummary[] {
  let result = proofs;
  for (const proof of nextProofs) {
    const exists = result.some((current) => current.id === proof.id);
    result = exists
      ? result.map((current) => (current.id === proof.id ? proof : current))
      : [...result, proof];
  }
  return result;
}

function upsertBusinessArtifacts(
  artifacts: BusinessArtifactSummary[],
  nextArtifacts: BusinessArtifactSummary[],
): BusinessArtifactSummary[] {
  let result = artifacts;
  for (const artifact of nextArtifacts) {
    const exists = result.some((current) => current.id === artifact.id);
    result = exists
      ? result.map((current) => (current.id === artifact.id ? artifact : current))
      : [...result, artifact];
  }
  return result;
}

function upsertCeoOfficeItems(
  blueprint: CreateCompanyResponse | null,
  items: CeoOfficeItemSummary[],
): CreateCompanyResponse | null {
  if (!blueprint || items.length === 0) {
    return blueprint;
  }

  return {
    ...blueprint,
    ceoOfficeItems: items.reduce((current, item) => upsertById(current, item), blueprint.ceoOfficeItems ?? []),
  };
}

/**
 * Add the CEO Office approval item for a task that just entered review, without waiting for the next
 * full company-state read.
 *
 * Gated on the task carrying a `ceo_review_decision` Resume Affordance, not on the artifact reading
 * `unreviewed` — the same rule the server projects and guards with. Deriving it from the artifact
 * alone is exactly how CEO Office ended up offering decisions the API refused (ADR 0020).
 */
function createApprovalRequestItemFromArtifact(
  artifact: BusinessArtifactSummary,
  task: TaskSummary,
): CeoOfficeItemSummary[] {
  const offered = (task.affordances ?? []).some((affordance) => affordance.kind === "ceo_review_decision");
  if (!offered || !isReviewableArtifact(artifact) || artifact.taskId !== task.id) {
    return [];
  }

  return [{
    id: `approval_request:${artifact.id}`,
    type: "approval_request",
    companyId: artifact.companyId,
    sourceId: artifact.id,
    taskId: task.id,
    departmentId: task.departmentId,
    objectiveId: null,
    keyResultId: null,
    occurredAt: artifact.createdAt,
    title: task.title,
    titleText: task.titleText ?? null,
    actionBearing: true,
    data: {
      businessArtifactId: artifact.id,
      status: "pending",
    },
  }];
}

function isReviewableArtifact(artifact: BusinessArtifactSummary): boolean {
  return (
    artifact.isCurrent &&
    artifact.validationStatus === "valid" &&
    artifact.reviewStatus === "unreviewed" &&
    (artifact.artifactKind === "deliverable" || artifact.artifactKind === "final_report")
  );
}

function upsertReplanProposal(proposals: ReplanProposalSummary[], proposal: ReplanProposalSummary): ReplanProposalSummary[] {
  return upsertById(proposals, proposal);
}

function upsertHumanAction(actions: HumanActionSummary[], action: HumanActionSummary): HumanActionSummary[] {
  return upsertById(actions, action);
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const exists = items.some((current) => current.id === item.id);
  if (!exists) {
    return [...items, item];
  }

  return items.map((current) => (current.id === item.id ? item : current));
}

function updateBlueprintTask(
  blueprint: CreateCompanyResponse | null,
  nextTask: TaskSummary,
): CreateCompanyResponse | null {
  if (!blueprint) {
    return blueprint;
  }

  return {
    ...blueprint,
    tasks: blueprint.tasks.map((task) =>
      task.id === nextTask.id
        ? {
            ...task,
            ...nextTask,
            failureReason: nextTask.failureReason,
            failureMessage: nextTask.failureMessage,
            dependencyNote: nextTask.dependencyNote,
          }
        : task,
    ),
  };
}

function updateBlueprintTasks(
  blueprint: CreateCompanyResponse | null,
  nextTasks: TaskSummary[],
): CreateCompanyResponse | null {
  return nextTasks.reduce((current, task) => updateBlueprintTask(current, task), blueprint);
}

function clearCeoOfficeItemActionBearing(
  blueprint: CreateCompanyResponse | null,
  itemId: string,
): CreateCompanyResponse | null {
  if (!blueprint) {
    return blueprint;
  }

  return {
    ...blueprint,
    ceoOfficeItems: (blueprint.ceoOfficeItems ?? []).map((item) =>
      item.id === itemId ? { ...item, actionBearing: false as const } : item,
    ),
  };
}

function clearCeoReviewRequestItemsForTask(
  blueprint: CreateCompanyResponse | null,
  taskId: string,
): CreateCompanyResponse | null {
  if (!blueprint) {
    return blueprint;
  }

  return {
    ...blueprint,
    ceoOfficeItems: (blueprint.ceoOfficeItems ?? []).map((item) =>
      item.type === "approval_request" && item.taskId === taskId ? { ...item, actionBearing: false as const } : item,
    ),
  };
}

function updateBlueprintTasksAfterRecovery(
  blueprint: CreateCompanyResponse | null,
  task: TaskSummary,
  followUpTask?: TaskSummary,
): CreateCompanyResponse | null {
  const updated = updateBlueprintTask(blueprint, task);
  if (!updated || !followUpTask) {
    return updated;
  }

  const exists = updated.tasks.some((current) => current.id === followUpTask.id);
  return {
    ...updated,
    tasks: exists
      ? updated.tasks.map((current) => (current.id === followUpTask.id ? { ...current, ...followUpTask } : current))
      : [...updated.tasks, followUpTask],
  };
}

function updateBlueprintTasksAfterReplan(
  blueprint: CreateCompanyResponse | null,
  sourceTask: TaskSummary,
  createdTasks: TaskSummary[],
): CreateCompanyResponse | null {
  if (!blueprint) {
    return blueprint;
  }

  const createdTaskIds = new Set(createdTasks.map((task) => task.id));
  const existingTaskIds = new Set(blueprint.tasks.map((task) => task.id));
  const tasks = [
    ...blueprint.tasks
      .filter((task) => !createdTaskIds.has(task.id))
      .map((task) => (task.id === sourceTask.id ? { ...task, ...sourceTask } : task)),
    ...createdTasks.filter((task) => !existingTaskIds.has(task.id)),
  ];

  return { ...blueprint, tasks };
}

function getInitialLanguage(): LanguageId {
  if (typeof window === "undefined") {
    return "en";
  }

  const requestedLanguage = new URLSearchParams(window.location.search).get("lang");
  if (requestedLanguage && isLanguageId(requestedLanguage)) {
    return requestedLanguage;
  }

  return readCurrentLanguage() ?? "en";
}

function isCommandShortcut(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey;
}

function isEditingText(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}

function updateBlueprintTaskStatus(blueprint: CreateCompanyResponse | null, event: ServerEvent) {
  if (!blueprint || !event.taskId) {
    return blueprint;
  }

  const nextStatus = event.status ?? taskStatusFromEvent(event.type);

  if (!nextStatus && !hasTaskSummaryUpdate(event)) {
    return blueprint;
  }

  let changed = false;
  const tasks = blueprint.tasks.map((task) => {
    if (task.id !== event.taskId) {
      return task;
    }

    changed = true;
    return {
      ...task,
      status: nextStatus ?? task.status,
      // Holds and Resume Affordances belong to the status the *server* computed them for. An event
      // that moves the task locally invalidates them, and keeping them would let the board offer an
      // action the server never offered for this state — the fabrication ADR 0020 exists to stop.
      // They come back with the next snapshot that agrees with what we just saw.
      ...(nextStatus && nextStatus !== task.status ? { holds: undefined, affordances: undefined } : {}),
      failureReason: event.failureReason ?? (clearsTaskFailure(event.type) ? undefined : task.failureReason),
      failureMessage: event.failureMessage ?? (clearsTaskFailure(event.type) ? undefined : task.failureMessage),
      executionProfileName: event.executionProfileName ?? task.executionProfileName,
      requestedTimeoutMs: event.requestedTimeoutMs ?? task.requestedTimeoutMs,
      effectiveTimeoutMs: event.effectiveTimeoutMs ?? task.effectiveTimeoutMs,
      dependencyNote: event.dependencyNote ?? (clearsTaskFailure(event.type) ? undefined : task.dependencyNote),
      artifactWorkspacePath: event.artifactWorkspacePath ?? task.artifactWorkspacePath,
    };
  });

  return changed ? { ...blueprint, tasks } : blueprint;
}

/**
 * Take the server's version of a task only where the snapshot agrees with the status the live stream
 * already showed. Where they disagree the snapshot is simply in flight, and mixing its Resume
 * Affordances into a status it was not computed for would offer actions for the wrong state.
 */
function adoptSettledTasks(current: TaskSummary[], snapshot: TaskSummary[]): TaskSummary[] {
  const snapshotById = new Map(snapshot.map((task) => [task.id, task]));
  const currentIds = new Set(current.map((task) => task.id));

  return [
    ...current.map((task) => {
      const settled = snapshotById.get(task.id);
      return settled && settled.status === task.status ? settled : task;
    }),
    // A task the live view has never seen, such as one a CEO Intake planned, has no live status to
    // disagree with, so the snapshot's version is the only one there is.
    ...snapshot.filter((task) => !currentIds.has(task.id)),
  ];
}

function clearsTaskFailure(eventType: string): boolean {
  return eventType === "task_started" || eventType === "dependency_ready" || eventType === "task_recovered";
}

function hasTaskSummaryUpdate(event: ServerEvent) {
  return Boolean(
    event.failureReason ||
      event.failureMessage ||
      event.executionProfileName ||
      event.requestedTimeoutMs ||
      event.effectiveTimeoutMs ||
      event.dependencyNote ||
      event.artifactWorkspacePath,
  );
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function taskStatusFromEvent(eventType: string) {
  switch (eventType) {
    case "task_started":
      return "running";
    case "task_review":
      return "review";
    case "task_failed":
      return "failed";
    case "task_blocked":
      return "blocked";
    case "task_recovered":
      return "queued";
    case "task_needs_replan":
      return "needs_replan";
    default:
      return null;
  }
}

function shouldReloadCompanyStateAfterEvent(event: ServerEvent) {
  return (
    ["task_started", "task_failed", "task_blocked", "task_needs_replan", "task_replanned", "task_recovered", "dependency_ready", "dependency_waiting", "deliverable_missing", "automatic_acceptance", "founder_decision", "ceo_review_decision"].includes(event.type) ||
    event.type === "task_review" ||
    event.type === "company_creation_completed" ||
    event.type === "company_creation_failed" ||
    event.type === "company_report_ready" ||
    event.type === "ceo_intake_updated"
  );
}

/**
 * Which company to open when none is remembered: operating first, then paused (the founder most
 * likely means to come back to it), then one still being created, then stopped, and a failed creation
 * last. Within a status, the most recently updated.
 */
const startupStatusOrder = ["active", "paused", "creating", "stopped", "creation_failed"];

function pickStartupCompany(companies: CompanyListItem[]): CompanyListItem | null {
  const rank = (status: string) => {
    const index = startupStatusOrder.indexOf(status);
    return index === -1 ? startupStatusOrder.length : index;
  };
  return [...companies].sort((a, b) => rank(a.status) - rank(b.status) || b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

function readCurrentCompanyId(): string | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return window.localStorage.getItem(currentCompanyStorageKey);
}

function writeCurrentCompanyId(companyId: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.setItem(currentCompanyStorageKey, companyId);
}

function clearCurrentCompanyId(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.removeItem(currentCompanyStorageKey);
  window.localStorage.removeItem(currentViewStorageKey);
  window.localStorage.removeItem(creationIdempotencyKeyStorageKey);
}

function clearCreationIdempotencyKey(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.removeItem(creationIdempotencyKeyStorageKey);
}

function getOrCreateCreationIdempotencyKey(): string {
  if (typeof window === "undefined" || !window.localStorage) {
    return `creation-${Date.now()}`;
  }

  const existing = window.localStorage.getItem(creationIdempotencyKeyStorageKey);
  if (existing) {
    return existing;
  }

  const key = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `creation-${Date.now()}`;
  window.localStorage.setItem(creationIdempotencyKeyStorageKey, key);
  return key;
}

function readCurrentLocation(): WorkbenchLocation | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return parseLocation(window.localStorage.getItem(currentViewStorageKey));
}

function writeCurrentLocation(location: WorkbenchLocation): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.setItem(currentViewStorageKey, serializeLocation(location));
}
