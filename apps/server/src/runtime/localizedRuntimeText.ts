import type { CompleteLocalizedText, LocalizedText } from "@auto-crop/core";
import { localizedTextFromString } from "@auto-crop/core";

export function runtimeText(en: string, zh: string): CompleteLocalizedText {
  return { en, zh };
}

export function completeRuntimeText(text: LocalizedText | null | undefined, fallback: string): CompleteLocalizedText {
  return {
    ...localizedTextFromString(fallback),
    ...text,
  };
}

export function receivedCeoTaskText(): CompleteLocalizedText {
  return runtimeText("Received CEO task", "已接收 CEO 任务");
}

export function ceoReviewDecisionMessageText(input: {
  decision: "approve" | "return";
  taskTitle: string;
  taskTitleText?: LocalizedText | null;
}): CompleteLocalizedText {
  const title = completeRuntimeText(input.taskTitleText, input.taskTitle);
  return input.decision === "approve"
    ? runtimeText(`CEO Office approved task: ${title.en}.`, `CEO 办公室批准任务：${title.zh}。`)
    : runtimeText(`CEO Office returned task: ${title.en}.`, `CEO 办公室退回任务：${title.zh}。`);
}

export function ceoReturnProgressLabelText(): CompleteLocalizedText {
  return runtimeText(
    "CEO Office returned this, waiting for the department to rework it.",
    "CEO 办公室已退回，等待部门返工。",
  );
}

export function ceoReturnProgressDetailText(input: {
  reason: string | null;
  note: string | null;
  fallback: string;
}): CompleteLocalizedText {
  const nextStep = input.note ?? "No note provided.";
  return runtimeText(
    input.fallback,
    `原因：${formatCeoReturnReasonZh(input.reason)}。下一步：${nextStep}`,
  );
}

export function fileProofSummaryText(path: string): CompleteLocalizedText {
  return runtimeText(`File proof: ${path}`, `文件证明：${path}`);
}

function formatCeoReturnReasonZh(reason: string | null): string {
  switch (reason) {
    case "needs changes":
      return "需要修改";
    case "task is unclear":
      return "任务不清晰";
    case "task is too large":
      return "任务范围过大";
    case "direction is wrong":
      return "方向错误";
    default:
      return "已退回";
  }
}
