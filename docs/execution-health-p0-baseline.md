# P0 基线证据：执行结算、锁与遗留状态的当前行为

日期：2026-09-21。基线：`main@a3893bd`（工作区含本文与方案文档的未提交修改）。

> **后续状态（2026-09-23，K4）**：F1–F4 已在 P2a 修复；F5/F6 已在 P2b/P2c 修复，K2/K3 补齐同事务事件与 Worker 退出隔离。见 [ADR 0035](adr/0035-a-settlement-is-one-transaction.md)、[实施记录](execution-health-and-recovery-plan.md)及 [ADR 0037](adr/0037-supervision-from-outside-the-worker.md)。第 2、3 节保留历史发现与当时未验证项，各条状态和第 4 节注明当前证据；不要将基线缺口当作现状。

## 与实施方案的关系

本文是 [execution-health-and-recovery-plan.md](execution-health-and-recovery-plan.md) 第 10 节 **P0 阶段**的交付物，不是独立提案。两者分工：

| 文档 | 角色 |
| --- | --- |
| `execution-health-and-recovery-plan.md` | 目标、不变量、模块职责、数据契约、P0–P5 阶段与验收矩阵。**要做什么** |
| 本文 | P0 要求的"可重复基线证据"：审计结果 + 故障注入测试 + 三分类结论。**当前实际是什么** |

方案第 2 节列出的代码依据由本文逐条核对；方案第 11 节验收矩阵中新增的两行（"收尾失去认领后继续返回"、"run 终结与 Task/产物提交之间发生异常或崩溃"）由本文的测试首次落地为可执行证据。后续阶段修改行为时，本文的断言就是"改之前是什么样"的参照；P2 完成后需回到本文标注哪些断言已被新行为取代。

本文不提出新设计，不修改任何生产代码路径。

## 方法与边界

- 只读代码 + 新增故障注入测试。未调用真实付费模型，未对用户运行中的 Worker 发送任何信号，未改生产预算。
- 测试使用 fake adapter、注入时钟、内存 SQLite，全部确定性。
- 未覆盖：多连接/多 Worker 真实竞争（方案要求，P2 交付）、真实进程终止语义、时钟跳变与休眠。这些在下文"未验证假设"中列明。

## 1. 审计结果

### 1.1 Agent 调用点（方案 §4.2 要求清点）

| 位置 | 作业类型 | 是否有 `agent_runs` 行 | 取消能力 |
| --- | --- | --- | --- |
| `scheduler.ts:400` | Task 正式执行 | 是 | 无 |
| `executionBrief.ts:40` | 简报 | 复用同一 run 行 | 无 |
| `artifactSyntaxRepair.ts:72` | 语法修复 | 复用同一 run 行 | 无 |
| `createCompany.ts:172` | 公司创建 | 否 | 无 |
| `finalFounderReport.ts:173` | 最终报告 | 否 | 无 |
| `replan.ts:157` | CEO replan | 否 | 无 |
| `agentSessions.ts:138` | 上面三者的共用一次性/会话入口 | 否 | `stopCompanySessions` 仅停会话 |

一个 Task 分派的**简报、正式执行、语法修复共用同一个 `agentRunId`**，run 行只记录一次 `startedAt` 与一个 `effectiveTimeoutMs`。方案 §5.1 要求的"同一个 run 的不同 invocation"当前不存在，因此无法归因某个阶段。

Task 之外的四个调用点没有 run 记录、没有超时归因、没有取消柄，方案 §4.2 要求的"声明作业类型和覆盖范围"尚未落地。

### 1.2 run 终结入口（`updateAgentRunStatus`）

| 调用点 | 是否条件写入 | 结论 |
| --- | --- | --- |
| `scheduler.ts:1630` `claimRun` | 是（`expectedStatus: "running"`） | 受保护 |
| `taskRecovery.ts:71` 过期回收 | 是（`expectedStatus: "running"`） | 受保护 |
| `scheduler.ts:1652` `terminateAsRetryExhausted` | **否** | 无条件覆盖，见 F4 |
| `killSwitch.ts:40` Emergency Stop | **否** | 无条件覆盖；读列表与写之间存在窗口 |

### 1.3 锁的获取与释放

