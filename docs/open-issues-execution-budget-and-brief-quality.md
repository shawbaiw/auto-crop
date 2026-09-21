# 待讨论：执行预算、执行状态一致性、简报质量

日期：2026-09-21（第二版）。基线：`main` @ `b70636a`。

这份文档给讨论用，不是结论。第一版有四处错误和一处被证伪的结论，已在第九节列出勘误；正文已按勘误修正。

三个问题都**不是** PR #11 引入的（第四节那个窗口是 PR #11 **加宽**的，不是新造的）。所有对本仓库的引用都在当前 `main` 上核对过，行号即当前行号。

---

## 一、预算机制现状

### 1.1 三档预算

`apps/server/src/runtime/executionProfile.ts`：

| 档位 | 时长 | 由什么触发 |
|---|---|---|
| short | 120s | `product-brief`、`research-report` |
| medium | 300s | `repo-diff` |
| long | 600s | `landing-page-file`、`test-output` |

引入于 `99c096b`（2026-08-19）。

### 1.2 能力下限

`capabilityProfileFloor`：运行持有 `web_research` 时，档位下限抬到 medium。引入于 `d6347b3`（2026-09-14，ADR 0021）。代码注释原文：

> `research-report` and `product-brief` were sized `short` (120s) for a task writing down what the agent already knew. A run that actually searches the web and reads pages cannot fit that, and the floor is derived from the grant rather than added to the proof-schema table so a later network-bound capability inherits the rule instead of needing its own row (ADR 0021).

**这个旋钮已经因为同一类证据上调过一次**，现在是第二次证据。

### 1.3 超时后的升级与终止

1. 运行超时 → `resolveRetryTimeout` 升一档 → 整个任务从头重跑。
2. 已在 long 档仍超时且无 `artifactWorkspacePath` → 转 `needs_replan`，出路只有创始人重新规划。
3. 下游消费者随之 `blocked`。

### 1.4 三条容易被忽略的事实

- **升级会先烧满前一档。** 需要 331 秒的任务，先烧满 300 秒失败，再花 331 秒成功，墙钟 631 秒，工作做两遍。
- **简报耗时从任务预算里扣**（`scheduler.ts:382`）。实测一次简报花掉约 39 秒，正式运行只剩 261 秒（档位 300s）。
- **两个 deadline 起点不同**：数据库判据是 `run.startedAt + effectiveTimeoutMs`（`taskRecovery.ts:56`，`startedAt` 写于 `scheduler.ts:354` 创建 run 记录时），子进程计时器从 spawn 起算（`cliAgent.ts:404`）。中间隔着简报运行与工作区准备。**这是第四节那个竞态的来源之一。**

---

## 二、问题一：预算偏紧，会把「慢」变成「公司停死」

### 2.1 真实数据

第三轮冒烟（`run-root2`，未强制预算）。每个任务都在第一档失败、升一档后成功：

| agent | 任务 | 首档 | 次档实际耗时 |
|---|---|---|---|
| claude-code | 关键词调研 | medium 300s 超时 | 331s |
| claude-code | 验证关键词调研 | medium 300s 超时 | **193s** |
| claude-code | 关键词调研（返工轮） | medium 300s 超时 | 376s |
| claude-code | 验证关键词调研（第 2 轮） | medium 300s 超时 | 316s |
| claude-code | 定义 MVP | medium 300s 超时 | **235s** |
| claude-code | 验证 MVP 简报 | short 120s 超时 | 241s |
| codex | Define 子任务 | short 120s 超时 | 160s |

**两行**（193s、235s）的次档耗时小于它在首档拿到的 300s 预算。如果任务只需要 193 秒，它不该在 300 秒预算下超时。

可能的解释不止一种，目前**都没有证据**：重跑时上下文已落盘更快、首次运行卡在某次工具调用、模型路径/网络延迟差异、工作区残留被复用。**而我们现在无法分辨，因为系统里没有任何地方记录活动时间。**

第四轮（`run-root3`）：关键词调研 medium 300s 超时 → long 600s **也超时** → `needs_replan`，8 个下游全部 blocked，公司停死。

第五轮（`run-root4`，强制 1200s）：同类调研任务 **636s 完成**；codex 验证任务 190s 完成。

