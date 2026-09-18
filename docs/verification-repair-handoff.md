# 交接说明：部门子任务交接与验证修复（①–④ 已完成，后续工作）

日期：2026-09-18。分支：`department-subtask-verification-gate`。

这份文档是给**接手后续工作的另一个会话**看的。读完它 + 下面列出的 ADR，应该能在不重读整段历史的情况下继续干活。

---

## 1. 这件事的起点

一次手动测试里，工程部门的任务全部停住。诊断结论（全部有数据依据，不是从截图推测）：

- 部门把「Build the crawlable web prototype」拆成 Define / Execute / Validate 三个子任务，**三者之间没有依赖**，只是碰巧被依次调度。
- Validate 在**自己的空工作区**里运行（`resolveRunWorkspace` 只看直接依赖里第一个有产物工作区的任务，而它的直接依赖是产品简报和 SEO 架构，都没有），`ls` 结果为空，于是写了一份结构完好、11 项检查全 false、结论「验证未通过」的报告。
- 那份报告 `validationStatus=valid`，而**当时没有任何地方读取它的结论**。它没有流向下游，唯一原因是文本里出现 “Search Console”，被关键词风险扫描送去了人工审核——而在那里点一下「批准」就会被接受。把该词从副本里去掉重放验收逻辑，报告会被**自动**接受。
- 同时，父任务汇总和调度器的就绪判定不一致：前者认为「子任务 review + 有 Proof」即就绪并把父任务入队，四秒后后者认为「上游必须 complete 且已验收」又把它退回等待。

用户的要求是**修根因、不打补丁**：不针对这家公司、这个愿景、这些任务名做特例；修复必须对任意新建公司生效。

---

## 2. 当前状态

分支 `department-subtask-verification-gate`（从 `main` 的 `fd890e5` 分出，**不含** `launch-policy-adapter-translation` 上的 `10a79c1`）。

| 提交 | 内容 | 是否已推送 |
|---|---|---|
| `0a6e029` | ① 验证闸门（ADR 0023） | 是 |
| `805c914` | ② 内部就绪 + 共享就绪/交付收尾（ADR 0024） | 是 |
| `52b9354` | ②b 规划声明验证职责（ADR 0025） | 是 |
| `34f6add` | ③ 有界自动返工（ADR 0026） | 是 |
| `baf2037` | ③ 补丁：版本对应、原子性、父任务走内部链路 | 是 |
| `55084f0` | ④ Action Intent 取代关键词扫描（ADR 0027） | 是 |

`pnpm typecheck`、`pnpm lint`、`pnpm test`（725 项）全部通过。

已知的既有失败：`pnpm smoke:mock` 在 “SSE endpoint should connect” 处失败，**在基线 `main` 上同样失败**，与本次改动无关，未排查。

从未验证过：真实 agent 运行、浏览器界面。

---

## 3. 已经落地的五份契约（先读 ADR，再读代码）

| ADR | 一句话 | 核心代码 |
|---|---|---|
| 0023 验证契约 | 验证者拿到 runtime 制作的目标快照，按上游声明的必验要求逐项报告，裁决由 runtime 汇总；任何验收路径都过不去未通过的裁决 | `runtime/verificationContract.ts`、`packages/core/src/verification.ts` |
| 0024 内部交付与单一就绪判定 | 子任务交付是内部交付（不走验收、不动 KR、不进 CEO 待办）；`resolveDependencyReadiness` 是唯一就绪判定；`finalizeDelivery` 是唯一交付收尾策略 | `runtime/dependencyReadiness.ts`、`runtime/deliveryFinalization.ts` |
| 0025 规划声明验证职责 | blueprint 每个任务必须写 `verification`（`null` 或目标+必验要求）；runtime 不从 proof schema 猜测谁是验证者 | `packages/core/src/schemas.ts`、`runtime/createCompany.ts` |
| 0026 有界自动返工 | 未通过的裁决按失败检查退回责任生产者并带反馈；每个验证任务 3 轮预算，持久化；整组动作在事务内 | `runtime/verificationRework.ts` |
| 0027 Action Intent | 交付物声明 `payload.actions`（做了什么/请求做什么/只是提及），验收只看声明不读散文 | `packages/core/src/actionIntent.ts`、`runtime/actionIntent.ts`、`runtime/automaticAcceptance.ts` |