| 调用点 | 范围 |
| --- | --- |
| `scheduler.ts:223` `acquireTaskLock(task.id, workerId)` | 唯一获取点 |
| `scheduler.ts:833` `finally` 内 `releaseTaskLock(task.id, workerId)` | 无条件，不检查是否仍持有该 run，见 F2 |
| `taskRecovery.ts:403` `releaseAnyTaskLock` | 按 taskId 找到任意 owner 就释放，不校验 owner |
| `killSwitch.ts:43` `releaseAllTaskLocks()` | 释放**全库所有**锁，不限当前公司 |

锁表只有 `(task_id, owner_id, acquired_at)`：没有 runId、没有 epoch、没有租约、没有工作区维度。方案 §3 不变量 1（共享可写工作区互斥）与不变量 2（epoch）在数据层就无处安放。

### 1.4 GET 触发的执行判死入口

`reconcileStaleRunningTasks` 的调用点：

- `scheduler.ts:129`（调度 tick，正当）
- `taskRecovery.ts:164`（`recoverTask` 内，正当）
- `routes.ts:883` `buildCompanyState` —— 被 4 条路由到达，其中 `GET /api/companies/:id/state`（`routes.ts:341`）是纯读请求。

即 **读一次公司状态就可能把一个正在收尾的 run 判为失败、给 Task 加 Hold、释放锁**。方案 §3 不变量 8 要求移除，属于 P2。

## 2. 发现

编号供后续阶段引用。每条都有对应测试。

### F1 —— 败方仍写 proof、handoff 包与产物指针

ADR 0034 的 claim 只保护 run 行、Task 状态与 Business Artifact。`appendProof`（`scheduler.ts:575`）、`createHandoffPackage`（`:617`）、`updateTaskArtifactWorkspacePath`（`:791`）全部在 `claimRun` 之前，无条件执行。

结果：过期回收获胜后，Task 仍落下一条 proof、一个 `.auto-crop-handoff/` 目录；若该 Task 此前有 Partial Output，其产物指针已被改写到本次（已作废的）工作区，下游读到的是失败运行留下的目录。

证据（已改写为断言修复后的行为）：`scheduler.test.ts`
- `writes no proof and publishes no handoff package after losing the claim`
- `leaves the task's artifact workspace pointing at the earlier run after losing the claim`

**状态：P2a 已修复。** proof 与产物指针移入结算事务，handoff 包改为提交后仅由胜方发布。

### F2 —— 败方的 `finally` 会释放接任者的锁

锁只按 `(taskId, workerId)` 匹配，而单进程内所有分派共用同一个 `workerId`。过期回收释放锁后，同一进程的重新分派拿到新锁；败方协程随后走到 `finally`，`releaseTaskLock(taskId, workerId)` 命中的正是新锁。

结果：新执行在无锁状态下继续运行，第三个分派可以并发进入同一 Task 与同一工作区。这是方案 §3 不变量 1 与 4 的直接反例。

证据（已改写）：`scheduler.test.ts` › `leaves a redispatch's lock alone when the loser's dispatch unwinds`

**状态：P2a 已修复。** `task_locks.run_id` 记录锁所属的 run，释放须指名同一个 run。并行的 `runtime/locks.ts` 实现已删除。

### F3 —— 结算中断留下永久无主的 running Task

`claimRun("complete")` 与其后的 `persistArtifact` / `finalizeDelivery` / Task 转换不在同一事务内。在两者之间抛异常（数据库忙、磁盘错误、进程被中断）后：

- run 行 = `complete`
- Task = `running`，无 Hold，无 Business Artifact
- 锁被 `finally` 释放

而 `reconcileStaleRunningTasks` 只遍历 `listRunningAgentRuns`，这个 run 已是终态，**永远不会再被检查**。Task 在界面上无限期显示"执行中"，没有任何自动或手动出口。

证据（已改写）：`scheduler.test.ts` › `rolls the claim back with the settlement when committing the delivery is interrupted`

**状态：P2a 已修复。** 认领与其授权的全部写入同属一个事务，中断后 run 回到 `running`，仍受 deadline 管辖。

### F4 —— 重试上限路径完全不认领，且能制造双 Hold

`endedAtRetryCeiling` → `terminateAsRetryExhausted` 的 `updateAgentRunStatus` 不带 `expectedStatus`；在 proof 捕获失败分支（`scheduler.ts:534`）它还排在 `claimRun` **之前**。