**636s > 600s** 说明这一次执行 long 档装不下；**不能**由这一个样本推出「该任务每次至少要 636 秒」。

### 2.2 因果链

```
联网调研任务耗时分布跨度大（实测 190–636s）
        ↓
首档必然超时 —— 浪费一整档预算，工作从头再来
        ↓
升到 long，多数能完成，少数不能
        ↓
long 也超时 → needs_replan → 只能创始人重新规划
        ↓
下游全部 blocked，公司停死
```

最后一步是错的：**一个「慢」的执行，被表达成「规划有问题」的结论**。

### 2.3 与 ADR 0032 的关系

PR #11 已修掉相邻缺陷：简报（60s 上限）超时曾被记成「任务超时 5 分钟」并触发升级与 `needs_replan`。现在简报失败按自己的预算报告、不升级、不作为重新规划依据。**任务本身的升级链条没动**，2.2 完整保留。

### 2.4 备选方向

| 方向 | 优点 | 代价 / 疑问 |
|---|---|---|
| A. 调高档位数值 | 一行改动，立刻止血 | 治标；「烧满一档再升级」的浪费仍在；数值凭什么是这个值 |
| B. 按 agent 分别定档 | 贴合实测（claude-code 明显慢于 codex） | 预算变成 agent 属性；换模型就得重调 |
| C. 续跑而非重跑 | 省掉重复工作 | agent 无状态，需要断点续跑契约；可接现有 Partial Output 续做机制 |
| D. 判据从「跑了多久」换成「多久没动静」 | 对准真正想防的东西 | 见第六节；stdout 静默是单向证据；阈值必须先采数据 |
| E. 规划期声明预算 | 与 ADR 0025/0029「由规划声明」一致 | 模型对自己耗时的估计可靠吗，无证据 |
| F. `long` 超时不再转 `needs_replan` | 不再把「慢」说成「规划有问题」 | 需要定义新的出路；与 Bounded Recovery 的关系要理清 |
| G. 增加资源上限（工具调用次数 / 模型往返次数） | 与机器快慢无关、可重放、适合兜底 | 不替代时间闸；两者管的是不同的东西 |

---

## 三、cumora 对照（已按 Codex 核对修正）

### 3.1 可以借鉴的

- **活性靠心跳 + 清道夫**：run 级心跳 60s 上报，清道夫 10min 无更新判死。**清道夫只判死、只写原因，从不重启任何东西。**
- **判死是一条原子 SQL**，带 `AND status='running'`：迟到的心跳撞不动已终结的行，也天然多实例安全。
- **重来以「工作」为单位，不以「进程」为单位**：死掉的 run 永远是死的；活没干完这件事由另一条扫描路径重新发现，开全新的 run。
- **给人看的阈值和给机器判死的阈值是两个数**：5min 染色（纯 UI，不写库）、10min 判死。它们的 5min 原来是 90s，因为把 ffmpeg 转码这类健康长调用全染成 stalled 才放宽的。

### 3.2 第一版写错、已修正的

- ~~「cumora 在任务层永远不设时限」~~ → `CUMORA_TURN_TIMEOUT_MS` 是 persistent-engine **单轮**的**可选**兜底时限，默认关闭但**可配置开启**。不能据此得出「任务层不该有时限」。
- ~~「75% token 预算上限」~~ → 75% 是**上下文压缩触发阈值**，压缩后继续跑；另有更高的硬阈值。不是任务累计 token 预算。
- ~~「墙钟只设在无副作用的层」~~ → 不成立，`kubectl` 调用和编排操作都有副作用。准确的说法是：**墙钟设在步数有限、耗时分布已知的层**。
- ~~「时间判据写不出稳定回归测试」~~ → 被我们自己的代码反证：`taskRecovery.test.ts:19` 就是注入固定时钟测超时的。该说的是「真实耗时不可预测」，与「超时逻辑不可测」是两回事。

### 3.3 三个必须分开的概念

| 信号 | 能证明什么 |
|---|---|
| 心跳 | 运行器还能定期执行并汇报 |
| stdout/stderr 活动 | 子进程最近有输出 |
| 有效进展 | 任务完成了一个可确认的步骤 |

