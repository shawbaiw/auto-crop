/**
 * Launch Policy: what an Agent Run's process must be denied before any capability is granted back
 * (ADR 0021), and how far an installed CLI can actually enforce it.
 *
 * The policy is Auto-Crop's vocabulary and is the same for every adapter. The flags that express it
 * are not: each adapter declares which flags it needs, the installed CLI's help text says which exist,
 * and the result is an {@link AdapterLaunchSupport} decided before dispatch. A flag the CLI does not
 * declare is never passed — passing it blindly is how a task used to die on
 * `unknown option '--restricted'` instead of being routed away from an adapter that could not run it.
 */

export type LaunchIsolationLevel = "strong" | "compatible" | "unavailable";

export type LaunchPolicy = {
  ignoreUserConfig: boolean;
  ignoreProjectRules: boolean;
  workspaceBoundary: "cli_enforced" | "cwd_only";
  toolGrantControl: "explicit";
  permissionPromptPolicy: "deny_non_interactive";
  ephemeral: boolean;
};

export type AdapterLaunchSupport = {
  adapterId: string;
  /**
   * - `strong`: every flag the adapter uses to express the policy exists.
   * - `compatible`: grant control is intact but some isolation is not CLI-enforced; `warnings` say
   *   which. Dispatchable, and the warnings must reach the task's events.
   * - `unavailable`: grant control itself cannot be expressed. Never dispatch to it.
   */
  isolationLevel: LaunchIsolationLevel;
  /** Flags from the adapter's translation that the installed CLI declares, in the CLI's own spelling. */
  supportedFlags: string[];
  /** Flags from the adapter's translation the installed CLI does not declare. */
  missingFlags: string[];
  warnings: string[];
};

export type LaunchPlan = {
  policy: LaunchPolicy;
  support: AdapterLaunchSupport;
};

/** The default Agent Run policy, as ADR 0021 states it. */
export const DEFAULT_LAUNCH_POLICY: LaunchPolicy = {
  ignoreUserConfig: true,
  ignoreProjectRules: true,
  workspaceBoundary: "cli_enforced",
  toolGrantControl: "explicit",
  permissionPromptPolicy: "deny_non_interactive",
  ephemeral: true,
};

/** How to read one CLI's help text and judge it. The seam tests use to inject help output. */
export type CliHelpProbe = {
  command: string;
  args: string[];
  parse(output: string): AdapterLaunchSupport;
};

/** Runs a command and returns its combined output, or `null` when it could not run or exited non-zero. */
export type ReadCliHelp = (command: string, args: string[]) => Promise<string | null>;

export async function probeLaunchSupport(
  adapterId: string,
  probe: CliHelpProbe,
  readHelp: ReadCliHelp,
): Promise<AdapterLaunchSupport> {
  const output = await readHelp(probe.command, probe.args);
  if (output === null) {
    return unavailableLaunchSupport(adapterId, `${[probe.command, ...probe.args].join(" ")} could not be run.`);
  }
  return probe.parse(output);
}

export function unavailableLaunchSupport(adapterId: string, reason: string): AdapterLaunchSupport {
  return { adapterId, isolationLevel: "unavailable", supportedFlags: [], missingFlags: [], warnings: [reason] };
}

export function supportsFlag(support: AdapterLaunchSupport, flag: string): boolean {
  return support.supportedFlags.includes(flag);
}

/** The first of `spellings` the installed CLI declares, else the first spelling. */
export function flagSpelling(support: AdapterLaunchSupport, ...spellings: [string, ...string[]]): string {
  return spellings.find((spelling) => supportsFlag(support, spelling)) ?? spellings[0];
}

/** One flag the translation needs, accepted under any of its spellings (first is canonical). */
type FlagRequirement = string[];

type LaunchTranslation = {
  adapterId: string;
  name: string;
  /** Without any of these, explicit grant control cannot be expressed: the adapter is unavailable. */
  required: FlagRequirement[];
  /** Without one of these the run still launches, but a policy guarantee degrades to `compatible`. */
  degrading: Array<{ flag: FlagRequirement; warning: string }>;
  /** Used when present; absent costs nothing the policy promises. */
  optional: FlagRequirement[];
};

