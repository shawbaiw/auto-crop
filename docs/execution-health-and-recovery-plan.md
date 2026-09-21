# 执行健康监控、预算与恢复：交给 Claude 的实施方案

日期：2026-09-21。已核对基线：`main@a3893bd`（包含 PR #12，结算保护实现提交 `0a82cf0`）；原方案基线为 `b70636a`。

状态：实施中。**P0 已完成**，基线证据见 [execution-health-p0-baseline.md](execution-health-p0-baseline.md)；**P2a（结算一致性）已完成**，见 [ADR 0035](adr/0035-a-settlement-is-one-transaction.md)；**P1（只采集）已完成**；**P2b 大部分完成**（workspace claim 与 termination_unconfirmed 出口留给 P2c）。剩余 P2c、P3–P5 待实施。运行健康监控、健康续时和可靠恢复链仍待实施。迄今未运行真实 Agent，未调整生产预算。

阶段顺序已按实测调整为 **P0 → P2a → P1 → P2b → P3 → P5**：P2a 修的是当前就在损坏数据的一致性缺陷（基线 F1–F4），P1 的纯观测对它们零保护，且观测要挂在结算 seam 上，先建 seam 可免于写两遍。P2b（移除 GET 判死、取消闭环）确实需要 P1 的观测数据，故留在 P1 之后。

## 1. 目标与交付边界

用户要实现：任务仍在执行时，系统能观察它是否异常；健康长任务尽量持续执行；明确失败及时发现；失联在有界时间内被识别；可靠通知恢复或排查程序；恢复尽量利用已有成果。

目标不是取消所有超时，也不是给一个固定计时器换名字。必须把以下三个判断分别建模：

| 判断 | 含义 | 不能推出什么 |
| --- | --- | --- |
| 运行健康 | 运行器响应、模型/工具有活动、阶段合理 | 不能保证最终产物正确 |
| 预算耗尽 | 已达到本次允许消耗的时间或资源 | 不等于死锁、进程崩溃或规划错误 |
| 需要重新规划 | 有证据表明任务范围、依赖或交付方式需要调整 | 不能只由 long 档超时推导 |

最终交付包括数据迁移、执行归属、进程控制、观测、独立监控、预算策略、可靠事件与恢复消费者、API/界面、测试及运维文档。分阶段实现，阶段完成不等于全目标完成。

本轮不处理执行简报内容质量、业务规划算法、多主机远程执行、通用工作流平台。简报继续使用现有结构化契约；远程执行只明确能力不足时的行为，不假装已经支持。

## 2. 实施前必读与代码依据

P0 的审计与复现结果见 [execution-health-p0-baseline.md](execution-health-p0-baseline.md)；本节的代码依据已在那里逐条核对，后续阶段以它为"改之前是什么样"的参照。

Claude 开始时读取仓库当前约定，确认 HEAD 相对本基线的变化，并检查工作区。`docs/open-issues-execution-budget-and-brief-quality.md` 已提交，可作为问题背景阅读；本文不覆盖它，实施时保留用户新增的未提交修改。代码符号优先于历史行号。

必读：根 `CONTEXT.md`、`apps/server/CONTEXT.md`、`apps/dashboard/CONTEXT.md`、ADR 0015、0020、0021、0022、0026、0028、0032、[0034](adr/0034-one-writer-settles-a-run.md)，以及执行预算相关 ADR 0001。实施中新增或修改 ADR/CONTEXT 时使用仓库的 domain-modeling、writing-for-agents 技能；按仓库要求执行测试。

已核对的实现位置：

| 位置/符号 | 当前事实 | 方案要求 |
| --- | --- | --- |
| `apps/cli/src/commands/start.ts` 的 `tick` | `running` 时后续 tick 返回 | 监控与执行调度分别运行 |
| `packages/core/src/types.ts` 的 `AgentRun` | 没有运行中心跳/活动字段 | 添加明确的观测与归属数据 |
| `apps/server/src/adapters/cliAgent.ts` 的 `runCommand` | 总时间计时；stdout/stderr 只记录；SIGTERM 后立即返回 | 保留输出并观测；受控停止；等待退出 |
| `apps/server/src/runtime/scheduler.ts` | 拿锁先于建 run；简报扣预算；超时升档重跑 | 原子认领；阶段预算；健康续时 |
| `runtime/artifactSyntaxRepair.ts` | 正式执行后另跑最多 120s 修复 | 修复属于可观测执行阶段 |
| `runtime/taskRecovery.ts` 的 `reconcileStaleRunningTasks` | 遍历 running run，按 startedAt + effectiveTimeoutMs + FINALIZATION_GRACE_MS 判过期；条件结算成功后才改 Task、释放锁 | 拆分健康评估与遗留状态对账，补齐归属与终止确认 |
| `api/routes.ts` 的 `buildCompanyState` | GET 触发判失败并释放锁 | 移除执行判死副作用 |
| `db/repositories.ts` 的 `updateAgentRunStatus` | 已支持可选 expectedStatus，返回是否更新成功；scheduler 的 claimRun 与过期回收已使用 running 条件 | 审计所有终结入口，补齐当前执行归属、终态保护与整体事务 |
| `runtime/taskTransition.ts` | Task 状态唯一写入口，带 Hold 规则 | 在此落实前置条件，保持唯一入口 |
| `runtime/killSwitch.ts` | 由 running run 找任务，清全部锁 | 修复孤立任务；接通实际取消；限制清理范围 |

已修复的旧竞态：原基线中，正式执行接近预算成功后进入独立 120s 语法修复，GET 可按原 deadline 判失败，迟到收尾再写 complete。PR #12 增加双向条件结算，并把过期回收宽限设为 `ARTIFACT_SYNTAX_REPAIR_TIMEOUT_MS + 30_000`，当前为 150s。[scheduler.test.ts](../apps/server/src/runtime/scheduler.test.ts) 的 `a settlement racing a timeout declaration` 已覆盖宽限内成功、成功后回收不干预、回收获胜后不提交 Business Artifact/完成事件三个场景。实施时复用这些回归，不再把旧结果当成当前代码必然可复现的故障。

现有保护尚未覆盖整段收尾：[scheduler.ts](../apps/server/src/runtime/scheduler.ts) 中 `appendProof`、`createHandoffPackage`、部分 `updateTaskArtifactWorkspacePath` 仍在最终 `claimRun` 之前；认领失败后仍进入清理和释放锁的 finally。run 结果、Business Artifact 与 `finalizeDelivery` 的业务写入也未组成一个整体事务。现有测试没有证明败方对 proof、工作区、全部事件及锁完全无副作用；这些是静态代码依据，需在 P0 补充受控验证。ADR 0034 明确保留了结算中断与孤立锁的限制，P2 不能因此标为完成。