**stdout 静默是单向证据**：有活动 ⇒ 大概率活着；无活动 ⇏ 死了（CLI 可能把输出缓冲到最后）。所以它只能**延长寿命**，不能判死。cumora 敢双向用 idle timeout，是因为那头是结构化事件流，不是裸 stdout。

---

## 四、执行状态一致性（新增，优先级最高）

这一节不是预算问题，但和它同源，且**不需要等耗时数据就能处理**。

### 4.1 本仓库现状

| 事实 | 位置 |
|---|---|
| `AgentRun` 只有 `startedAt` / `finishedAt`，没有任何「最后活动时间」 | `packages/core/src/types.ts:652` |
| 超时计时器从 spawn 起算，**不看 stdout**；stdout 只写日志 | `cliAgent.ts:412` 与 `:429` 各管各的 |
| `reconcileStaleRunningTasks` 的判据同为总耗时（`startedAt + effectiveTimeoutMs`） | `taskRecovery.ts:51-57` |
| 调度 tick 在任务执行期间被 `running` 守卫挡住 | `start.ts:141` |
| run 状态写入是 `WHERE id = ?`，**没有「仅当仍在运行」前置条件** | `repositories.ts:1188` |

所以 `reconcileStaleRunningTasks` 的主要角色是**崩溃后对账器**，不是实时看门狗——但它**能**在执行期间被读路径触发（下节）。

### 4.2 一条可达的竞态路径（由 Codex 指出，我已核对）

```
t0  createAgentRun（scheduler.ts:354）→ DB deadline = t0 + B
    简报运行、工作区准备
t3  子进程 spawn（cliAgent.ts:404）→ 进程计时器 = t3 + 剩余预算
    正式运行返回成功
    ↓
    await repairBusinessArtifactSyntax（scheduler.ts:498，独立 120s 预算）
    此时 DB 里 run 仍是 running、task 仍是 running
    ↓
    任意一次 GET 公司状态 → routes.ts:883 → reconcileStaleRunningTasks
    → deadline 已过 → run 标 failed、task 标 failed 挂 runtime_interrupted、释放锁
    ↓
    修复返回，scheduler 继续抓产物、finalizeDelivery、
    updateAgentRunStatus(agentRunId, "complete")（scheduler.ts:794）
```

后写的一方无条件覆盖先写的一方，两边都不知道对方发生过。

**注意不要误诊成「收尾用了过期的内存对象」**：`finalizeDelivery` 是重读任务的（`deliveryFinalization.ts:94`），而且会主动清除 `runtime_interrupted` Hold（`:101`，`HOLDS_ANSWERED_BY_DELIVERY`）。缺的不是重读，而是**它从不问「这份交付是不是来自当前仍然有效的那次运行」**——重读解决不了归属问题。

三点说明：
1. **这个窗口是 PR #11 加宽的**：ADR 0028 的语法修复把「正式运行返回 → 收尾」之间从几百毫秒拉长到最多 +120 秒。不是新造的窗口，但责任在这次改动。
2. 触发方**不限于人开着页面**：任何调用那四个 GET 的客户端都算。
3. 已受控复现（见 4.5）。但仍**没有**证据说某次冒烟事故就是它造成的。

### 4.3 孤立锁：恢复机制的索引键

执行顺序（均已核对）：

| 步骤 | 位置 |
|---|---|
| 拿锁 | `scheduler.ts:222` |
| `await` adapter 可用性检查 | `scheduler.ts:275` |
| 任务标记 running | `scheduler.ts:285` |
| 创建 run 记录 | `scheduler.ts:354` |

硬崩溃可能留下两种状态：`queued + 锁 + 无 run`，或 `running + 锁 + 无 run`。而 `reconcileStaleRunningTasks` 遍历的是 `listRunningAgentRuns`（`taskRecovery.ts:51`），两种都看不见。kill switch 同样从 run 推导要取消的任务（`killSwitch.ts:21`），最后才清全部锁——**能清锁，但不一定能修好那个孤立的 running 任务**。

所以不是「提前建 run」或「改用锁索引」二选一：**恢复应当能识别 task / run / lock 三者之间的不一致**，创建时也应尽量原子地建立执行归属。