另外两份必读的既有 ADR：**0020 Task Hold**（状态只能经 `applyTaskTransition` 写，停住必须有 Hold 和出路）、**0021 能力授权** / **0022 结构化输出契约**（“用结构代替提示词约定”的先例）。

---

## 4. 代码地图（只列这次相关的）

```
packages/core/src/
  verification.ts        验证契约类型、MAX_VERIFICATION_ROUNDS、isVerificationSatisfied
  actionIntent.ts        动作声明类型、hasOversightBearingAction
  taskHold.ts            Hold 种类（新增 verification_failed、awaiting_parent_aggregation）与出路
  schemas.ts             blueprint 校验（新增 task.verification 必填与规划期校验）

apps/server/src/db/
  schema.ts              新表 verification_handoffs / verification_reworks；新列 tasks.verification_requirements、
                         business_artifacts.verification、task_dependencies.input_role
  repositories.ts        transaction()（SAVEPOINT，可嵌套）、上述表的读写

apps/server/src/runtime/
  verificationContract.ts  快照交接、指纹、必验要求来源（上游产物或规划）、报告校验、isVerificationCurrent
  verificationRework.ts    返工决策与执行（含父任务走内部链路、版本对应判断）
  deliveryFinalization.ts  唯一交付收尾：held / verification_rework / verification_failed /
                           awaiting_founder_decision / internal_delivery / accepted / awaiting_ceo_review
  dependencyReadiness.ts   唯一就绪判定 + classifyDependency（internal / ordinary / cross_company）
  parentTaskAggregation.ts 只做汇总与状态转换，不再有自己的就绪规则
  automaticAcceptance.ts   先读 Action Intent 声明；无声明才回退关键词表（兼容旧产物）
  actionIntent.ts          声明解析与校验
  scheduler.ts             拆分模板（声明式 inputs）、快照准备、派发、返工反馈注入
  taskRefresh.ts           Proof recovery：与调度同一条收尾策略
  businessArtifact.ts      捕获与校验（含两份契约的校验入口）
  taskExecutionPrompt.ts   执行提示词：能力授权、验证契约、返工反馈、动作声明

测试（都能当文档读）：
  runtime/departmentVerification.test.ts   部门链路 + 返工 + 事务/版本/内部链路补丁
  runtime/deliveryFinalization.test.ts     两个入口 × 结果矩阵、幂等
  runtime/plannedVerification.test.ts      从 createCompany 起跑的三类业务端到端
  api/routes.test.ts                       创始人决策全生命周期（两个入口）
```

---

## 5. 必须守住的不变量（改这块代码时最容易破坏的）

1. **不要再加关键词判断。** 描述风险 ≠ 执行风险动作；谁是验证者、要验什么、做了什么动作，都由声明决定。系统里最后一处关键词驱动行为是拆分触发器（见第 6 节第 4 项）。
2. **只有一份就绪判定。** 新增调用方要调用 `resolveDependencyReadiness`，不要再写第二套「review + Proof 就算数」。
3. **只有一份交付收尾策略。** 任何“产出了产物之后决定去哪”的新入口都要走 `finalizeDelivery`，否则就是当初 recovery 漏掉创始人决策的同一类 bug。
4. **状态只经 `applyTaskTransition`**，并且只解除自己确实回答了的 Hold（`resolvesHoldKinds` / `resolvesHoldIds`）。
5. **裁决只对它检查过的版本有效。** 加新的消费/验收路径时要同时问 `isVerificationSatisfied` 和 `isVerificationCurrent`。
6. **一组状态变更要原子。** 写记录再做动作的模式必须包在 `repositories.transaction` 里，否则幂等判断会把「写了一半」当成「已完成」。
7. **测试要能抓回归。** 本次每一片都做了「逐个关掉新加的保护，确认至少一个测试变红」的检验；建议延续，它在本次至少抓出两个真实缺陷（重复收尾把已验收任务推回审核、幂等断言过松）。

---

## 6. 后续工作（已与用户确认的方向）

前提：**用户会删除 `.auto-crop` 状态重新创建公司**，因此不需要为旧公司做恢复。