150s 宽限只延后过期回收，不延长 CLI 自身的执行计时器，也不是健康续时。当前仍缺少运行中心跳、独立健康监督、生命周期预算账本及 outbox 恢复消费闭环；已有任务事件记录和运行时通知不等于可靠恢复投递。

拿锁与建 run 之间既可能留下 queued+锁，也可能留下 running+锁+无 run；“两处相隔 132 行”不能代表整个窗口状态。两个超时截止时间也并不严格一致，分别从 run 记录和子进程计时起算。

## 3. 必须保持的系统不变量

1. 同一个 Task 最多只有一个有权提交的当前 Agent Run；同一可写工作区最多一个执行者，包括不同 Task 共用产物工作区的情况。
2. 任一心跳、阶段切换、续时、取消、提交都携带 `runId + ownerEpoch`；旧 epoch 不能影响新执行。
3. 终态 run 不接受迟到心跳或成功结果。已撤销执行的结果可留作诊断，但不进入当前有效产物。
4. 执行失去归属不等于操作系统进程已停止。确认终止或可靠隔离之前，不允许新执行写同一目录。
5. 状态检查与状态写入原子完成。仅在 JavaScript 中先查一次状态，随后无条件写入，不算并发保护。
6. Task 状态仍由 `applyTaskTransition` 唯一写入。前置条件失败时，不改变 Hold、摘要、产物指针、依赖、完成事件或预算。
7. 运行终结、业务状态变化、对应待发送事件在一个短数据库事务内提交。事务内不能 await 模型、网络、进程退出或文件扫描。
8. GET 请求不判定执行死亡、不终止进程、不释放执行锁。现有非执行类 Hold 修复、一次性迁移另行保留，不在此扩大到所有读时修复。
9. stdout 活动不等于进展；心跳正常不等于模型正常；数据缺失表示未知，不自动等于无活动。
10. 故障重试消耗有上限；重试、续做、进程重启和换 runId 都不能重置 Task 的累计自动预算。
11. 明确崩溃不等待软预算到期；预算耗尽不自动写成 needs_replan。
12. 同一失败事件被重复投递只能导致一次恢复决策和最多一个替代执行。

## 4. 模块职责与进程结构

采用少量职责明确的模块。以下名字是建议，Claude 可按当前结构调整文件组织，但不能分散不变量。

| 模块 | 职责 | 不负责 |
| --- | --- | --- |
| Execution Lifecycle | 原子认领、归属、阶段、预算、终结、事件 | 解析厂商 CLI 文本 |
| CLI Adapter | 启动/取消进程，解析可用事件，报告退出与输出 | 直接写任务数据库、决定重试 |
| Health Policy | 输入观测快照与时间，返回健康评估及建议动作 | 直接 kill、发通知、写 Task |
| Supervisor | 定时扫描、验证执行器存活、申请停止、遗留状态对账 | 重新推断业务产物正确性 |
| Recovery Coordinator | 按失败原因、预算、已有成果生成一次恢复决策 | 绕过 Hold、权限或执行归属 |
| Event Dispatcher | 持久事件投递、重试、消费者游标与去重 | 仅靠内存回调保证送达 |

### 4.1 两层监控，完整交付必须覆盖进程外层

- Worker 内层：独立于 scheduler 的 interval，处理阶段活动、软预算和在运行进程的取消。自身 scan 使用防重入守卫，不能复用 scheduler.running。
- 进程外层：本地 `start` 最终采用轻量 Supervisor 父进程 + Worker 子进程，Supervisor 不执行模型或业务任务；Worker 承载现有调度/API。Supervisor 监听 Worker exit，并通过单独数据库连接检查 owner 心跳、投递持久事件。
- 若当前 CLI 生命周期使父子改造明显不适合，可改为独立 `watch` 命令配系统进程管理器；必须交付实际启动、停止、重启流程与故障测试，不能只写“未来可加外部监控”。在实现前记录选择理由。
- Worker 崩溃时 Supervisor 仍存活；整个 Supervisor/机器退出需要系统进程管理器或用户重启。界面/文档明确覆盖范围，不能宣称停电后仍能实时通知。
- 各 Supervisor 使用独立身份。单数据库部署默认一个活动监督者；第二个监督者拒绝启动或通过持久 claim 选主。多扫描者竞争必须用数据库条件更新，不能依赖内存 Map。
- 外层监控不得通过 Worker 的 GET 健康接口作为唯一事实来源，因为 Worker 可能卡住。API 不可用时，外层仍应能记录/投递故障。

### 4.2 建议接口形状

```ts
// 示意契约，不要求照抄类型命名。
type ExecutionIdentity = { runId: string; ownerEpoch: number };
type RunControls = {
  signal: AbortSignal;
  onEvent: (event: AdapterExecutionEvent) => void;
};

// 运行器接收事件，不把 repositories 暴露给 adapter。
adapter.run(request, controls): Promise<AgentRunResult>;

// Lifecycle 封装内部事务、身份校验、Hold、账本与 outbox。
lifecycle.claim(...): ClaimResult;
lifecycle.observe(identity, ...): ObserveResult;
lifecycle.requestStop(identity, reason): StopResult;
lifecycle.finalize(identity, proposedOutcome): FinalizeResult;

// 纯函数，注入时钟与配置，便于确定性测试。
evaluateExecution(snapshot, policy, time): HealthDecision;
```

所有调用 adapter 的路径都要清点：普通 Task、简报、语法修复、公司创建、最终报告、可选 Session。共用取消和事件能力；Task 外作业若不纳入本轮完整监控，也必须声明作业类型和覆盖范围，不能冒充 Task run 或因接口修改失效。

## 5. 数据契约、状态机与迁移

### 5.1 数据模型

按现有 SQLite schema/migration 方式增加，优先保持业务 Task 状态集合稳定。执行细节放 Agent Run/配套表；不要用一个 tasks.status 同时表达业务流程和进程健康。

| 数据 | 必须包含的语义 |
| --- | --- |
| 当前执行归属 | taskId、currentRunId、单调 ownerEpoch、ownerId；原子切换 |
| Worker 身份 | ownerId 使用启动 UUID，pid、进程启动标识、机器身份、lastHeartbeatAt；PID 不足以唯一识别进程 |
| Agent Run | 原字段、phase、phaseStartedAt、lastHeartbeatAt、lastActivityAt、lastProgressAt（可空）、health、policyVersion、budgetSnapshot、stopReason、terminationConfirmedAt |
| 执行认领/锁 | taskId、runId、ownerEpoch、ownerId、acquiredAt、leaseExpiresAt；共享可写目录另有 workspace claim |
| 进程身份 | 当前阶段的 invocationId、pid/进程组、启动标识、宿主；同一个 run 的简报/执行/修复是不同 invocation |
| 活动记录 | runId、invocationId、递增 seq、observedAt、phase、kind、channel、bytesDelta；不要求存储原始文本 |
| 统计 | phase 内首个活动延迟、最大活动间隔、最后静默长度、stdout/stderr 字节量、有效结构化事件数、结束原因 |
| Task 自动预算账本 | 当前授权累计上限、实际消耗、已预留余额、重试次数/现有 reset marker、显式追加预算历史 |
| outbox 与恢复决策 | eventId、版本、原因、payload、投递/claim 状态、nextAttemptAt；sourceEventId 唯一的恢复记录 |