### 4.4 终止确认

`child.kill("SIGTERM")` 之后立刻 resolve，没有 SIGKILL 升级、没有确认进程消失。被判死的进程可能还在往 `artifactWorkspacePath` 里写，而续做任务马上要去读那个目录当 Partial Output。

### 4.5 受控复现与实测到的结果

`scheduler.test.ts` 里的 `it.fails("does not let a concurrent read path fail a run the scheduler is still finalizing")`：正式运行写出带裸引号的产物 → 进入语法修复 → **在修复运行内部**调用一次 `reconcileStaleRunningTasks`（时钟拨到预算之后，等价于一次 GET 公司状态）→ 修复返回 → 调度器照常收尾。用 `it.fails` 记录「这些断言今天必然失败」，套件保持绿色；修好之后去掉 `.fails`，它就是回归测试。

实测到的最终状态：

```
run  : status = complete,  failure_reason = "timeout"
task : status = complete,  latestFailureReason = "timeout"
holds: []
```

| 预测 | 实测 | 说明 |
|---|---|---|
| run 既 complete 又带 timeout 失败原因 | **成立** | `updateAgentRunStatus` 的 `WHERE id = ?` 无守卫，且失败字段用 `COALESCE` 保留 |
| task 既 complete 又带 timeout 失败原因 | **成立** | `finalizeDelivery` 重读了任务，但不校验交付的归属，照常把它推进到已验收 |
| ~~`runtime_interrupted` Hold 会留下来，被 recover 重跑一遍~~ | **不成立** | `finalizeDelivery` 主动清除该 Hold（`HOLDS_ANSWERED_BY_DELIVERY`），这是设计行为而非偶然 |
| 锁在收尾期间被提前释放 | **成立** | 复现里断言窗口内锁数应为 1，实测为 0 |

所以真实危害收敛为两条：**记录自相矛盾**（排查时无法判断这次运行到底成没成功、KR 该不该记），以及**锁在收尾期间失效**（并发派发同一任务的前提条件成立，虽然当前单 worker 架构让它难以触发）。

**（已被取代）** 这条 `it.fails` 复现已由三条双向验收测试替换（ADR 0034）。当时保留它的理由仍然值得记：**它只用来记录缺陷，不能当验收标准**：`it.fails` 只要有一个断言失败就算通过，证明不了后面的断言执行过；而且「最终该是 complete 还是 failed」取决于 4.6 那个还没定的规则。验收要写成**两个方向各一条**测试，并且**都断言败方不产生任何业务写入**。

### 4.6 修复方向：已经排除的，和必须先定的

**已排除：把 `complete` 提前写上去当认领令牌。** `complete` 是最终结果，拿它表示「我正在收尾」等于用终态表示中间态。一旦抓产物失败或进程退出，就留下「run 完成、交付没完成」，而条件更新 `AND status = 'running'` 恰好挡住了把它改回 failed 的路——比原问题更难恢复。

**三件事必须分开，不能用一个手段号称全解决：**

| 关注点 | 解决手段 |
|---|---|
| 写入资格 | 条件更新：这次运行是否仍有权改这个任务 |
| 提交一致性 | 短事务：run、task、产物、验收记录一起落库（`repositories.transaction()` 已存在，SAVEPOINT，可嵌套） |
| 中断恢复 | 阶段 + 该阶段自己的截止时间：认领之后进程退出，谁接手 |

**规则必须对称**：超时方（`reconcileStaleRunningTasks`）现在是无条件写的。它同样要走条件更新，没抢到就不能改任务状态、不能释放锁、不能发失败事件。只约束 scheduler 等于只修一半。

**慢操作要放在事务之外**：语法修复、外部验证这类耗时动作先做完，真正提交时再进短事务校验归属并一次写入，提交后才对外发通知。

**规则已定**（第十一节）：选项 3，预算含固定宽限；宽限到期后仍会回收，不会留下永远卡住的任务。

---

## 五、问题二：执行简报内容是占位

### 5.1 事实

ADR 0022 给简报加了 Structured Output Contract，CLI 保证合法 JSON 与字段齐全。实测出现：

```
{"purpose":"测试","approach":"测试","expectedOutcome":"测试"}
```

