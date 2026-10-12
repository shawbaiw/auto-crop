import type {
  CeoReviewDecisionResponse,
  CeoReviewReturnReason,
  FounderApprovalResponse,
  FounderDecisionResolutionResponse,
  TaskRecoveryResponse,
  TaskRefreshResponse,
} from "../../api/client";

/** The founder actions the Department Workspace hands down to its CEO Office and department surfaces. */
export type WorkspaceHandlers = {
  onConfirmHumanAction?: (humanActionId: string, evidence: Record<string, string>) => Promise<void> | void;
  onResolveFounderDecision?: (input: {
    founderDecisionId: string;
    chosenOption?: string;
    action?: "return";
    returnReason?: CeoReviewReturnReason;
    note?: string;
  }) => Promise<FounderDecisionResolutionResponse> | FounderDecisionResolutionResponse;
  onRefreshTask?: (taskId: string) => Promise<TaskRefreshResponse> | TaskRefreshResponse | void;
  onCreateReplanProposal?: (taskId: string) => Promise<unknown> | unknown | void;
  onDecideFounderApproval?: (approvalId: string, decision: "approved" | "denied") => Promise<FounderApprovalResponse> | FounderApprovalResponse | void;
  onRecoverTask?: (taskId: string) => Promise<TaskRecoveryResponse> | TaskRecoveryResponse | void;
  /** The founder attests the process holding this task's workspace is gone. */
  onConfirmTaskTermination?: (taskId: string) => Promise<unknown> | void;
  onCreateCeoIntake?: (body: string) => Promise<void> | void;
  onCreateCeoReviewDecision?: (input: {
    taskId: string;
    decision: "approve" | "return";
    returnReason?: CeoReviewReturnReason;
    note?: string;
  }) => Promise<CeoReviewDecisionResponse> | CeoReviewDecisionResponse;
};
