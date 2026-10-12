import type { TranslationKey } from "../../ui/language";

export type WorkbenchCommandId = "create-company" | "pause-operating" | "resume-operating" | "stop-operating";

/**
 * One founder command, with whether it can run now. Every surface that offers a command renders it
 * from here — the Workbench header, Settings and the keyboard shortcuts — so they never disagree
 * about when a command is available.
 */
export type WorkbenchCommand = {
  id: WorkbenchCommandId;
  labelKey: TranslationKey;
  enabled: boolean;
  run(): void | Promise<void>;
  shortcut?: string;
};

export type WorkbenchCommands = Record<WorkbenchCommandId, WorkbenchCommand>;

export type WorkbenchCommandState = {
  /** The Onboarding Wizard is on its last step, so a company can be created. */
  canCreateCompany: boolean;
  isCreating: boolean;
  /** The open company's status, or null when none is open. */
  companyStatus: string | null;
  onCreateCompany(): void | Promise<void>;
  onPauseOperating(): void | Promise<void>;
  onResumeOperating(): void | Promise<void>;
  onStopOperating(): void | Promise<void>;
};

/** The company statuses each lifecycle command starts from (ADR 0044); the server guards the same. */
const pausableStatuses = ["active"];
const resumableStatuses = ["paused"];
const stoppableStatuses = ["active", "paused", "creation_failed"];

export function workbenchCommands(state: WorkbenchCommandState): WorkbenchCommands {
  const status = state.companyStatus ?? "";

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
      enabled: pausableStatuses.includes(status),
      run: state.onPauseOperating,
      shortcut: "Shift+Cmd+K",
    },
    "resume-operating": {
      id: "resume-operating",
      labelKey: "menu.resumeOperating",
      enabled: resumableStatuses.includes(status),
      run: state.onResumeOperating,
      shortcut: "Shift+Cmd+K",
    },
    "stop-operating": {
      id: "stop-operating",
      labelKey: "settings.stopOperating",
      enabled: stoppableStatuses.includes(status),
      run: state.onStopOperating,
    },
  };
}

/** The single Pause / Resume control to show: Resume while the company is paused, otherwise Pause. */
export function operatingCommand(commands: WorkbenchCommands): WorkbenchCommand {
  return commands["resume-operating"].enabled ? commands["resume-operating"] : commands["pause-operating"];
}
