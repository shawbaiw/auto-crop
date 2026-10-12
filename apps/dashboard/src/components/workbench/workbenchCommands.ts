import type { TranslationKey } from "../../ui/language";

export type WorkbenchView = "onboarding" | "creating" | "department-workspace" | "dashboard" | "operations";

export type WorkbenchCommandId =
  | "create-company"
  | "pause-operating"
  | "resume-operating"
  | "view-tasks"
  | "view-departments"
  | "view-operations"
  | "load-proof"
  | "load-review"
  | "open-evidence"
  | "fullscreen";

/**
 * One founder command, with whether it can run now. Every surface that offers a command renders it
 * from here — the legacy menu bar today, the Workbench header from P2 — so the two never disagree
 * about when a command is available.
 */
export type WorkbenchCommand = {
  id: WorkbenchCommandId;
  labelKey: TranslationKey;
  enabled: boolean;
  run(): void;
  checked?: boolean;
  shortcut?: string;
};

export type WorkbenchCommands = Record<WorkbenchCommandId, WorkbenchCommand>;

export type WorkbenchCommandState = {
  view: WorkbenchView;
  canCreateCompany: boolean;
  hasBlueprint: boolean;
  hasProof: boolean;
  isCreating: boolean;
  isPaused: boolean;
  /** Only an operating company can be paused; the server says which companies are (ADR 0044). */
  canPauseOperating: boolean;
  isFullscreen: boolean;
  fullscreenAvailable: boolean;
  onCreateCompany(): void;
  onPauseOperating(): void;
  onResumeOperating(): void;
  onViewTasks(): void;
  onViewDepartments(): void;
  onViewOperations(): void;
  onLoadProof(): void;
  onLoadReviews(): void;
  onOpenEvidence(): void;
  onToggleFullscreen(): void;
};

export function workbenchCommands(state: WorkbenchCommandState): WorkbenchCommands {
  const canViewCompanyWork =
    (state.view === "dashboard" || state.view === "department-workspace" || state.view === "operations") && state.hasBlueprint;
  const canUseProof = state.view === "dashboard" && state.hasBlueprint;

  return {
    "create-company": {
      id: "create-company",
      labelKey: state.isCreating ? "menu.creatingCompany" : "menu.createCompany",
      enabled: state.canCreateCompany && !state.isCreating,
      run: state.onCreateCompany,
      shortcut: "Cmd+Enter",
    },
    "pause-operating": {
      id: "pause-operating",
      labelKey: "menu.pauseOperating",
      enabled: !state.isPaused && state.canPauseOperating,
      run: state.onPauseOperating,
      shortcut: "Shift+Cmd+K",
    },
    "resume-operating": {
      id: "resume-operating",
      labelKey: "menu.resumeOperating",
      enabled: state.isPaused,
      run: state.onResumeOperating,
      shortcut: "Shift+Cmd+K",
    },
    "view-tasks": {
      id: "view-tasks",
      labelKey: "menu.viewTasks",
      enabled: canViewCompanyWork,
      run: state.onViewTasks,
      shortcut: "Cmd+1",
    },
    "view-departments": {
      id: "view-departments",
      labelKey: "menu.viewDepartments",
      enabled: canViewCompanyWork,
      run: state.onViewDepartments,
      shortcut: "Cmd+2",
    },
    "view-operations": {
      id: "view-operations",
      labelKey: "menu.viewOperations",
      enabled: canViewCompanyWork,
      run: state.onViewOperations,
    },
    "load-proof": {
      id: "load-proof",
      labelKey: "menu.loadProof",
      enabled: canUseProof,
      run: state.onLoadProof,
      shortcut: "Cmd+3",
    },
    "load-review": {
      id: "load-review",
      labelKey: "menu.loadReview",
      enabled: canUseProof,
      run: state.onLoadReviews,
      shortcut: "Cmd+4",
    },
    "open-evidence": {
      id: "open-evidence",
      labelKey: "menu.openEvidence",
      enabled: canUseProof && state.hasProof,
      run: state.onOpenEvidence,
      shortcut: "Cmd+5",
    },
    fullscreen: {
      id: "fullscreen",
      labelKey: state.isFullscreen ? "menu.exitFullscreen" : "menu.fullscreen",
      enabled: state.fullscreenAvailable,
      checked: state.isFullscreen,
      run: state.onToggleFullscreen,
      shortcut: "Ctrl+Cmd+F",
    },
  };
}

/** The single Pause / Resume control to show: Resume while the company is paused, otherwise Pause. */
export function operatingCommand(commands: WorkbenchCommands): WorkbenchCommand {
  return commands["resume-operating"].enabled ? commands["resume-operating"] : commands["pause-operating"];
}