`lastHeartbeatAt` 仅代表 owner 运行器，不由 stdout 代替。活动可以来自 stdout、stderr、结构化模型/工具事件；`lastProgressAt` 只记录可确认检查点或步骤完成。未知 token/费用保持 null，不能当 0。

高频文本 delta 在内存聚合，建议最多每 5–15s 落一次活动摘要；阶段切换/退出/停止时立即 flush。保存聚合窗口内最大间隔，避免节流把静默统计失真。日志容量、保留期和清理必须有上限；元数据默认不复制提示词、凭证、完整输出。

续租仅由当前 owner 使用匹配的 runId/epoch 完成，终态不续租；同一 run 的所有阶段延续同一执行归属。停止期间可汇报终止进度，但不能恢复正常提交权。心跳携带递增序号，租约截止时间由监督者生成，历史/重复请求不能重新延长失效租约。

### 5.2 Run 生命周期与健康状态正交

生命周期建议：`starting → running → finalizing → complete`；任一活动阶段可转 `stopping → failed/cancelled`。若必须兼容现有 status，增加 lifecycle 字段而不是给原枚举偷偷改含义。

健康建议：`unknown / responsive / suspect / lost`。suspect 不终结 run，不释放锁。lost 表示失去联络，不表示已物理终止。termination 未确认的 run 保留阻止重入的 claim，直到隔离或人工处置完成。

阶段：`preparing_brief / executing / repairing_artifact / finalizing`。`starting` 单独有启动上限。预算由运行器管理，模型不能自己延长 deadline 或续租。

失败原因至少区分：process_exit、worker_lost、model_idle_timeout（仅有可信流契约时）、phase_budget_exhausted、run_budget_exhausted、task_budget_exhausted、termination_unconfirmed、launch_failed。保留现有 quota、invalid output、proof 等归因。枚举名称可适配现有项目，语义不能混合。

### 5.3 原子认领与提交

1. 获取审批/依赖/adapter 可用性等前置事实；启动前事务内再次校验相关版本和资格。
2. 同一短事务建立 run、当前归属、Task/工作区 claim、预算预留和 running 转换。竞争失败整笔回滚，不能残留 Hold 修改或预算扣款。
3. 提交后启动子进程。启动失败通过同一个 finalize 路径终结 starting run。
4. 进程启动与数据库写入无法完全原子：必须有启动握手、invocation 标识和进程组。Worker 在 spawn 后记录 PID 前死亡，Supervisor 仍能按预先建立的 containment 找到并停止后代；证明不了就隔离，不能直接重跑。
5. 异步产物处理前检查身份；处理后最终事务再次校验 runId/epoch/生命周期。前检查不能替代后检查。
6. 文件解析/验证在事务外完成，只准备候选结果；产物记录、proof、当前产物指针、Task/Hold、依赖影响、完成事件和 outbox 在允许提交的事务内一起写入。
7. 过期回调只能追加单独诊断记录。共享工作区写入无法靠 SQL fencing 撤销，仍依赖第 7 节的停止/隔离。

现有 repositories.transaction 使用同步 SAVEPOINT。沿用其嵌套能力并验证多连接竞争语义；禁止把 async 回调传进去，禁止在事务跨 await 时认为锁仍受保护。

### 5.4 迁移与遗留对账

- 新字段可空或使用明确 legacy 标记；历史运行不伪造最后活动时间。
- 升级先停止旧 Worker 的新派发，处理/确认旧进程，随后迁移并启动新 Worker；旧版写入器不能与新版监控混跑。
- 对账同时枚举 Task、run、claim、owner：锁无 run、running Task 无 run、run 无当前 Task 归属、终态残留锁、过期 starting 都要覆盖。
- 没有可靠存活证据时标记 legacy_unknown 并进入确认流程，不能仅因 null 心跳批量杀进程。
- 对账可在启动和独立监督循环运行；不依赖打开页面。
- 数据库迁移先在副本验证。旧版本无法理解新状态时，回滚只能在执行排空后恢复兼容版本，不能让旧代码接管新版活动记录。

## 6. 健康判断与执行预算

### 6.1 信号判断规则

| 条件 | 判断 | 允许动作 |
| --- | --- | --- |
| 子进程 error/非零退出 | 明确执行失败（进一步分类 quota 等） | 立即 finalize/记录，不等软预算 |
| 退出 0 | 进程正常结束 | 进入验证/收尾，不等于 Task complete |
| 心跳新鲜且有活动 | responsive | 在预算内继续 |
| 心跳新鲜、CLI 长静默 | unknown 或 suspect | 记录/探测，不仅凭静默自动杀 |
| 结构化模型流超出已定义 idle 契约 | 特定调用异常 | 可取消该调用；本地 CLI 不假装知道内部流状态 |
| 心跳超出租约窗口 | lost | 验证 owner、请求停止/隔离，不能直接抢工作区 |
| 输出大量重复内容 | 有活动、进展未知 | 保留硬预算；可生成排查证据，不让日志无限续命 |
| 达到硬预算 | 预算停止 | 保存现场、停止、发预算事件，不写“卡死已确认” |

仅配置了 stdout 的 adapter 不得宣称支持可靠 model_idle_timeout。可逐个支持结构化事件，但先验证本机 CLI --help/版本，维护现有启动隔离、JSON 输出解析及额度归因；不能为了观测放开权限或破坏最终输出。

### 6.2 软预算、硬预算、累计预算

