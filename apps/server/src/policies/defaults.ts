import type { ActionPolicy } from "./policy";

export const safePolicy = {
  mode: "safe",
  decisions: {
    read_workspace: "auto",
    write_workspace: "ask",
    run_safe_command: "ask",
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