### 1) 取消原计划的 ⑥「旧公司恢复 dry-run」——已完成
计划文档的 ⑥ 已改为「删除 `.auto-crop` 状态重建」，第 2、10、11 节与 ADR 0024 中的恢复表述已同步删除。

### 2) 真实 agent 冒烟（建议最先做，成本低、信息量大）
新契约目前只被 mock agent 验证过。要确认：
- 真实 CEO agent 能否稳定为**每个任务**输出 `verification`（`null` 或目标 + 必验要求）；缺字段会导致公司创建直接失败（这是设计，但要确认模型做得到）。
- 执行 agent 能否稳定输出 `payload.actions` 和 `payload.verification.checks`（逐项、含证据、不漏项）。
- 参考 `scripts/real-agent-smoke.ts` 与 `pnpm smoke:real-agent`。
- 如果模型经常漏字段：优先考虑给这些回复加 **Structured Output Contract**（ADR 0022 的 `--json-schema` / `--output-schema` 路子），而不是放宽校验。

#### 真实冒烟结果（2026-09-18，第一轮）
规划脚本：`pnpm smoke:real-planning`（`scripts/real-planning-contract-smoke.ts`；默认三个用例，可用 `SMOKE_CASES` JSON、`SMOKE_OUT_DIR` 覆盖；任一规划解析失败即退出码 1，语义是否正确仍需人看输出）。执行冒烟：隔离目录 `INIT_CWD=<dir> tsx apps/cli/src/index.ts start`，经 API 建公司，读库观察。

契约本身：
- CEO 规划 3/3 合规（codex 中文、claude-code 中文、codex 英文）：每个任务都有 `verification`，目标与要求合理。一例语义错误：claude-code 把 `run_local_checks`（test-output，依赖原型）声明为 `null`——即第 8 节「声明 null 却在验证」的限制，真实模型第一次就出现。
- 执行 agent：每个有效产物都声明了 `payload.actions`；codex 验证者按快照逐项给出 checks 与证据，runtime 汇总 `outcome: passed` 并绑定目标产物 ID 与 revision。
- 还没走到：原型验证、验证失败、返工。

冒烟发现、已修：
- codex 沙箱按 `run_command` 选 `workspace-write`，导致「可写不可跑命令」的授权以只读启动，写不出产物文件（`cliAgent.ts` 的 `codexSandboxForGrant`，ADR 0021 已补说明）。
- **`recover_task` 对无效产物原地打转**：`recoverProofIfPossible` 在任务已停在 `invalid_business_artifact` Hold 上时，重新抓到的产物仍不可审就返回 `still_unreviewable`——不写新产物、不再 block、不开第二个 Hold；`recover` 于是走重跑分支，`refresh` 只报告原因。首次抓取（如 `no_proof` → 缺产物）仍照常 block，那是新信息。已在冒烟库副本上重放：卡住的验证任务从「blocked + 2 个重复 Hold」变为 queued、Hold 全部解除。只影响失败原因为 `missing_business_artifact` / `missing_deliverable` / `non_reviewable_artifact` / `no_proof` 的任务；`invalid_business_artifact`（如 JSON 损坏）本来就会直接重跑。

- **中文 ASCII 引号破坏 `business-artifact.json`**：运行完成后若产物文件不能解析，同一 agent 做一次 Artifact Syntax Repair（只给 workspace 读写、2 分钟、告知解析错误）；runtime 要求修后能解析且去掉引号/转义/标点/空白后内容一致，否则还原原文件、照常停在 `invalid_business_artifact`（ADR 0028）。结构化输出契约走不通：codex `--output-schema` 是 strict 模式，拒绝自由结构的 `payload`（已实测）。真实 claude-code 修复冒烟里那份坏产物：22 秒，只在两处引号前加了反斜杠。

冒烟发现、未修（待讨论）：
1. **Execution Brief 超时被错记成任务超时**：brief 限 60s，失败时 `agentResult = preparation.result`，记成 `timeout after 5m` 并升级到 10m 档（`main` 上已有）。另见 claude-code 的 brief 回复满足 schema 但内容全是「测试」占位。
2. **draft 公司的任务被派发**：`fetchQueuedTasks` 不看公司状态，激活前已开始运行（`main` 上已有）。
3. 联网调研在 medium 档（300s）偏紧：同一任务一次 273s 完成、一次 300s 超时。