- 原 short/medium/long 在新策略下作为软预算检查点，保留能力下限。软预算届满不重启进程。
- 首次软预算到达：记录一次 budget_review。心跳正常、没有确认错误时允许同一 run 进入已授权的后续时间窗口；活动未知时也可在硬预算内给有限观察时间，不逼迫 CLI 为续命打印日志。
- 续时只是同一 run 的下一检查时间，不能扩大原硬预算、重置 startedAt 或增加一次恢复尝试。
- Run 硬预算覆盖从认领起至最终提交的整个生命周期；brief/repair/finalizing 各自还有阶段上限，实际 deadline 取阶段、run、Task 授权余额三者最早值。
- 正式执行开始后使用本阶段开始时间计算软检查点；简报耗时独立展示，同时计入总消耗。ADR 0032 的“简报失败不升档正式任务预算”必须保留。
- 跨重试累计自动执行时间按单调时间区间计账，包含 starting、brief、执行、repair、finalizing；排队、等待人工不计运行时间。进程失联消耗不可低估，保守结算至确认停止或预留上限并标记估算，后续订正有审计。
- 在 run 创建时预留本次可用余额；其他消费者不能重复花费同一预算。只追加使用记录，不用重试改写历史。
- 沿用 ADR 0015 的恢复上限及合法 reset 规则；quota 不算任务失败尝试，但实际消耗仍记账，基础设施重试另有有限次数/退避。
- CEO replan 或新上游产物允许重置既有失败计数，不自动获得无限累计资源。额外预算是显式授权记录。
- 用户取消、额度、权限与硬预算优先于自动续时；收到终止请求后不能被新的 stdout/心跳撤销。

### 6.3 初始配置与启用条件

以下是候选配置，供测试和 opt-in 灰度使用，不是由现有冒烟样本证明的生产阈值：heartbeat 20s、scan 5s、lease 90s、活动持久化最长 15s、SIGTERM 宽限 10s、SIGKILL 后确认窗口 5s。所有时间注入配置并在 run 中保存 policyVersion。

启动时验证配置：数值有限且非负、scan/heartbeat 显著短于 lease、硬预算不小于预期软检查点、各阶段取剩余额度后仍可启动。无剩余额度时不 spawn；非法配置拒绝启动并指出字段。兼容现有 AUTO_CROP_AGENT_TIMEOUT_MS / AUTO_CROP_FORCE_AGENT_TIMEOUT_MS：legacy 模式保留旧语义，新模式明确映射到哪一种预算并记录最终配置；不允许 force 值意外关闭累计硬上限。

预算候选：保留现有 2/5/10 分钟为软检查点；本次 run 生命周期硬上限 20 分钟；一个 Task 自动执行累计 45 分钟；brief 60s、repair 120s、finalizing 60s，均再受剩余总预算约束。以上只是显式启用新策略时的初值，允许依据实测收紧/放宽。636s 样本仅说明一次 600s 上限不够，不能据此承诺任务耗时分布。

observe 模式保持旧预算策略，修复一致性问题可先上线；新策略完整通过模拟故障、预算测试后才能 opt-in。正式默认启用前提交观测报告。不能因为尚未获得真实运行授权而偷偷付费跑大量任务，也不能把未做实测的阈值写成已验证。

预算迁移以 ADR 0034 为旧模式基线：在 P2 移除旧判死路径前，legacy/observe 保留现有 CLI 超时与过期回收的 150s 收尾宽限；移除后由独立生命周期对账接管，保持旧预算模式有明确、有限的收尾窗口。P4 新策略把 repair/finalizing 纳入阶段上限和 run 硬预算，不在这些上限之外再叠加 `FINALIZATION_GRACE_MS`。按 run 的策略版本选择唯一判定路径，并更新 ADR 0034 的适用范围。

### 6.4 时间源

同进程时长使用单调时钟，持久化审计使用 UTC。租约由统一数据库/监督者时间计算，报告内容不能自行指定未来租约。检测显著时钟跳变、系统休眠唤醒；唤醒后先探测 owner 并留恢复宽限，不能把整机睡眠当作多个任务同时死锁。软预算、硬预算、lease 使用各自明确定义的时间语义，测试覆盖跳时和休眠。

本地休眠期间不承诺检测/通知 SLA；唤醒时原墙钟授权期限已过可以按“预算到期”受控停止，但不能报告“休眠证明任务死锁”。时钟异常无法安全重建租约/剩余预算时，停止新派发并进入对账，避免通过时钟倒退获得额外自动预算。

## 7. 停止、进程外监督与恢复安全

取消是一项可重复调用的操作，返回已停止、正在停止、无法确认三种明确结果。

1. 原子 claim 停止权，写 stopping/原因、收回正常提交权限。仍保留阻止共享目录重入的 claim。
2. Adapter 发协作取消或 SIGTERM，等待退出；宽限到期升级到进程树/进程组终止。
3. pid 身份校验、退出结果、信号、时间都记录；PID 被复用时不能误杀新进程。
4. 超出最终确认窗口标 termination_unconfirmed，发排查事件并保留隔离。不能假定 kill 返回 true 就已退出。
5. 确认无旧写入者后 flush 观测、保护部分产物、finalize、释放本人 claim，才允许恢复进入队列。

Unix 用独立进程组和启动身份验证；子进程主动脱离进程组等情况属于已知 containment 限制，能力不足时禁止声称终止树已确认。Windows 若当前支持，使用等价的 Job Object/已验证进程树控制；未实现的平台显式降级为观测+人工确认，禁止悄悄自动接管。

外层监督者直接观察 Worker exit 时可以立即开始对账。Worker 活着但心跳失效，外层先确认机器睡眠/数据库故障等公共原因；必要时停止该 Worker 的整个执行容器，再对其中 run 逐一结算，不仅杀一个随意记录的 PID。

数据库不可写时：Worker 停止新派发；重试心跳有界；在自身无法确认归属的宽限到期后主动停止执行。Supervisor 不把大量心跳失败当成每个任务逻辑失败，不启动恢复风暴。数据库恢复后统一对账。数据库永久不可用时只能通过 stderr/系统监督渠道报告，持久通知可靠性以存储恢复为前提。

Emergency Stop 通过真实控制柄/Supervisor 终止在途 invocation，覆盖孤立 running Task；按目标公司清理归属，不能误释放其他公司的运行锁。普通暂停只停止新派发，现有执行是继续还是取消由现有产品语义明确决定，监控继续运行。

## 8. 可靠事件与自动恢复

### 8.1 事件与通知

最小持久事件：execution_suspected、execution_responsive（从疑似恢复）、execution_stop_requested、execution_failed、execution_budget_exhausted、execution_completed、recovery_scheduled、recovery_blocked。名字按现有事件规范落地，诊断事件不能冒充业务 TaskCompletionEvent。

事件 payload 至少含版本、eventId、companyId、taskId、runId、ownerEpoch、phase、reason、observedAt、最后心跳/活动、预算实耗与上限、退出证据、terminationConfirmed、checkpoint/log 引用。外发只包含脱敏摘要；完整日志需经有权限的读取接口。

采用同库 outbox，状态变更与事件同事务。Dispatcher 持久 claim、重试退避、记录下次时间；崩溃后的未完成 claim 可重领。按至少一次投递设计，消费者 eventId 幂等；不宣称跨外部系统 exactly-once。

