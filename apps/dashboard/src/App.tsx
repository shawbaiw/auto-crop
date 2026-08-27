import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createApiClient,
  type AgentSummary,
  type ApiClient,
  type BusinessArtifactSummary,
  type CeoIntakeSummary,
  type CompanyListItem,
  type CreateCompanyResponse,
  type ProofSummary,
  type ReplanProposalSummary,
  type ReviewSummary,
  type ServerEvent,
  type TaskProgressEventSummary,
  type TaskSummary,
  type TaskUpdateBatchSummary,
} from "./api/client";
import { CompanyDashboard, type DashboardFocusSection, type DashboardFocusTarget } from "./pages/CompanyDashboard";
import { CompanyCreationLoading } from "./pages/CompanyCreationLoading";
import { CompanyOperations } from "./pages/CompanyOperations";
import { CompanyPicker } from "./pages/CompanyPicker";
import { DepartmentWorkspace } from "./pages/DepartmentWorkspace";
import { Onboarding, type OnboardingStep } from "./pages/Onboarding";
import { CRTViewport } from "./ui/crt";
import { isLanguageId, LanguageProvider, readCurrentLanguage, type LanguageId } from "./ui/language";
import { DashboardMenuBar } from "./ui/menu/DashboardMenuBar";
import { isPaletteId, readCurrentSkin, ThemeProvider, type PaletteId } from "./ui/theme";
import "./styles.css";

export type AppProps = {
  apiClient?: ApiClient;
};

type AgentLoadState = "idle" | "loading" | "ready" | "failed";
type CompanyListLoadState = "loading" | "ready" | "failed";
type AppView = "company-picker" | "onboarding" | "creating" | "department-workspace" | "dashboard" | "operations";
const currentCompanyStorageKey = "auto-crop.currentCompanyId";
const currentViewStorageKey = "auto-crop.currentView";