完全满足 schema，解析通过，运行继续。出现在 `server2.log:2745`、`server3.log:1593`、`:1630`。

ADR 0022 的 Consequences 已经写明这一限制：

> Known limitation: the contract constrains shape, not substance. A schema-valid brief whose `approach` is empty or generic still has to be caught by the parse and by review.

### 5.2 与问题一是否同源：证据不足

`server3.log` 里那次，占位简报出现在一个随后正式运行超时（261s/300s）的任务上。但**「同一个任务既慢又给出占位简报」不足以证明两者同源**，「模型感到计时器压力」更是需要证据的猜测。第一版把这条写得太笃定，已降级为待查。

### 5.3 备选方向

| 方向 | 优点 | 代价 / 疑问 |
|---|---|---|
| A. 最小内容校验 | 挡住最粗糙的占位 | 场景条款式补丁；「测试」挡住了，「完成任务」呢 |
| B. 抬高简报预算或不从任务预算里扣 | 若成因是时间压力则对症 | 成因未确认 |
| C. 不合格重试一次 | 简单 | ADR 0022 与 0032 各否决过一次 |
| D. 取消独立简报运行 | 省一次调用与预算切分 | 简报的意义正是「派发前的意图证据」 |
| E. 接受并在界面标注存疑 | 诚实、零风险 | 什么都没解决 |

---

## 六、结论：问题该怎么拆，以及分层设计

### 6.1 现在被混成一件事的三件事

| 事实 | 证据强度 | 正确的动作 |
|---|---|---|
| **预算耗尽** | 确定（时钟） | 续时 / 从 Partial Output 续做 / 停下问人。**不等于死，也不等于规划错** |
| **执行失活** | 推断（静默 + 进程是否还在） | 判死并写明原因；先确认进程真的没了 |
| **规划有问题** | 业务判断 | 只能由业务证据得出，不能由时间得出 |

现在这三件事共用一个 `failureReason: "timeout"`，所以只能有一种动作。

**任务级时间上限该保留**（成本、资源占用、交付时效），但它的含义只能是「超预算」。`long 超时 → needs_replan` 这条映射要改。

### 6.2 分层

| 层 | 信号 | 证据强度 | 动作 | 写状态？ |
|---|---|---|---|---|
| S0 | 进程退出 | 确定 | 立即判定，区分 mid-task / idle | 是 |
| S1 | stdout/stderr 活动 | 单向 | 只能延长寿命 | 否 |
| S2 | 静默超阈值 | 推断 | 标「疑似停滞」给人看 | 否 |
| S3 | 静默 + 进程已不在 | 确定 | 判死，写明原因 | 是 |
| S4 | 预算耗尽 | 确定 | 进策略层 | 是，原因写「超预算」 |

### 6.3 实施顺序

**第 0 步 · 正确性（不必等数据，可与观测并行）**
1. run 状态写入加 `AND status = 'running'` 守卫。
2. 收尾副作用整体受同一守卫保护——抓产物、写事件、父任务汇总、`finalizeDelivery` 都要在「这次运行仍然是当前运行」成立时才发生。挡住 `applyTaskTransition` 一处是不够的：它是唯一的**状态**写入口，从来不是唯一的**副作用**入口。
3. 读路径不再判死：`buildCompanyState` 只报告，判死留给调度器与恢复这条写路径。
4. 恢复能识别 task / run / lock 三者不一致。
5. SIGTERM → SIGKILL 升级 + 确认进程消失，再让续做任务读工作区。

**第 1 步 · 观测（只记录不判定）**
接缝在 `cliAgent.runCommand` 的 `stdout.on("data")`，由调度器注入 `onActivity`（**不叫 onProgress**）。要采的不是一个会被覆盖的时间戳，而是：首字节时间、**最大静默间隔**、活动序列（或分桶）、各阶段（简报 / 正式 / 语法修复）起止与预算、退出原因与退出码。
**验收标准是数据不是代码**：拿到各 CLI 的静默分布后才谈阈值。

**第 2 步 · 判据分层**：按 6.2 落地，`failureReason` 拆开，策略按类型分流。

