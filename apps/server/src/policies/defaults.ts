import type { ActionPolicy, PolicyMode } from "./policy";

export const safePolicy = {
  mode: "safe",
  decisions: {
    read_workspace: "auto",
    write_workspace: "ask",
    run_safe_command: "ask",
    read_public_web: "ask",
    install_dependency: "ask",
    deploy: "ask",
    access_external_account: "ask",
    write_outside_workspace: "deny",
    destructive_file_change: "ask",
    send_message: "ask",
    paid_action: "deny",
  },
} as const satisfies ActionPolicy;

export const balancedPolicy = {
  mode: "balanced",
  decisions: {
    read_workspace: "auto",
    write_workspace: "auto",
    run_safe_command: "auto",
    read_public_web: "auto",
    install_dependency: "ask",
    deploy: "ask",
    access_external_account: "ask",
    write_outside_workspace: "deny",
    destructive_file_change: "ask",
    send_message: "ask",
    paid_action: "deny",
  },
} as const satisfies ActionPolicy;

export const autonomousPolicy = {
  mode: "autonomous",
  decisions: {
    read_workspace: "auto",
    write_workspace: "auto",
    run_safe_command: "auto",
    read_public_web: "auto",
    install_dependency: "auto",
    deploy: "auto",
    access_external_account: "ask",
    write_outside_workspace: "deny",
    destructive_file_change: "ask",
    send_message: "ask",
    paid_action: "deny",
  },
} as const satisfies ActionPolicy;

export function getDefaultPolicy(): ActionPolicy {
  return balancedPolicy;
}

/**
 * The Action Policy a company's Permission Mode selects.
 *
 * Permission Mode was stored on the company and shown in the UI, but the scheduler read
 * `getDefaultPolicy()` instead, so a company set to `safe` never actually asked. Resolving the
 * company's own mode is what makes the setting mean something — and it is why Founder Approval had
 * to become a real, answerable request rather than a stub (ADR 0020 amendment).
 */
export function resolvePolicyForPermissionMode(mode: PolicyMode | null | undefined): ActionPolicy {
  switch (mode) {
    case "safe":
      return safePolicy;
    case "autonomous":
      return autonomousPolicy;
    case "balanced":
      return balancedPolicy;
    default:
      return getDefaultPolicy();
  }
}
