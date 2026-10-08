import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import type { ApiClient, TaskSummary } from "../../api/client";
import { useLanguage } from "../language";

export const ExecutionActionsContext = createContext<{ client: ApiClient; update(task: TaskSummary): void } | null>(null);

export function TaskExecutionPanel({ task }: { task: TaskSummary }) {
  const context = useContext(ExecutionActionsContext);
  const { language } = useLanguage();
  const zh = language === "zh";
  const [view, setView] = useState(task);
  const [form, setForm] = useState<"budget" | "cancel" | null>(null);
  const [minutes, setMinutes] = useState("0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const contextRef = useRef(context); contextRef.current = context;
  const id = useId();
  const client = context?.client;
  useEffect(() => { setView(task); }, [task]);
  useEffect(() => {
    if (!client || (!task.execution && task.status !== "running" && task.status !== "retrying")) return;
    let closed = false;
    const refresh = async () => {
      try {
        const result = await client.getTaskExecution(task.id);
        if (closed) return;
        setView(result.task);
        if (result.task.status !== task.status || JSON.stringify(result.task.affordances) !== JSON.stringify(task.affordances)) contextRef.current?.update(result.task);
      } catch (e) { if (!closed) setError((e as Error).message); }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => { closed = true; clearInterval(interval); };
  }, [client, task.id, task.status, task.execution?.runId]);
  if (!context || !view.execution) return null;
  const execution = view.execution, budget = execution.budget;
  const phases: Record<string, string> = zh ? { starting: "开始执行", preparing_brief: "准备简报", executing: "执行中", repairing_artifact: "修复产物格式", finalizing: "验证与收尾", settled: "已结算" } : {};
  const healthNames: Record<string, string> = zh ? { responsive: "有响应", unknown: "进度未知", suspect: "心跳延迟", lost: "执行者失联" } : {};
  const healthExplanation = zh && execution.health ? ({ responsive: "心跳和输出活跃，但尚未验证实际进展。", unknown: execution.health.action === "probe" ? "正在探测执行者，等待恢复宽限结束。" : "心跳正常；没有输出不会直接终止执行。", suspect: "心跳延迟，正在探测；工作区仍被保留。", lost: "执行者心跳已过期；尚不能据此确认进程已终止。" } as Record<string, string>)[execution.health.state] : execution.health?.reason;
  const stopNames: Record<string, string> = zh ? { task_budget_exhausted: "任务累计额度耗尽", run_budget_exhausted: "本次执行达到硬上限", phase_budget_exhausted: "当前阶段达到上限", cancelled: "用户取消", worker_lost: "执行者失联", clock_untrusted: "时间依据不可信", termination_unconfirmed: "终止尚未确认" } : {};
  const canGrant = view.affordances?.some(a => a.kind === "authorize_execution_budget") && budget;
  const canCancel = view.affordances?.some(a => a.kind === "cancel_task");
  const seconds = (ms: number) => `${Math.ceil(ms / 1000)} ${zh ? "秒" : "s"}`;
  async function submit() {
    if (!context || busy) return;
    setBusy(true); setError(null);
    try {
      let updated: TaskSummary;
      if (form === "cancel") updated = (await context.client.cancelTask(task.id)).task;
      else {
        if (!budget) return;
        const additionalMs = Number(minutes) * 60_000;
        if (!minutes.trim() || !Number.isSafeInteger(additionalMs) || additionalMs < 0 || !reason.trim()) throw new Error(zh ? "请输入非负分钟数和授权理由。" : "Enter nonnegative minutes and an authorization reason.");
        const signature = JSON.stringify([task.id, additionalMs, reason, budget.authorizedMs]);
        if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
        updated = (await context.client.authorizeExecutionBudget(task.id, { id: request.current.id, additionalMs,
          reason, expectedAuthorizedMs: budget.authorizedMs })).task;
      }
      setView(updated); context.update(updated); setForm(null);
    } catch (e) {
      setError((e as Error).message);
      try { const latest = await context.client.getTaskExecution(task.id); setView(latest.task); context.update(latest.task); } catch { /* Preserve the actionable original error. */ }
    } finally { setBusy(false); }
  }
  return <section aria-label={zh ? "执行状态与预算" : "Execution status and budget"} className="task-execution-panel">
    <p>{zh ? "执行阶段" : "Phase"}: {phases[execution.phase ?? ""] ?? execution.phase ?? "unknown"} · {execution.status}</p>
    <p>{zh ? "健康状态" : "Health"}: {healthNames[execution.health?.state ?? "unknown"] ?? execution.health?.state ?? "unknown"}</p>
    <p>{healthExplanation ?? (zh ? "等待独立监督者采样；没有观测不代表失败。" : "Awaiting independent supervision; missing observation is not failure.")}</p>
    {execution.health && <small>{zh ? "采样时间" : "Observed at"}: {execution.health.checkedAt}</small>}
    {budget && <dl>
      <dt>{zh ? "总授权" : "Authorized"}</dt><dd>{seconds(budget.authorizedMs)}</dd>
      <dt>{zh ? "已消耗" : "Consumed"}</dt><dd>{seconds(budget.consumedMs)}{budget.estimated ? (zh ? "（含保守估算）" : " (includes conservative estimates)") : ""}</dd>
      <dt>{zh ? "已预留未消耗" : "Reserved, unspent"}</dt><dd>{seconds(budget.reservedMs)}</dd>
      <dt>{zh ? "剩余额度" : "Remaining"}</dt><dd>{seconds(budget.remainingMs)}</dd>
      <dt>{zh ? "可再次分配" : "Available for a new run"}</dt><dd>{seconds(budget.availableMs)}</dd>
    </dl>}
    {execution.stop && <p>{zh ? "停止原因" : "Stop reason"}: {stopNames[execution.stop.reason] ?? execution.stop.reason}. {zh ? "终止确认" : "Termination confirmed"}: {execution.stop.manualConfirmedAt ? (zh ? "人工已确认" : "manually confirmed") : execution.stop.terminationConfirmed === null ? (zh ? "尚无证据" : "no evidence yet") : execution.stop.terminationConfirmed ? (zh ? "是" : "yes") : (zh ? "否，工作区保持隔离" : "no; workspace remains isolated")}. {zh ? "终止等待" : "Termination wait"}: {execution.stop.terminationWaitMs === null ? "—" : seconds(execution.stop.terminationWaitMs)}</p>}
    {canGrant && <button type="button" disabled={busy} onClick={() => { setMinutes(budget!.remainingMs > 0 ? "0" : "1"); setForm("budget"); }}>{zh ? "授权续做" : "Authorize continuation"}</button>}
    {canCancel && <button type="button" disabled={busy} onClick={() => setForm("cancel")}>{zh ? "取消任务" : "Cancel task"}</button>}
    {form === "budget" && canGrant && <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p>{zh ? "0 表示使用剩余额度；追加额度只影响后续执行。" : "Zero uses the remaining allowance. Added time applies to future runs."}</p>
      <label htmlFor={`${id}-minutes`}>{zh ? "追加分钟数" : "Additional minutes"}</label>
      <input id={`${id}-minutes`} type="number" min="0" step="0.1" value={minutes} onChange={e => setMinutes(e.target.value)} required disabled={busy} />
      <label htmlFor={`${id}-reason`}>{zh ? "授权理由" : "Authorization reason"}</label>
      <input id={`${id}-reason`} value={reason} onChange={e => setReason(e.target.value)} required maxLength={2000} disabled={busy} />
      <button type="submit" disabled={busy}>{zh ? "确认授权并续做" : "Confirm authorization and resume"}</button>
      <button type="button" disabled={busy} onClick={() => setForm(null)}>{zh ? "返回" : "Back"}</button>
    </form>}
    {form === "cancel" && canCancel && <div>
      <p>{zh ? "确认取消此任务？运行中的进程会收到停止请求；终止未确认时工作区不会释放。" : "Cancel this task? Active execution receives a stop request; its workspace stays claimed until termination is confirmed."}</p>
      <button type="button" disabled={busy} onClick={() => void submit()}>{zh ? "确认取消" : "Confirm cancellation"}</button>
      <button type="button" disabled={busy} onClick={() => setForm(null)}>{zh ? "返回" : "Back"}</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