结果：已经输掉 run 的分派把胜方写的 `timeout` 覆盖成 `retry_exhausted`，并再加一个 Hold。实测该 Task 同时持有 `recovery_exhausted` 与 `runtime_interrupted` 两个 open Hold —— ADR 0020 的"单一停摆状态"被破坏。

证据（已改写）：`scheduler.test.ts` › `leaves the winner's settlement alone when the loser reaches the retry ceiling`

**状态：P2a 已修复。** 重试上限成为结算携带的 outcome，不再自成写入者；双 Hold 不再可能。

### F5 —— 三类遗留状态组合无人对账

对账由 `listRunningAgentRuns` 驱动，凡是没有 `running` run 的组合一律不可见：

| 组合 | 成因 | 当前行为 |
| --- | --- | --- |
| queued + 锁，无 run | Worker 死于 `acquireTaskLock` 与 `createAgentRun` 之间 | 锁永久残留，该 Task 后续每次 tick 都拿不到锁 |
| running + 锁，无 run | 同上，且 Task 已转 running | Task 永久 `running`，无 Hold |
| 终态 run + 残留锁 | 结算中断（F3）或异常退出 | 锁永久残留，`acquireTaskLock` 永远失败 |

证据：`taskRecovery.test.ts` › `leftover state combinations reconciliation does not reach`（基线时 3 条；现已改写，见第 4 节）

**历史状态（P2a）：部分缓解，未修复。** 结算中断不再制造新的"终态 run + 残留锁"（F3 已修）。但锁与 run 仍分两步创建，"queued/running + 锁无 run"的窗口依旧存在，对账仍看不见这三种组合。需要 P2b 把锁、run 与 running 转换放进同一事务。

**当前状态：P2b/P2c 已修复。** queued 或终态 run 的残留 Task 锁可在租约过期后重新获取；running 且无 run 的孤儿在有过期锁证据时结算为 `worker_lost` 并建立 Hold。无锁的 running Task 保守保留。K2（`e1811fd`）使该结算、释放锁与 outbox 同事务；K3（`74906e7`）让已确认退出的 owner 无需等租约，无法确认 Agent 停止的工作区持续隔离。终态 run 遗留未分类工作区 claim 仍需人工核实，不承诺自动清理。

### F6 —— 取消是空实现

`routes.ts:863` 把 `cancelActiveRun` 接成 `() => undefined`。Emergency Stop 写 `cancelled` 状态、清全库锁，但**从不终止任何子进程**。`cliAgent.ts` 的 `runCommand` 也只在自身超时时发一次 `SIGTERM` 并立即 `resolve`，不等退出、不升级、不校验 pid、不建进程组。

对应方案 §7 全部未实现；`killSwitch.ts:43` 的 `releaseAllTaskLocks()` 还会误清其他公司的锁。

证据：代码审计（1.2/1.3 表）。进程行为的实测属于 P2b/P5。

**当前状态：P2b/P2c 已修复。** 本 Worker 内的取消通过 execution registry 下达 AbortSignal；CLI adapter 按进程组 SIGTERM、宽限后 SIGKILL 并等待确认，未确认停止则隔离工作区。Emergency Stop 按公司/run 释放 Task 锁；K2（`e1811fd`）补齐结算与事件事务。Windows 进程树、跨 Worker 控制仍在边界外；K3（`74906e7`）对死亡 Worker 的后代选择隔离，不冒充已终止。

## 3. 三分类结论

### 已实现且经回归保护

- ADR 0034 双向条件结算：run 行、Task 状态、Business Artifact、完成事件、验收事件。
- 150s 收尾宽限（`ARTIFACT_SYNTAX_REPAIR_TIMEOUT_MS + 30_000`），宽限内收尾成功、宽限外回收获胜两个方向均有回归。
- `updateAgentRunStatus` 的可选 `expectedStatus` 及其布尔返回。
- 简报失败不升档正式任务预算（ADR 0032）。

### 本文方案提出、当前确实不存在

运行中心跳、`ownerEpoch`、Worker 身份、workspace claim、阶段与 invocation 标识、活动记录与静默统计、生命周期预算账本、软/硬/累计三级预算、独立健康监督、进程外 Supervisor、outbox 与 Dispatcher、Recovery Coordinator、真实取消与终止确认、健康续时。以上均为 P1–P5 待建，不是回归缺陷。