### 3) 收紧契约、删掉兼容层（删库之后就没有旧数据要照顾了）
- `payload.actions` 改为**必填**（缺失即交付物无效），然后**整段删除** `automaticAcceptance.ts` 里的 `FORBIDDEN_RISK_PATTERNS`（约 70 条正则）与相关测试。代价：十几处测试 fixture / mock agent 要补 `actions: []`。
- 删除 ADR 0017 的一次性迁移 `reviewReconciliation.ts` 及其 `runtime_state` 标记。
- 视情况清理更早的兼容层（`businessArtifact.ts` 的 legacy artifactType 分类、`founderDecision.ts` 的 legacy `recommendation` 字符串、`ceoOffice.ts` 的 legacy plan snapshot 视图、`outcome_summary` 兼容字段）。价值递减，别为清理而清理。

### 4) 拆分触发器改为规划声明（最后一处关键词驱动行为）
现状：`scheduler.ts` 的 `isLargeDepartmentTask` 用「proofSchema 是 landing-page-file/deployment」+「标题或描述含 prototype」+「含 validate 或 deployment」判断是否拆分；而 `createCompany.ts` 的 `withPrototypeGuidance` 又会给所有 `landing-page-file` 任务追加含这些词的指导语——**结果是这类任务必然被拆**（②b 的端到端测试里可以直接观察到）。
方向：由 blueprint 显式声明是否拆分/拆成什么（与 ②b 的 `verification` 同一种做法），runtime 不再从文本推断。注意：验证职责任务已经禁止被拆（ADR 0025），改造时要保留这条。

### 5) ⑤ 展示层
- 页面显示当前真实阻塞原因与可执行入口（现在部门页的「查看 CEO 待办」按钮在某些状态下不出现，未在浏览器中复现过根因）。
- 同一操作/主体不重复绘制。
- **产物被退回时刷新下游**：排队/等待中的消费者重新停住并给出具名原因；运行中的在交付时由收尾逻辑按版本对应拦下；已完成的记「输入已失效」的提示。这一项是与用户商定放到 ⑤ 的。

---

## 7. 需要用户拍板的问题

1. 第 2 项真实冒烟现在就做吗（会真实调用 CLI、产生真实 agent 运行与费用）？
2. 第 3 项的「`actions` 缺失即无效」是否照此执行？（如果第 2 项显示真实模型常漏，可能要先上结构化输出契约。）
3. 第 4 项拆分声明放进 blueprint 的哪一层：任务级 `decomposition: null | {...}`，还是由部门在派发时声明？

---

## 8. 已知限制（都写在各自 ADR 的 Consequences 里）

- 动作声明是 agent 自述，runtime 不核验真伪；真正的拦截仍是能力授权 + 派发前 Founder Approval。
- 未声明目标的失败检查会退回全部目标（保守策略）。
- 版本对应按 artifact ID 判断；文件变了但没有新产物的情况检测不到——这正是父任务返工改走内部链路的原因。
- 已消费旧产物的下游不回滚（⑤ 的第三项处理“标识失效”）。
- 声明 `verification: null` 却实际在做验证的任务不受保护；契约只能强制「说清楚」，不能保证「说得对」。
- 部门拆分目前只支持一层父子结构。

---

## 9. 常用命令与工作方式

```bash
pnpm typecheck && pnpm test && pnpm lint      # 提交前
pnpm vitest run apps/server/src/runtime/departmentVerification.test.ts   # 单文件
pnpm smoke:mock                                # 注意：基线上即失败（SSE），与本次改动无关
```

- 数据库在 `.auto-crop/state.sqlite`（WAL）。排查时**读日志和数据库，不要从截图推测**：日志在 `.auto-crop/companies/<companyId>/logs/`。
- 用户的工作方式：先讨论方案再实施；改动要做到根因层面并配回归测试；每片完成后会让 Codex 独立复审，复审意见通常值得当真（本次由它发现了 `final_report` 绕过、manifest 可被 agent 改写、旧版本失败退回新版本、返工非原子四个真实缺陷）。
- 提交信息写清楚「为什么」，并附 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
