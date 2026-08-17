export const actionTypes = [
  "read_workspace",
  "write_workspace",
  "run_safe_command",
  "install_dependency",
  "deploy",
  "access_external_account",
  "write_outside_workspace",
  "destructive_file_change",
  "send_message",
  "paid_action",
] as const;

export type ActionType = (typeof actionTypes)[number];
export type PolicyDecision = "auto" | "ask" | "deny";
export type PolicyMode = "safe" | "balanced" | "autonomous";

export type ActionPolicy = {
  mode: PolicyMode;
  decisions: Record<ActionType, PolicyDecision>;
};

export function isActionType(value: string): value is ActionType {
  return (actionTypes as readonly string[]).includes(value);
}

export function decideAction(policy: ActionPolicy, actionType: ActionType): PolicyDecision {
  return policy.decisions[actionType];
}