### 未验证假设（本轮未能证明或证伪）

1. ~~多连接 SQLite 下条件更新是否仍原子~~ —— **P2a 已证实**：跨连接恰好一个赢家（`multiConnection.test.ts`）。
2. ~~`repositories.transaction` 的 SAVEPOINT 在多连接下的语义~~ —— **P2a 已证实且部分证伪**：确实开启真事务并跨连接隔离；但事务内先读后写会在对方提交后升级失败，`busy_timeout` 无效，故结算必须以认领为第一条语句。另：`busy_timeout` 当前为 0，第二个连接的写入立即失败而非等待，P3 引入 Supervisor 连接前须设定有界值。
3. 跨进程（两个 Worker，不同 `workerId`）的锁与认领竞争 —— 仍未实测，留给 P2b。
4. `SIGTERM` 后 CLI 子进程的真实退出时间与是否继续写工作区。
5. 方案 §6.3 的全部候选阈值（20s/5s/90s/20min/45min 等）无任何实测支撑。
6. 636s 那个样本之外，没有任务耗时分布数据。

## 4. 测试清单与复现

新增 8 条，全部确定性、无外部依赖：

```
pnpm exec vitest run apps/server/src/runtime/scheduler.test.ts apps/server/src/runtime/taskRecovery.test.ts apps/server/src/api/routes.test.ts
```

`scheduler.test.ts` › `a settlement racing a timeout declaration`（原 3 条 + 新 5 条）。P2a 后已全部改写为断言修复后的行为：
- writes no proof and publishes no handoff package after losing the claim → F1 ✅
- leaves the task's artifact workspace pointing at the earlier run after losing the claim → F1 ✅
- leaves a redispatch's lock alone when the loser's dispatch unwinds → F2 ✅
- rolls the claim back with the settlement when committing the delivery is interrupted → F3 ✅
- leaves the winner's settlement alone when the loser reaches the retry ceiling → F4 ✅

`taskRecovery.test.ts` › `leftover state after a worker dies mid-dispatch` → F5，现断言过期锁重新获取、孤儿恢复及无锁 running 保守保留。F6 由 `adapters/registry.test.ts` 的真实取消/升级终止和 `runtime/killSwitch.test.ts` 覆盖。K4 新增 `pnpm smoke:execution-health`，通过真实 `start` 入口验证死亡对账、隔离和重复消费。

P2a 另新增：`db/multiConnection.test.ts`（4 条，多连接竞争语义）与 `scheduler.test.ts` › `the settlement transaction`（扫描源码，禁止事务内 await 与文件 I/O）。

原则不变：断言当前行为的测试在对应阶段修复时必须被改写，改写本身就是修复到位的证明。

基线结果（`a3893bd` + 本文测试）：

- 上述三个文件：144 项通过（原 136 + 新 8）。
- `pnpm test`：55 文件 / 781 项全部通过。
- `pnpm typecheck`、`pnpm lint`：通过。
- 未运行真实 Agent。
- `pnpm smoke:mock` 在本机失败（`SSE endpoint should connect.`）。已用 `git stash` 在干净的 `a3893bd` 上复现，**属既有问题，与本次改动无关**；未在本轮排查。

K4 复测补充（2026-09-23）：`pnpm smoke:mock` 仍在连接 SSE 时失败。脚本请求 `/api/events` 未带 `companyId`，`routes.ts` 对该请求明确返回 400，属于旧冒烟与公司事件流接口不匹配；本轮未扩大范围修复该业务冒烟，由独立的 `smoke:execution-health` 验收监督链路。


P5 前置修复（2026-09-24）：旧 `smoke:mock` 故障已修复。冒烟按公司 ID 订阅 SSE，等待异步创建从 `creating` 进入 `draft`，由 mock 执行器生成有效产品简报，并验证自动验收、Proof、业务产物、公司复盘和 kill switch。普通简报已由 Automatic Acceptance 完成，因此公司复盘不应重复完成它。原有 P0/K4 失败记录保留为历史证据。另已注入 SSE 建连后的失败，确认退出 1、关闭进程并清理临时工作区；移除注入后 `pnpm smoke:mock` 退出 0。