export default function App({ apiClient }: AppProps) {
  const client = useMemo(() => apiClient ?? createApiClient(), [apiClient]);
  const defaultSkin = useMemo(() => getInitialSkin(), []);
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
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [taskProgressEvents, setTaskProgressEvents] = useState<TaskProgressEventSummary[]>([]);
  const [ceoIntakes, setCeoIntakes] = useState<CeoIntakeSummary[]>([]);
  const [proof, setProof] = useState<ProofSummary[]>([]);
  const [businessArtifacts, setBusinessArtifacts] = useState<BusinessArtifactSummary[]>([]);
  const [replanProposals, setReplanProposals] = useState<ReplanProposalSummary[]>([]);
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [companyListLoadState, setCompanyListLoadState] = useState<CompanyListLoadState>("loading");
  const [isPaused, setIsPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [view, setView] = useState<AppView>("company-picker");
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("company");
  const [dashboardFocusTarget, setDashboardFocusTarget] = useState<DashboardFocusTarget | null>(null);

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
          applyCompanyState(response, readCurrentView() ?? defaultCompanyView(response.company.status));
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          clearCurrentCompanyId();
          void loadCompanies({ isCancelled: () => cancelled });
        });
    } else {
      void loadCompanies({ isCancelled: () => cancelled });
    }

    return () => {
      cancelled = true;
    };
  }, [client]);

  async function loadCompanies(options?: { isCancelled(): boolean }) {
    setCompanyListLoadState("loading");
    try {
      const response = await client.listCompanies();
      if (options?.isCancelled()) {
        return;
      }
      setCompanies(response.companies);
      setCompanyListLoadState("ready");
      setView(response.companies.length > 0 ? "company-picker" : "onboarding");
    } catch {
      if (options?.isCancelled()) {
        return;
      }
      setCompanies([]);
      setCompanyListLoadState("failed");
      setView("company-picker");
    }
  }

  async function openCompany(companyId: string) {
    setCompanyListLoadState("loading");
    try {
      const response = await client.getCompanyState(companyId);
      writeCurrentCompanyId(companyId);
      applyCompanyState(response, defaultCompanyView(response.company.status));
    } catch {
      setCompanyListLoadState("failed");
      setView("company-picker");
    }
  }

  function applyCompanyState(response: CreateCompanyResponse, nextView: AppView) {
    setBlueprint(response);
    setProof(response.proof ?? []);
    setBusinessArtifacts(response.businessArtifacts ?? []);
    setReviews(response.reviews ?? []);
    setEvents(response.activity ?? []);
    setTaskProgressEvents(response.taskProgressEvents ?? []);
    setCeoIntakes(response.ceoIntakes ?? []);
    setReplanProposals(response.replanProposals ?? []);
    setSelectedAgentId(response.company.selectedCeoAgentId ?? "");
    setView(nextView);
    if (nextView === "onboarding") {
      setOnboardingStep("vision");
    }
  }

  useEffect(() => {
    if (!blueprint || view === "creating") {
      return;
    }

    writeCurrentView(view);
  }, [blueprint, view]);

  useEffect(() => {
    if (view === "onboarding" && onboardingStep === "agents" && agentLoadState === "idle") {
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
    return client.subscribeEvents((event) => {
      setEvents((current) => [...current.slice(-49), event]);
      setBlueprint((current) => updateBlueprintTaskStatus(current, event));
    });
  }, [client]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isCommandShortcut(event) || isEditingText(event.target)) {
        return;
      }

      if (event.key === "Enter" && event.shiftKey && blueprint) {
        event.preventDefault();
        void handleActivateCompany();
        return;
      }

      if (event.key === "Enter" && view === "onboarding" && !isCreating) {
        event.preventDefault();
        if (onboardingStep === "vision") {
          void handleCreateCompany();
        } else {
          goToNextStep();
        }
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "b" && (view === "dashboard" || view === "department-workspace")) {
        event.preventDefault();
        handleBackToSetup();
        return;
      }

      if (key === "k" && event.shiftKey && view === "dashboard" && blueprint) {
        event.preventDefault();
        void handleKillSwitch();
        return;
      }

      if (key === "f" && event.ctrlKey) {
        event.preventDefault();
        void handleToggleFullscreen();
        return;
      }

      if (view !== "dashboard" || !blueprint) {
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        focusDashboardSection("tasks");
      } else if (event.key === "2") {
        event.preventDefault();
        viewDepartmentWorkspace();
      } else if (event.key === "3") {
        event.preventDefault();
        void handleMenuLoadProof();
      } else if (event.key === "4") {
        event.preventDefault();
        void handleMenuLoadReviews();
      } else if (event.key === "5") {
        event.preventDefault();
        void handleOpenEvidence();
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
    setReviews([]);
    setEvents([]);
    setTaskProgressEvents([]);
    setCeoIntakes([]);
    setDashboardFocusTarget(null);
    try {
      const response = await client.createCompany({
        companyName: companyName.trim(),
        founderVision: founderVision.trim(),
        selectedCeoAgentId: selectedAgentId,
        permissionMode,
        assets: [],
      });
      setBlueprint(response);
      setProof(response.proof ?? []);
      setBusinessArtifacts(response.businessArtifacts ?? []);
      setReplanProposals(response.replanProposals ?? []);
      setReviews(response.reviews ?? []);
      setEvents(response.activity ?? []);
      setTaskProgressEvents(response.taskProgressEvents ?? []);
      setCeoIntakes(response.ceoIntakes ?? []);
      writeCurrentCompanyId(response.company.id);
      setView("department-workspace");
    } catch (error) {
      setView("onboarding");
      setOnboardingStep("vision");
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

  async function handleActivateCompany() {
    if (!blueprint) {
      return;
    }

    const response = await client.activateCompany(blueprint.company.id);
    writeCurrentCompanyId(blueprint.company.id);
    setBlueprint({
      ...blueprint,
      company: response.company,
    });
    setView("dashboard");
  }

  async function handleLoadProof() {
    const firstTask = blueprint?.tasks[0];

    if (!firstTask) {
      return;
    }

    const response = await client.getTaskProof(firstTask.id);
    setProof(response.proof);
  }

  async function handleLoadReviews() {
    if (!blueprint) {
      return;
    }

    const response = await client.getCompanyReviews(blueprint.company.id);
    setReviews(response.reviews);
  }

  async function handleKillSwitch() {
    if (!blueprint) {
      return;
    }

    const response = await client.triggerKillSwitch(blueprint.company.id);
    setIsPaused(response.paused);
    setBlueprint({
      ...blueprint,
      company: response.company,
    });
  }

  async function handleCreateReplanProposal(taskId: string) {
    const response = await client.createReplanProposal(taskId);
    setReplanProposals((current) => upsertReplanProposal(current, response.proposal));
  }

  async function handleConfirmReplanProposal(proposalId: string) {
    const response = await client.confirmReplanProposal(proposalId);
    setReplanProposals((current) => upsertReplanProposal(current, response.proposal));
    setBlueprint((current) => updateBlueprintTasksAfterReplan(current, response.sourceTask, response.createdTasks));
    applyTaskUpdateBatchResponse(response.dependencyCascade, "Dependency cascade warning");
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
    applyTaskUpdateBatchResponse(response.parentAggregation, "Parent aggregation warning");
    return response;
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
    applyTaskUpdateBatchResponse(response.parentAggregation, "Parent aggregation warning");
    return response;
  }

  async function handleCreateCeoIntake(body: string) {
    if (!blueprint) {
      return;
    }

    const response = await client.createCeoIntake(blueprint.company.id, { body });
    setCeoIntakes((current) => upsertCeoIntake(current, response.intake));
  }

  async function handleCreateCeoReviewDecision(input: Parameters<ApiClient["createCeoReviewDecision"]>[0]) {
    const response = await client.createCeoReviewDecision(input);
    setBlueprint((current) => updateBlueprintTask(current, response.task));
    if (response.event) {
      setEvents((current) => [...current.slice(-49), response.event!]);
    }
    if (response.progressEvent) {
      setTaskProgressEvents((current) => [...current, response.progressEvent!]);
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

  function handleCreateNewCompany() {
    clearCurrentCompanyId();
    setBlueprint(null);
    setProof([]);
    setBusinessArtifacts([]);
    setReviews([]);
    setEvents([]);
    setTaskProgressEvents([]);
    setCeoIntakes([]);
    setReplanProposals([]);
    setDashboardFocusTarget(null);
    setCompanyName("");
    setCompanyNameError(null);
    setFounderVision("");
    setFounderVisionError(null);
    setAgentSelectionError(null);
    setOnboardingStep("company");
    setView("onboarding");
  }

  function handleBackToSetup() {
    setView("onboarding");
  }

  function focusDashboardSection(section: DashboardFocusSection) {
    if (blueprint && view === "department-workspace") {
      setView("dashboard");
    }
    setDashboardFocusTarget((current) => ({
      section,
      version: (current?.version ?? 0) + 1,
    }));
  }

  function viewDepartmentWorkspace() {
    if (!blueprint) {
      return;
    }

    setDashboardFocusTarget(null);
    setView("department-workspace");
  }

  function viewCompanyOperations() {
    if (!blueprint) {
      return;
    }

    setDashboardFocusTarget(null);
    setView("operations");
  }

  async function handleMenuLoadProof() {
    focusDashboardSection("proof");
    await handleLoadProof();
  }

  async function handleMenuLoadReviews() {
    focusDashboardSection("review");
    await handleLoadReviews();
  }

  async function handleOpenEvidence() {
    if (proof.length === 0) {
      await handleLoadProof();
    }
    focusDashboardSection("evidence");
  }

  async function handleToggleFullscreen() {
    if (!isFullscreenAvailable()) {
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  }

  const menuBar = (
    <DashboardMenuBar
      agents={agents}
      fullscreenAvailable={isFullscreenAvailable()}
      hasBlueprint={Boolean(blueprint)}
      hasProof={proof.length > 0}
      isCreating={isCreating}
      canCreateCompany={view === "onboarding" && onboardingStep === "vision"}
      isFullscreen={isFullscreen}
      isPaused={isPaused}
      onActivateCompany={handleActivateCompany}
      onBackToSetup={handleBackToSetup}
      onCreateCompany={handleCreateCompany}
      onKillSwitch={handleKillSwitch}
      onLoadProof={handleMenuLoadProof}
      onLoadReviews={handleMenuLoadReviews}
      onOpenEvidence={handleOpenEvidence}
      onSelectAgent={handleSelectAgent}
      onToggleFullscreen={handleToggleFullscreen}
      onViewDepartments={viewDepartmentWorkspace}
      onViewOperations={viewCompanyOperations}
      onViewTasks={() => focusDashboardSection("tasks")}
      selectedAgentId={selectedAgentId}
      view={view === "company-picker" ? "onboarding" : view}
    />
  );

  function renderAppFrame(children: ReactNode) {
    return (
      <ThemeProvider defaultSkin={defaultSkin}>
        <LanguageProvider defaultLanguage={defaultLanguage}>
          <CRTViewport>{children}</CRTViewport>
        </LanguageProvider>
      </ThemeProvider>
    );
  }

  if (view === "company-picker") {
    return renderAppFrame(
      <CompanyPicker
        companies={companies}
        loadState={companyListLoadState}
        menuBar={menuBar}
        onCreateNew={handleCreateNewCompany}
        onOpenCompany={openCompany}
        onRetry={loadCompanies}
      />,
    );
  }

  if (view === "creating") {
    const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;

    return renderAppFrame(
      <CompanyCreationLoading
        companyName={companyName.trim()}
        menuBar={menuBar}
        permissionMode={permissionMode}
        selectedAgent={selectedAgent}
      />,
    );
  }

  if (view === "department-workspace" && blueprint) {
    return renderAppFrame(
      <DepartmentWorkspace
        agents={agents}
        company={blueprint.company}
        departments={blueprint.departments}
        menuBar={menuBar}
        objectives={blueprint.objectives}
        onRefreshTask={handleRefreshTask}
        onRecoverTask={handleRecoverTask}
        onCreateCeoIntake={handleCreateCeoIntake}
        onCreateCeoReviewDecision={handleCreateCeoReviewDecision}
        proof={proof}
        businessArtifacts={businessArtifacts}
        selectedCeoAgentId={selectedAgentId}
        tasks={blueprint.tasks}
        taskProgressEvents={taskProgressEvents}
        ceoIntakes={ceoIntakes}
      />,
    );
  }

  if (view === "operations" && blueprint) {
    return renderAppFrame(
      <CompanyOperations
        company={blueprint.company}
        departments={blueprint.departments}
        events={events}
        isPaused={isPaused}
        menuBar={menuBar}
        onConfirmReplanProposal={handleConfirmReplanProposal}
        onCreateReplanProposal={handleCreateReplanProposal}
        replanProposals={replanProposals}
        tasks={blueprint.tasks}
      />,
    );
  }

  if (view === "dashboard" && blueprint) {
    return renderAppFrame(
      <CompanyDashboard
        company={blueprint.company}
        departments={blueprint.departments}
        events={events}
        focusTarget={dashboardFocusTarget}
        founderReport={blueprint.founderReport}
        isPaused={isPaused}
        menuBar={menuBar}
        onKillSwitch={handleKillSwitch}
        onLoadProof={handleLoadProof}
        onLoadReviews={handleLoadReviews}
        objectives={blueprint.objectives}
        proof={proof}
        businessArtifacts={businessArtifacts}
        reviews={reviews}
        tasks={blueprint.tasks}
      />,
    );
  }

  return renderAppFrame(
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
      menuBar={menuBar}
      onBack={goToPreviousStep}
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
  const exists = intakes.some((current) => current.id === intake.id);
  if (!exists) {
    return [...intakes, intake];
  }

  return intakes.map((current) => (current.id === intake.id ? intake : current));
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

function upsertReplanProposal(proposals: ReplanProposalSummary[], proposal: ReplanProposalSummary): ReplanProposalSummary[] {
  const exists = proposals.some((current) => current.id === proposal.id);
  if (!exists) {
    return [...proposals, proposal];
  }

  return proposals.map((current) => (current.id === proposal.id ? proposal : current));
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

function getInitialSkin(): PaletteId {
  if (typeof window === "undefined") {
    return "mono";
  }

  const requestedSkin = new URLSearchParams(window.location.search).get("skin");
  if (requestedSkin && isPaletteId(requestedSkin)) {
    return requestedSkin;
  }

  return readCurrentSkin() ?? "mono";
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

function isFullscreenAvailable() {
  return typeof document !== "undefined" && typeof document.documentElement.requestFullscreen === "function";
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

function defaultCompanyView(companyStatus: string): AppView {
  return companyStatus === "draft" ? "department-workspace" : "dashboard";
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
}

function readCurrentView(): AppView | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  const storedView = window.localStorage.getItem(currentViewStorageKey);
  return isRestorableView(storedView) ? storedView : null;
}

function writeCurrentView(view: AppView): void {
  if (typeof window === "undefined" || !window.localStorage || !isRestorableView(view)) {
    return;
  }

  window.localStorage.setItem(currentViewStorageKey, view);
}

function isRestorableView(view: string | null): view is AppView {
  return view === "onboarding" || view === "department-workspace" || view === "dashboard" || view === "operations";
}
