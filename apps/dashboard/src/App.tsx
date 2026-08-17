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
import { Onboarding } from "./pages/Onboarding";
import { CRTViewport } from "./ui/crt";
import { DashboardMenuBar } from "./ui/menu/DashboardMenuBar";
import { ThemeProvider } from "./ui/theme";
import "./styles.css";

export type AppProps = {
  apiClient?: ApiClient;
};

export default function App({ apiClient }: AppProps) {
  const client = useMemo(() => apiClient ?? createApiClient(), [apiClient]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentLoadState, setAgentLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [selectedAgentId, setSelectedAgentId] = useState("codex");
  const [founderVision, setFounderVision] = useState("");
  const [permissionMode, setPermissionMode] = useState("balanced");
  const [blueprint, setBlueprint] = useState<CreateCompanyResponse | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [proof, setProof] = useState<ProofSummary[]>([]);
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [view, setView] = useState<"onboarding" | "dashboard">("onboarding");
  const [dashboardFocusTarget, setDashboardFocusTarget] = useState<DashboardFocusTarget | null>(null);

  useEffect(() => {
    let active = true;
    setAgentLoadState("loading");
    client
      .listAgents()
      .then((response) => {
        if (!active) {
          return;
        }
        setAgents(response.agents);
        setAgentLoadState("ready");
        const detectedCodex = response.agents.find((agent) => agent.id === "codex" && agent.detected);
        const firstDetected = response.agents.find((agent) => agent.detected);
        setSelectedAgentId((detectedCodex ?? firstDetected ?? response.agents[0])?.id ?? "codex");
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setAgents([]);
        setAgentLoadState("failed");
      });

    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    return client.subscribeEvents((event) => {
      setEvents((current) => [...current.slice(-49), event]);
    });
  }, [client]);

  async function handleCreateCompany() {
    setIsCreating(true);
    setCreateError(null);
    try {
      const response = await client.createCompany({
        founderVision,
        selectedCeoAgentId: selectedAgentId,
        permissionMode,
        assets: [],
      });
      setBlueprint(response);
    } catch (error) {
      setCreateError((error as Error).message);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleActivateCompany() {
    if (!blueprint) {
      return;
    }

    const response = await client.activateCompany(blueprint.company.id);
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
    setDashboardFocusTarget((current) => ({
      section,
      version: (current?.version ?? 0) + 1,
    }));
  }

  function handleMenuLoadProof() {
    focusDashboardSection("proof");
    void handleLoadProof();
  }

  function handleMenuLoadReviews() {
    focusDashboardSection("review");
    void handleLoadReviews();
  }

  const menuBar = (
    <DashboardMenuBar
      agents={agents}
      hasBlueprint={Boolean(blueprint)}
      isCreating={isCreating}
      isPaused={isPaused}
      onActivateCompany={handleActivateCompany}
      onBackToSetup={handleBackToSetup}
      onCreateCompany={handleCreateCompany}
      onKillSwitch={handleKillSwitch}
      onLoadProof={handleMenuLoadProof}
      onLoadReviews={handleMenuLoadReviews}
      onSelectAgent={setSelectedAgentId}
      onViewDepartments={() => focusDashboardSection("departments")}
      onViewTasks={() => focusDashboardSection("tasks")}
      selectedAgentId={selectedAgentId}
      view={view}
    />
  );

  if (view === "dashboard" && blueprint) {
    return (
      <ThemeProvider defaultSkin="mono">
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
    <ThemeProvider defaultSkin="mono">
      <CRTViewport>
        <Onboarding
          agents={agents}
          agentLoadState={agentLoadState}
          blueprint={blueprint}
          createError={createError}
          founderVision={founderVision}
          isCreating={isCreating}
          menuBar={menuBar}
          onActivateCompany={handleActivateCompany}
          onCreateCompany={handleCreateCompany}
          onPermissionModeChange={setPermissionMode}
          onSelectAgent={setSelectedAgentId}
          onVisionChange={setFounderVision}
          permissionMode={permissionMode}
          selectedAgentId={selectedAgentId}
        />
      </CRTViewport>
    </ThemeProvider>
  );
}