第一交付必须有实际工作的本地 Recovery Coordinator 消费者及可查询的事件/投递状态，不能只添加一张表。另提供可配置 webhook 适配器供相关程序使用：签名、超时、有限重试/死信可重放、接收端 eventId 去重。仅对操作员明确配置的地址发送，不内置通知第三方联系人。高频 heartbeat 不逐条推送给用户。

outbox 可由进程外 Supervisor 继续投递，避免 Worker 崩溃后没有人通知。失联检测延迟与外部接收端恢复延迟分别展示；网络失败期间保证最终重试，不保证即时送达。

### 8.2 恢复决策表

| 原因 | 默认动作 | 条件 |
| --- | --- | --- |
| responsive，软预算到点 | 同 run 继续 | 在授权硬预算内 |
| CLI 静默且心跳正常 | 疑似/继续观察 | 仅靠静默不自动重跑 |
| 可确认瞬时连接故障 | 有限退避恢复 | 终止确认、剩余预算、权限与幂等可满足 |
| process_exit / worker_lost | 检查部分产物，符合条件才恢复 | owner 已失效且旧进程确已停止 |
| quota exhausted | Hold，已知可靠 reset 时刻才可定时再检查 | 不推测 reset 时间，不消耗任务失败额度，不循环探测 |
| 权限或等待人工 | 对应 Hold | 条件变化后恢复，不能加权限绕过 |
| run 硬预算耗尽 | 停止并提出预算/续做选择 | 默认不通过新 run 绕开本次停止原因 |
| Task 累计预算耗尽 | budget Hold | 需要显式增额、调整任务或取消 |
| 重复相同失败、达到恢复上限 | 排查/已有 retry_exhausted 流程 | 不无限重排队 |
| termination_unconfirmed | 隔离+排查 | 不自动写同一目录 |
| 产物已完整且可验证 | 走现有验证/提交协议 | 不能只看文件存在就当成功 |

Recovery Coordinator 以 sourceEventId 唯一地写决策与待恢复条目，事务内校验 Task 最新归属、Hold、依赖、预算、取消状态、权限。推送 scheduler wake 是加速机制；持久待恢复队列才是真相，wake 丢失后周期扫描补上。

加入预算/终止待确认等 Hold 时，同一变更交付 core exhaustive 映射、后端 guard、真实可执行路由、dashboard 控件、测试。预算停止默认使用 failed/blocked 的具名 Hold，不直接映射 needs_replan；只有证据与明确决策支持时才进入重新规划。

### 8.3 续做契约

健康续时保留原进程/上下文，不创建新 run。失败后续做一定是新 run，记录 resumeFromRunId；不是宣称恢复模型内部思考。

停止确认后生成恢复清单：原任务与交付契约、已完成且验证过的步骤、未验证部分、输入/上游版本、部分文件与哈希、最近错误、已执行外部动作、建议下一步。模型自述的“完成”需标记为自述。

新 run 使用独立执行目录或受控继承的工作区，候选文件经验证后发布；支持依赖共享工作区时显式获取 workspace claim。上游版本变化时重新评估检查点，不把旧输入产物当成新任务成果。

仅对已知可重复的文件/只读操作默认自动恢复。外部写入可能已经成功但响应丢失时，使用目标系统幂等键或查询确认；没有办法确认则进入外部结果未知 Hold，不自动再次发送/部署/支付。SQL epoch 不能撤销外部副作用。

现有 Artifact Workspace 恢复与 follow-up 逻辑优先复用，保持 lineage；不要同时创建“原任务重试”和“续做子任务”两条竞争路径。

## 9. API、界面与可观测性

Task/run 页面显示业务状态、当前阶段、执行持续时间、最近心跳/活动、健康评估、预算情况、停止/恢复原因。使用项目 Interface Locale；stdout 原文仍按日志展示。

疑似停滞显示“最近 X 时间无活动，运行器仍响应”，而不是“已死”。失联显示“最后联系于…，正在确认停止”；预算耗尽显示实际消耗和可采取动作。

客户端仅呈现服务端计算的 Holds/affordances，不复制恢复资格规则。SSE/WS 中断后通过 GET 重同步，GET 不执行健康判定副作用。

运维至少能查询：活动覆盖率、按 adapter/版本/阶段的静默分布、正常完成耗时分布、预算误停案例、心跳丢失、停止确认时长、拒绝迟到提交次数、恢复成功率、outbox 延迟/重试/死信。部分样本被预算截断时标记 censored，不能把它们当成真实完成时间。

## 10. 实施阶段与完成条件

### P0：现有回归与剩余缺口复现 —— 已完成（2026-09-21）

交付物：[execution-health-p0-baseline.md](execution-health-p0-baseline.md)。新增 8 条确定性测试，`pnpm test` 55 文件 / 781 项通过，typecheck 与 lint 通过；未运行真实 Agent，未对运行中的 Worker 发信号。

- [x] 确认本文代码依据，审计全部 Agent 调用、状态写入、锁释放和 GET 对账入口。7 个 Agent 调用点中只有 Task 执行有 run 记录，且简报/执行/修复共用同一 `agentRunId`；4 个 run 终结入口中 2 个无条件写入；`buildCompanyState` 被 4 条路由到达，含纯读的 `GET /state`。
- [x] 复用 ADR 0034 的三条竞态回归，核对宽限内收尾成功与宽限外回收获胜；双方竞争只产生一个有效结果的断言保留且持续通过。
- [x] 补测认领失败后的副作用（基线 F1、F2、F4）：败方仍写 proof、handoff 包与产物指针；败方的 `finally` 会释放接任分派的锁；重试上限路径完全不认领，还能让同一 Task 同时挂两个 open Hold。
- [x] 注入结算持久化点的中断（基线 F3）：`claimRun` 之后抛异常留下 run=complete、Task=running、无 Hold、无锁，且因对账只读 running run 而永久不可达。
- [x] 构造三种遗留组合（基线 F5）：queued+锁无 run、running+锁无 run、终态 run+残留锁，均对账不可见，锁永久残留。
- [x] 未调用真实付费模型，未通过真实 SIGKILL 破坏用户当前 Worker。
- [x] 完成条件：基线证据可重复，已按"已实现 / 本文提出的变更 / 未验证假设"三分类记录。

P0 额外确认、需在后续阶段处理的事实：取消全链路是空实现（`routes.ts` 的 `cancelActiveRun` 接成 no-op，`cliAgent` 发一次 SIGTERM 即返回），且 `killSwitch` 的 `releaseAllTaskLocks()` 会清掉其他公司的锁（基线 F6）。P2 修复 F1–F5 时，基线中记录当前行为的断言必须被改写，改写本身即修复到位的证明。