function evaluateLaunchTranslation(translation: LaunchTranslation, helpText: string): AdapterLaunchSupport {
  const declared = declaredFlags(helpText);
  const supportedFlags: string[] = [];
  const missingFlags: string[] = [];
  const check = (spellings: FlagRequirement): boolean => {
    const found = spellings.filter((spelling) => declared.has(spelling));
    supportedFlags.push(...found);
    if (found.length === 0) {
      missingFlags.push(spellings[0] as string);
    }
    return found.length > 0;
  };

  const missingRequired = translation.required.filter((spellings) => !check(spellings));
  const warnings = translation.degrading
    .filter(({ flag }) => !check(flag))
    .map(({ warning }) => warning);
  translation.optional.forEach(check);

  if (missingRequired.length > 0) {
    return {
      adapterId: translation.adapterId,
      isolationLevel: "unavailable",
      supportedFlags,
      missingFlags,
      warnings: [
        `${translation.name} does not support ${missingRequired.map((spellings) => spellings[0]).join(", ")}; it cannot enforce explicit tool grants and is unavailable for task runs.`,
      ],
    };
  }

  return {
    adapterId: translation.adapterId,
    isolationLevel: warnings.length > 0 ? "compatible" : "strong",
    supportedFlags,
    missingFlags,
    warnings,
  };
}

/**
 * Option names a help text declares: the leading `-x, --long` run of a line indented as a declaration
 * (at most 6 columns — both CLIs indent option names by 2 or 6 and wrap descriptions at 10 or more).
 * Only declarations count, so a flag mentioned in another option's description (Claude Code's help
 * wraps a line starting `--tools names them` inside `--restricted`'s) is not mistaken for support.
 */
export function declaredFlags(helpText: string): Set<string> {
  const flags = new Set<string>();
  for (const line of helpText.split("\n")) {
    const declaration = /^ {0,6}((?:-{1,2}[A-Za-z0-9][\w-]*,?[ \t]*)+)/.exec(line);
    if (!declaration?.[1]) {
      continue;
    }
    for (const token of declaration[1].split(/[,\s]+/)) {
      if (token.startsWith("-")) {
        flags.add(token);
      }
    }
  }
  return flags;
}

export const CLAUDE_CODE_LAUNCH_PROBE: CliHelpProbe = {
  command: "claude",
  args: ["--help"],
  parse: (output) =>
    evaluateLaunchTranslation(
      {
        adapterId: "claude-code",
        name: "Claude Code",
        required: [["-p", "--print"], ["--tools"], ["--allowedTools", "--allowed-tools"], ["--strict-mcp-config"], ["--permission-mode"]],
        degrading: [
          {
            flag: ["--restricted"],
            warning: "Claude Code does not support --restricted; using compatibility launch isolation (user and project settings are not ignored and file tools are not confined to the workspace by the CLI).",
          },
          {
            flag: ["--no-session-persistence"],
            warning: "Claude Code does not support --no-session-persistence; the run's session may be persisted.",
          },
        ],
        optional: [["--permission-prompts"]],
      },
      output,
    ),
};

export const CODEX_LAUNCH_PROBE: CliHelpProbe = {
  command: "codex",
  args: ["exec", "--help"],
  parse: (output) =>
    evaluateLaunchTranslation(
      {
        adapterId: "codex",
        name: "Codex",
        // Codex has no partial translation: each flag carries a distinct half of the policy, and a
        // launch without any one of them would inherit something from the host.
        required: [
          ["-m", "--model"],
          ["-C", "--cd"],
          ["-c", "--config"],
          ["--ignore-user-config"],
          ["--ignore-rules"],
          ["--skip-git-repo-check"],
          ["-s", "--sandbox"],
          ["--ephemeral"],
        ],
        degrading: [],
        optional: [],
      },
      output,
    ),
};