**第 3 步 · 独立监控**：挂不受 `running` 守卫约束的 interval，初期只报告。必须在第 0 步之后，否则是新造一个竞态源。

**第 4 步 · 策略层**：通知机制我们已经有（`reconcileStaleRunningTasks` 返回事件、Hold 带 `subjectKind`/`subjectId`），缺的是分类。判死与重跑**写在两个地方**，中间只用事件连接。

**过渡期止血**：可以先提高 long 档，但必须写明是临时措施、依据是单个样本、复查条件是第 1 步的数据到手。

---

## 七、待定问题

1. 第 0 步的 5 条，哪些可以合成一次改动？「整段收尾受同一归属守卫保护」是否需要一个显式的「认领 / finalizing」状态？
2. ~~收尾方与超时方相撞谁赢~~ 已定并实施（第十一节、ADR 0034）。后续：要不要把收尾的那组写入放进短事务；4.3 的孤立锁怎么处理。
3. `long 超时 → needs_replan` 改成什么？新增一种「超预算」Hold，还是复用现有 Hold 种类？与 Bounded Recovery 的 3 次上限如何共存？
4. 观测阶段要跑多少个真实任务才算够？由谁判断分布「采够了」？
5. 资源上限（工具调用次数 / 模型往返次数）现在就引入，还是等时间判据稳定之后？
6. 问题二先查成因还是先接受？如果查，怎么设计一个能分辨「时间压力」与「模型行为」的观察？

---

## 八、明确不建议的做法

- 不按任务标题或 proof schema 名字写特例（ADR 0029 刚删掉最后一处）。
- 不往简报提示词里堆场景条款（Cumora 的 anti-pattern；ADR 0029 记录）。
- 不用「多重试几次」代替定位成因（ADR 0022、0032 各否决过一次）。
- 不由单个样本推出全局新档位。

---

## 九、勘误（第一版 → 第二版）

| 第一版的说法 | 实际 |
|---|---|
| 「193s、235s、241s 三行小于首档预算」 | 241s 那行首档是 120s，**只有两行** |
| 「reconcile 原理上不可能比 kill 更早开火」 | 两个 deadline 起点不同（run 创建 vs 进程 spawn），且语法修复把窗口拉长到 +120s，**可达** |
| 「cumora 在任务层永远不设时限」 | 那是 persistent-engine 单轮的可选兜底，默认关但可配 |
| 「75% token 预算上限」 | 是上下文压缩触发阈值 |
| 「墙钟只设在无副作用的层」 | kubectl 等有副作用；准确说法是「步数有限、耗时分布已知的层」 |
| 「时间判据写不出稳定回归测试」 | 被 `taskRecovery.test.ts:19` 反证 |
| 「两个问题可能同源」（笃定） | 证据不足，降级为待查 |
| 「4.2 的窗口会留下未解除的 Hold，recover 会把任务重跑一遍」 | 受控复现证伪：`finalizeDelivery` 主动清除该 Hold。真实危害是记录矛盾 + 锁提前释放 |
| 「`finalizeDelivery` 拿派发前的内存 task 对象、不重读」 | 不成立：`deliveryFinalization.ts:94` 重读任务，`:101` 清除 Hold。缺的是**归属校验**，不是重读 |
| 「原子认领 = 整段要么发生要么不发生」 | 说满了。写入资格、提交一致性、中断恢复是三件事（见 4.6） |

---

## 十、数据出处

- 冒烟库在会话级临时目录（隔离，从未触碰仓库的 `.auto-crop`），**会随会话清理消失**：`run-root2`（第三轮）、`run-root3`（第四轮）、`run-root4`（第五轮，强制 1200s）。第二节表格是从它们导出的全部内容。
- 占位简报：`server2.log:2745`、`server3.log:1593`、`server3.log:1630`。
- 相关 ADR：0015（Bounded Recovery 上限）、0020（Task Hold：停住必须有具名原因和出路）、0021（能力下限）、0022（结构化输出契约及其限制）、0028（产物语法修复，即 4.2 窗口的来源）、0032（失败归属）。
- 第三、四节来自一次 cumora 对照讨论（Claude 读 cumora 源码 + Codex 两轮复审修正），本仓库的每条事实都在 `main` @ `b70636a` 上核对过。