### P1：只采集，不驱动停止 —— 已完成（2026-09-21）

交付物：`runtime/executionObservation.ts`（`RunObserver` + 纯函数 `summarizeRunActivity`）、`run_invocations` / `run_activity` 两张表、`agent_runs` 的观测列。`pnpm test` 57 文件 / 799 项通过，typecheck 与 lint 通过。未运行真实 Agent。

- [x] 版本化观测：`OBSERVATION_POLICY_VERSION` 随 run 落库，旧 run 按记录时的规则读回。
- [x] 阶段与调用标识：`preparing_brief / executing / repairing_artifact / finalizing` 各自一条 invocation，带 `startedAt / endedAt / endReason`；同一 run 的简报、执行、修复是三次 invocation。
- [x] 活动摘要：内存聚合、默认 10s 落一次，仅记录 channel 与字节数，**不复制原文**。摘要两端都是真实到达时间（`windowStartedAt` / `observedAt`），并保存窗口内最大间隔——节流不能让静默看起来更短。窗口间的静默按"上个窗口末字节 → 下个窗口首字节"计算。
- [x] adapter 接口兼容：`AgentRunRequest.observe` 为可选，不实现的 adapter 照常工作，被观测为 unknown 而非 silent。`cliAgent` 在 stdout/stderr chunk 处上报字节数。
- [x] 全程 owner 心跳：阶段边界确定性发一次（测试可断言），加上 CLI 配置的 20s 定时器覆盖长阶段。**心跳只由运行时时钟驱动，永不由 stdout 刷新。**
- [x] 观测写入失败有界降级：`maxFailures` 次后停止重试，失败计入并以 task_warning 上报；实测数据库写失败**不改变 run 状态**。
- [x] 完成条件：mock 场景四阶段记录完整（`scheduler.test.ts` › `records all four phases in order`）；静默统计可导出（`exports silence statistics for a run that said nothing for most of its life`）；**没有新增自动判死行为**——`executionObservation.test.ts` › `cannot end a run, move a task, or touch a lock` 扫描模块源码，禁止出现任何终结写入者；原有 799 项回归（含额度、结构化输出、授权隔离）全部通过。

决策记录见 [ADR 0036](adr/0036-observation-before-judgement.md)。

**实施中发现并修正的两个缺陷**（都是自己新写的代码，被测试断言揪出来的，未流出）：

1. **聚合把静默统计算错了。** 活动摘要原本只记一个时间戳，而那是 **flush 时刻**不是字节到达时刻。一个 5 分钟里只输出 12 字节的 run，首次活动延迟被算成 300s 而非真实的 240s —— 节流扭曲了它本该服务的统计，正是方案 §5.1 明令禁止的。改为摘要两端（`windowStartedAt` / `observedAt`）都记真实到达时间，flush 时刻与任何统计无关。
2. **窗口之间的静默口径错了。** 原本按"上个窗口末字节 → 下个窗口末字节"计算，把下个窗口内部的活动时长也算进了静默。应为"上个窗口末字节 → 下个窗口**首字节**"。同时处理了同一窗口两个 channel 产生重叠区间的情况，不能算出负的静默。

**本阶段明确未做的事**（不是遗漏，是划出的边界）：

| 未做 | 原因 | 去向 |
| --- | --- | --- |
| 结构化模型/工具事件 | 只接了 stdout/stderr，没有可信的流契约 | 因此**不宣称**支持可靠 `model_idle_timeout`（方案 §6.1 要求）；按 adapter 逐个验证后再说 |
| `lastProgressAt` | 需要"可确认检查点"的语义，当前无可信来源；用输出冒充进展正是要避免的 | P4 与验证契约一并设计 |
| `run_activity` 的保留期与清理上限 | 方案 §5.1 明确要求，本轮未做 | **本地库会无界增长**，P3 前必须补 |
| 独立监督循环、进程外 Supervisor | 属 P3 | P3 |
| 取消能力经 adapter 下达 | `observe` 只出不进；取消仍是空实现（基线 F6） | P2b |
| 阈值实测 | 10s 聚合窗口、20s 心跳是"便宜且够用"的初值，**无任何实测支撑** | P5 采样后收紧；`policyVersion` 已落库，改动不会悄悄改写旧 run 的含义 |

### P2a：结算一致性 —— 已完成（2026-09-21）

交付物：[ADR 0035](adr/0035-a-settlement-is-one-transaction.md)。`pnpm test` 56 文件 / 786 项通过，typecheck 与 lint 通过。未运行真实 Agent。

- [x] 将 proof、产物指针及全部业务写入纳入获准提交的事务：`settleRun` 开事务、先认领、再提交，6 个结算分支全部改道（修 F1、F3）。
- [x] 补齐所有终结入口的保护：重试上限不再自成写入者，成为结算携带的 outcome（修 F4）。`updateAgentRunStatus` 的无条件调用在调度路径中已清零。
- [x] 重构产物捕获先准备后提交：handoff 包改为事务提交后、仅胜方发布——文件无法随事务回滚。
- [x] 锁记录所属 run（`task_locks.run_id`），释放须指名同一个 run（修 F2）。删除 `runtime/locks.ts` 这套已经分叉的并行锁实现。
- [x] 多连接 SQLite 竞争测试（`db/multiConnection.test.ts`，4 项）：证实条件更新跨连接原子、事务跨连接隔离；**证伪**了"事务内先读后写安全"这一假设——先读会在对方提交后升级失败，且 `busy_timeout` 无效。结算因此必须以认领为第一条语句，并由扫描源码的守护测试禁止事务内出现 await 与文件 I/O。
- [x] 完成条件（本段）：现有三条竞态回归持续通过；P0 的败方副作用与结算中断用例全部改写为断言新行为并通过。

### P2b：取消闭环与读路径去副作用 —— 大部分完成（2026-09-21）

`pnpm test` 57 文件 / 808 项通过，typecheck 与 lint 通过。未运行真实 Agent（但**运行了真实子进程**：停止相关测试 spawn node 并发信号）。

