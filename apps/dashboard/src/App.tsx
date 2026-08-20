import { useEffect, useMemo, useState } from "react";
import {
  createApiClient,
  type AgentSummary,
  type ApiClient,
  type CreateCompanyResponse,
  type ProofSummary,
  type ReviewSummary,
  type ServerEvent,
} from "./api/client";
import { CompanyDashboard, type DashboardFocusSection, type DashboardFocusTarget } from "./pages/CompanyDashboard";
import { CompanyCreationLoading } from "./pages/CompanyCreationLoading";
import { DepartmentWorkspace } from "./pages/DepartmentWorkspace";
import { Onboarding, type OnboardingStep } from "./pages/Onboarding";
import { CRTViewport } from "./ui/crt";
import { DashboardMenuBar } from "./ui/menu/DashboardMenuBar";
import { isPaletteId, ThemeProvider, type PaletteId } from "./ui/theme";
import "./styles.css";

export type AppProps = {
  apiClient?: ApiClient;
};

type AgentLoadState = "idle" | "loading" | "ready" | "failed";
type AppView = "onboarding" | "creating" | "department-workspace" | "dashboard";
const currentCompanyStorageKey = "auto-crop.currentCompanyId";

export default function App({ apiClient }: AppProps) {
  const client = useMemo(() => apiClient ?? createApiClient(), [apiClient]);
  const defaultSkin = useMemo(() => getInitialSkin(), []);
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
  const [proof, setProof] = useState<ProofSummary[]>([]);
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [view, setView] = useState<AppView>("onboarding");
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("company");
  const [dashboardFocusTarget, setDashboardFocusTarget] = useState<DashboardFocusTarget | null>(null);

  useEffect(() => {
    const companyId = readCurrentCompanyId();
    if (!companyId) {
      return;
    }

    let cancelled = false;
    void client
      .getCompanyState(companyId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setBlueprint(response);
        setProof(response.proof);
        setReviews(response.reviews);
        setEvents(response.activity);
        setSelectedAgentId(response.company.selectedCeoAgentId ?? "");
        setView(response.company.status === "draft" ? "department-workspace" : "dashboard");
      })
      .catch(() => {
        clearCurrentCompanyId();
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

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
      setReviews(response.reviews ?? []);
      setEvents(response.activity ?? []);
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
      onViewTasks={() => focusDashboardSection("tasks")}
      selectedAgentId={selectedAgentId}
      view={view}
    />
  );

  if (view === "creating") {
    const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;

    return (
      <ThemeProvider defaultSkin={defaultSkin}>
        <CRTViewport>
          <CompanyCreationLoading
            companyName={companyName.trim()}
            menuBar={menuBar}
            permissionMode={permissionMode}
            selectedAgent={selectedAgent}
          />
        </CRTViewport>
      </ThemeProvider>
    );
  }

  if (view === "department-workspace" && blueprint) {
    return (
      <ThemeProvider defaultSkin={defaultSkin}>
        <CRTViewport>
          <DepartmentWorkspace
            agents={agents}
            company={blueprint.company}
            departments={blueprint.departments}
            menuBar={menuBar}
            objectives={blueprint.objectives}
            events={events}
            selectedCeoAgentId={selectedAgentId}
            tasks={blueprint.tasks}
          />
        </CRTViewport>
      </ThemeProvider>
    );
  }

  if (view === "dashboard" && blueprint) {
    return (
      <ThemeProvider defaultSkin={defaultSkin}>
        <CRTViewport>
          <CompanyDashboard
            company={blueprint.company}
            departments={blueprint.departments}
            events={events}
            focusTarget={dashboardFocusTarget}
            isPaused={isPaused}
            menuBar={menuBar}
            onKillSwitch={handleKillSwitch}
            onLoadProof={handleLoadProof}
            onLoadReviews={handleLoadReviews}
            objectives={blueprint.objectives}
            proof={proof}
            reviews={reviews}
            tasks={blueprint.tasks}
          />
        </CRTViewport>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultSkin={defaultSkin}>
      <CRTViewport>
        <Onboarding
          agents={agents}
          agentLoadState={agentLoadState}
          agentSelectionError={agentSelectionError}
          blueprint={blueprint}
          companyName={companyName}
          companyNameError={companyNameError}
          createError={createError}
          founderVision={founderVision}
          founderVisionError={founderVisionError}
          isCreating={isCreating}
          menuBar={menuBar}
          onActivateCompany={handleActivateCompany}
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
        />
      </CRTViewport>
    </ThemeProvider>
  );
}

function getInitialSkin(): PaletteId {
  if (typeof window === "undefined") {
    return "mono";
  }

  const requestedSkin = new URLSearchParams(window.location.search).get("skin");
  return requestedSkin && isPaletteId(requestedSkin) ? requestedSkin : "mono";
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
      failureReason: event.failureReason ?? (event.type === "task_started" ? undefined : task.failureReason),
      failureMessage: event.failureMessage ?? (event.type === "task_started" ? undefined : task.failureMessage),
      executionProfileName: event.executionProfileName ?? task.executionProfileName,
      requestedTimeoutMs: event.requestedTimeoutMs ?? task.requestedTimeoutMs,
      effectiveTimeoutMs: event.effectiveTimeoutMs ?? task.effectiveTimeoutMs,
      dependencyNote: event.dependencyNote ?? (event.type === "task_started" ? undefined : task.dependencyNote),
      artifactWorkspacePath: event.artifactWorkspacePath ?? task.artifactWorkspacePath,
    };
  });

  return changed ? { ...blueprint, tasks } : blueprint;
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
    default:
      return null;
  }
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
}