---

## 十一、已拍板并实施：收尾方与超时方相撞，谁赢

**2026-09-21 决定：选项 3（预算含固定宽限），已实施**（分支 `execution-claim-and-grace`，ADR 0034）。落地的内容比选项 3 本身多两样——归属守卫是三个选项都要做的部分：

- 宽限：`startedAt + effectiveTimeoutMs + FINALIZATION_GRACE_MS`，宽限值由 `ARTIFACT_SYNTAX_REPAIR_TIMEOUT_MS + 30s` 推导。
- 双向认领：`updateAgentRunStatus` 增加 `expectedStatus` 并返回是否写成功；收尾的每个分支先认领，输了什么都不写；`reconcileStaleRunningTasks` 同样认领，输了不碰任务、不释放锁、不发事件。
- 产物落库从分支之前挪到各分支认领之后。
- 三个方向的验收测试（宽限内收尾赢 / 宽限外超时赢 / 超时方迟到），败方一律断言零业务写入；外加一条用过期视图模拟并发的单元测试，覆盖超时方那半个守卫。

**仍未解决**（ADR 0034 的已知限制）：认领决定谁能写但没让写入原子（崩溃仍可能留半套）；「拿锁之后、建 run 之前」崩溃留下的孤立锁（4.3）未动；宽限对所有 run 一视同仁。

下面保留当时三个选项的取舍，供回看。

### 当时的三个选项

4.2 的竞态之所以修不下去，是因为这个规则没定。三种选法，后果不同。

### 选项 1：收尾方在「声明的收尾阶段」内赢

run 进入收尾后带一个自己的阶段与截止时间（语法修复 120s + 余量）；这段时间内超时方不得判死，超过阶段截止时间才轮到超时方。

- ✅ 已完成的工作不会被白扔，已经花掉的 agent 调用不浪费。
- ✅ 语义清晰：任务预算管 agent 干活，收尾阶段管 runtime 自己的有限步动作。
- ⚠️ 任务实际占用时间变成「预算 + 收尾上限」，预算不再是硬上限，必须写明并接受。
- ⚠️ 需要新增阶段表达（`run.stage` 或 `finalizing` 状态）+ 迁移 + 恢复逻辑分支。
- ❌ **必须实现「卡在收尾」的恢复**，否则被排除出扫描的 run 会永远卡住。

### 选项 2：超时方赢，预算是硬上限

预算一到谁都不能再写；收尾方发现自己失去资格就整段安静放弃。

- ✅ 规则最简单：一个截止时间、一个赢家判定，不需要阶段字段。
- ✅ 成本可预测，预算含义纯粹。
- ❌ 会白扔已经成功的执行——而语法修复恰恰常在预算末尾触发，概率不低。
- ⚠️ 工作未必真丢：产物还在工作区，理论上可由现有 proof recovery（`refresh_task` → `recoverProofIfPossible`）捡回。**这条路在这个场景下能否捡回，尚未验证。**
- ⚠️ 要求收尾方认领失败后**完全安静**：不写状态、不发事件、不碰锁。

### 选项 3（折中）：预算含固定宽限

不新增阶段状态，只把判据从 `startedAt + budget` 改成 `startedAt + budget + grace`（grace 覆盖收尾的最坏情况）。

- ✅ 不新增字段、不迁移，恢复逻辑仍只有一个判据。
- ✅ 卡在收尾的 run 仍会被回收（宽限也会到期），满足「不能留下永远卡住的任务」。
- ✅ 收尾期间通常不再被判死，白扔的概率大幅下降。
- ⚠️ 宽限对所有 run 一视同仁，即使它根本没进入收尾——相当于所有任务的实际上限都抬高了 grace。
- ⚠️ 治标：它让窗口变小，不表达「我正在收尾」这件事本身。归属守卫（条件更新 + 短事务）无论选哪个都仍然要做。

### 三个选项都不改变的部分

- 条件更新要**双向**：超时方没抢到，同样不能改任务、不能释放锁、不能发事件。
- 提交用短事务（`repositories.transaction()`），慢操作留在事务外。
- 验收要写成两个方向各一条测试，且都断言**败方不产生任何业务写入**。