- [x] **原子执行认领**：run、`ownerEpoch` 与锁的绑定在同一事务内建立。锁另获**租约**（`lease_expires_at`，默认 90s），由持有者心跳续租——死掉的 dispatch 留下的锁会过期并被下一个 dispatch 接管，不需要先证明那个进程已死。`tasks.execution_epoch` 单调递增，读写同一条语句，两个认领者拿不到同一个数。
- [x] **孤儿 Task 有真实恢复出口**（基线 F5）：`reconcileStaleRunningTasks` 新增一轮扫描，处理"`running` 但没有 run"的任务——证据是锁的租约已过期。新增失败原因 `worker_lost`（语义不与 `timeout`、`agent_failed` 混用），映射到 `runtime_interrupted` Hold。**没有锁的 `running` 任务不予收割**：锁在最先获取且全程持有，所以没有锁意味着它从未被本运行时派发过，凭这个猜测去收割会让一个错误假设批量失败任务。
- [x] **移除 GET 判死写路径**（不变量 8）：`buildCompanyState` 不再调用 `reconcileStaleRunningTasks`。判定执行死亡归调度 tick 和显式 `recoverTask`；读只报告。非执行类修复（Hold 对账、一次性迁移）保留。
- [x] **真实取消**（基线 F6）：`cliAgent` 以 `detached` 启动获得独立进程组；停止先 SIGTERM 整组，宽限后升级 SIGKILL，**等到进程真的退出才结算**，并在确认窗口内仍未退出时报 `terminationConfirmed: false`。发信号前校验子进程未退出，避免 pid 复用误杀。新增 `AgentRunRequest.signal`（可选，不实现的 adapter 照常工作）。
- [x] **Emergency Stop 接上真实控制柄**：`ExecutionRegistry` 登记在途执行，停止请求经它抵达进程而非只改行；无法触及的（其他 Worker 拥有的）在结果里如实列为 `unreachableTasks`，不冒充已停止。清锁**只清本公司**的任务——原先 `releaseAllTaskLocks()` 会把其他公司正在跑的锁一起清掉。
- [x] 新增失败原因 `cancelled`，**不映射任何 Hold**：主动停掉的任务不需要被"救"，由停它的人决定下一步。
- [x] 有界 `busy_timeout = 5s`（原为 0，第二连接写入立即失败）。
- [x] 双 Worker / 双连接竞争测试通过；真实进程测试覆盖"等待退出""忽略 SIGTERM 被升级""**进程组把孙进程一并带走**"——最后一条我关掉进程组验证过会失败，不是空跑。

**未完成，留给 P2c：**

| 未做 | 现状与风险 |
| --- | --- |
| `workspace claim`（同一可写目录互斥） | 锁仍只按 taskId。**跨 Task 共用产物工作区时没有互斥**，方案不变量 1 的后半句尚未成立 |
| `termination_unconfirmed` 的 Hold 与隔离出口 | `terminationConfirmed: false` 已被 adapter 如实上报并写进 run 的 stderr，但**没有消费者**：不会隔离工作区，也没有排查用的 Hold。按 ADR 0020，新 Hold 需要 core 穷举映射 + 后端 guard + 真实路由 + dashboard 控件 + 测试，半做比不做更糟，故整体留给 P2c |
| Windows 终止 | `canGroupSignal` 在 win32 下为 false，只能终止持有的那个进程。**已显式降级，不宣称终止了进程树** |
| 跨进程停止 | `ExecutionRegistry` 是进程内的。别的 Worker 拥有的 run 停不了，如实报为 unreachable；真正解决需要 P3 的进程外 Supervisor |
| 迁移现有 active/legacy 数据的协议 | 新列均可空，旧行读作"租约已过期"，但没有写明的升级排空流程 |

### P3：独立监督与可靠事件

- 落地进程外 Supervisor、Worker 生命周期、owner 失联扫描；启动前完成一次对账。
- outbox、Dispatcher、实际恢复消费者、webhook/诊断接口，默认只报告恢复建议。
- 完成条件：测试 Worker 被杀后 Supervisor 仍运行并生成一次故障事件；重复事件不重复恢复；API 挂掉不阻止事件投递；Supervisor 自身重启能接着排空队列。

### P4：健康与预算新策略

- 启用软检查点、生命周期硬预算、Task 累计账本、分阶段限额；同一 run 续时。
- 按第 6.3 节迁移 legacy/observe 模式及收尾宽限；停止所有隐式“超时升档立刻重跑”入口在新模式的作用，避免两套恢复循环竞争或宽限重复叠加。
- 预算/权限/额度/Hold 的出口连通，不把 long 超时自动解释为 replan。
- 完成条件：持续进展超过旧上限仍是同 run；硬预算不可被输出、重试或重启绕开；brief/repair/finalize 归因正确。

### P5：有限自动恢复与真实验证

- 依据恢复决策表启用安全子集；产物续做清单、来源关联、外部副作用不确定处理。
- 在隔离临时项目使用有授权的真实 CLI 验证；保存脱敏摘要到仓库文档，原始日志路径和保留条件明确。
- 每种要正式支持的 adapter 至少覆盖简报/正式/修复或等价阶段，包含正常静默、失败、超过旧预算成功案例。建议每种 adapter 先采 10 次代表性执行用于初步观察；这不是统计充分性证明，稀少样本不声称 p99。
- 无法获得真实模型调用授权或环境时，完成所有模拟测试并标记实测门槛未达；不能把全功能默认启用。
- 完成条件：交付观测报告、配置理由、已知盲区、回滚步骤；自动恢复不重叠执行、不重置累计预算。

## 11. 边界与验收矩阵

每行都要有自动化测试或注明必须由真实平台验证的手工证据。测试优先跨公开模块 interface，不逐行镜像实现。

| 场景 | 预期结果 |
| --- | --- |
| 连续输出超过旧软预算 | 同 run 继续，最多一次该检查点事件，不新建进程 |
| 无 stdout 但心跳正常 | unknown/suspect，可到硬预算，不只因静默判死 |
| stderr 活跃、stdout 沉默 | 记录正确 channel；不误认完全无活动 |
| 输出洪水/重复日志 | 聚合有界，预算不无限续，监控不被 I/O 饿死 |
| 非零退出发生于第 30s | 立即分类失败，不等 3/5 分钟 |
| code=0 但没有合法产物 | 进入既有验证失败，不宣告 Task complete |
| 第一轮接近总预算成功，repair 仍在跑 | 按 phase/总预算合法判断；GET 不写失败 |
| brief 超时 | brief 归因，无正式执行预算升档，无虚假 replan |
| 模型流事件源不可用 | 不启用结构化 idle 判死，显示能力 unknown |
| 两个停止请求竞争 | 一个停止决策与一次最终事件，信号操作可幂等 |
| 成功与停止同刻竞争 | 原子决策唯一；若成功已提交停止 no-op，若停止已 claim 成功不得提交 |
| 收尾失去认领后继续返回 | proof、产物指针、业务事件及共享工作区不被迟到收尾修改，不释放新执行的锁 |
| run 终结与 Task/产物提交之间发生异常或崩溃 | 短事务整体提交或回滚；未完成执行可由对账发现并处置 |
| A 失效、B 运行、A 迟到心跳/结果 | A 无权刷新 B/产物/依赖/Hold |
| 旧进程收到 TERM 仍写文件 | 不启动共享目录的新执行；升级终止或隔离 |
| PID 被复用 | 身份不匹配拒绝 kill，不伤害新进程 |
| spawn 后登记 PID 前 Worker 崩溃 | containment 可查可停；不可确认则隔离 |
| 两 Worker 同时认领 | 只有一个 claim/run/预算预留成功 |
| 不同 Task 写同一目录 | workspace claim 保证互斥，不能只锁 taskId |
| Worker exit / OOM / 事件循环挂起 | 进程外监督存活，exit 立即处理或 lease 过期后确认 |
| 只有内层监控、整个 Node 死亡 | 明确不覆盖；完整交付须由外层测试覆盖 |
| Supervisor 自己崩溃/整机掉电 | 系统监督/重启后对账；不承诺离线即时通知 |
| 数据库 busy/不可用 | 有界重试、停止派发/归属宽限，不启动恢复风暴 |
| heartbeat 迟到/乱序/重复 | seq/epoch 校验，不把时间倒退、不复活终态 |
| 时钟跳跃/睡眠唤醒 | 探测与宽限，单调时间预算语义一致 |
| GET 每秒轮询 vs 完全不访问 | 最终执行结果、锁、预算、恢复决策一致 |
| 拿锁前后各持久化点崩溃 | 原子回滚或遗留对账可达，无永久无主 running |
| outbox 写入前事务回滚 | 无半完成状态、无孤立成功通知 |
| 发送成功后 ACK 前 Dispatcher 崩溃 | 可重复投递，消费者只执行一次 |
| 消费者创建恢复条目后崩溃 | 重启不创建第二条，scheduler 能补捞 |
| webhook 5xx/超时/离线 | 保留事件、退避、可查询死信并重放 |
| 取消与自动恢复竞争 | 取消后无新执行，不误清其他 Hold |
| 权限收紧/上游变化发生于恢复前 | 重新校验，旧 grant/检查点不越权复用 |
| quota 重复失败 | 不消耗任务失败计数，实际时间记账，基础设施重试有限 |
| 重试达到原 ADR 0015 上限 | 真实 Hold/affordance 可操作，不换 runId 逃逸 |
| 累计预算在重启后已耗尽 | 不再派发；必须显式追加授权 |
| 外部操作成功但响应丢失 | 查询/幂等确认，不能盲目再次执行 |
| 旧版数据库升级、历史 null 活动 | 不批量误杀，有 legacy 处置记录 |
| policy 配置在 run 中途变化 | 当前使用快照；紧急撤销通过显式停止，不偷偷改历史 |

检测时延验收：在受控、非阻塞环境，明确子进程退出应在 1s 内生成本地持久决策；Worker 无响应按 heartbeat/lease/scan 配置给出上界（候选约 90s+5s），终止确认再加宽限；外部通知耗时单独测量。真实系统受数据库/机器暂停影响，报告这些前提，不能承诺任何故障都在发生瞬间获知。

## 12. 测试、交付与回滚

先用注入时钟、deferred Promise、fake adapter 建立逻辑测试；进程测试使用本地小脚本模拟 exit、沉默、TERM 忽略、孙进程和 Worker 崩溃，绝不对真实用户任务做破坏性测试。多连接 SQLite 测试验证竞争，不能只用单连接内存 mock 证明原子性。

按当前 package.json 执行受影响测试、类型检查及必要的全量回归（当前 root 有 test、typecheck、lint、smoke:mock）。真实 smoke 使用独立数据库、工作区和端口，保留用户现有 `.auto-crop`。

2026-09-21 在 `a3893bd` 核对时执行 `pnpm exec vitest run apps/server/src/runtime/scheduler.test.ts apps/server/src/runtime/taskRecovery.test.ts apps/server/src/api/routes.test.ts`，3 个文件、136 项测试全部通过。这仅是当前回归基线，不证明新监控策略、候选阈值或本节完整验收矩阵已通过；本次未运行真实 Agent 或新增故障注入测试。

每阶段交付记录：改了哪些接口与持久化语义、通过哪些场景、未完成哪些门槛。完成时更新 CONTEXT/ADR，特别是 server CONTEXT 中“读时修复执行”的旧描述、预算与 Bounded Recovery 术语；不把本文原案冒充最终实现。

回滚顺序：停止新派发/自动恢复→排空或确认停止活动执行→排空/保存 outbox→切换策略版本。可以从新预算策略回退 observe，但保留归属保护、终态校验、GET 去副作用等正确性修复。数据库 schema 回滚需要验证兼容性，不直接删新列/事件。

最终交付清单：

- [ ] 无需打开页面也能观察在途执行，Worker 崩溃有进程外检测。
- [ ] 健康长任务跨软预算保持同一 run；硬预算/累计预算可解释且不可绕开。
- [ ] 修复期间读路径竞态、孤立锁、迟到提交、重复恢复均有回归测试。
- [ ] 终止已确认才允许共享目录重新执行；未知终止状态有真实排查出口。
- [ ] 失败事件真实送达本地恢复消费者，重复/丢 ACK/重启路径已验证。
- [ ] 停止原因、阶段、消耗、恢复动作在 API/界面可见，Hold 与实际路由一致。
- [ ] 有限续做保留产物来源；外部副作用不确定时不会盲重放。
- [ ] 实测报告、配置门槛、平台能力与停电/存储故障盲区如实说明。

## 13. cumora 参考的适用范围

核对版本 `1a82fe6`；2026-09-21 查询远端 HEAD 仍为该提交，参考版本未发生变化。仅作设计参考，不复制阈值作为本项目真理：

- [本地引擎整轮时限默认关闭、可配置开启](https://github.com/yetone/cumora/blob/1a82fe6/server/src/agents/computer/engine.ts#L259)。
- [本地 run 心跳每 60s](https://github.com/yetone/cumora/blob/1a82fe6/server/src/agents/computer/daemon.ts#L2295)，[独立遗留运行清理默认每 60s 扫描、关闭超过 10 分钟未更新的 running 记录](https://github.com/yetone/cumora/blob/1a82fe6/server/src/agents/observability.ts#L326)。daemon 仍能心跳不代表它等待的模型一定在正常推进。
- [云端单次模型流 idle/wall 限制](https://github.com/yetone/cumora/blob/1a82fe6/server/src/agents/turn-stream.ts#L15)，不是本地 CLI 内部调用的统一保证。
- [75% 上下文压缩、95% 上下文硬限制](https://github.com/yetone/cumora/blob/1a82fe6/server/src/agents/turn.ts#L925)，不是总费用预算。
- 它的清理器不直接重启任务；议程/未读消息的后续唤醒也不等于所有失败都保证续跑。本项目要实现的可靠恢复链须独立完成。
