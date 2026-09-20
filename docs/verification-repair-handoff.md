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

1. **不要再加关键词判断。** 描述风险 ≠ 执行风险动作；谁是验证者、要验什么、做了什么动作，都由声明决定。拆分触发器已在 ADR 0029 改为规划声明；剩下的文本推断是 proof schema 归一化（它只决定记录哪个 schema）。
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
- 第二轮（修复后）补齐了剩下的链路：CEO 规划链与部门链各走了一次完整的「验证失败 → 返工 → 重新验证 → 通过」；两次重新验证的裁决都绑定返工后的新版本，被退回的旧版本不再是当前版本；返工期间已排队的下游被重新停住，旧的创始人决策没有流到下游；子任务全程内部交付，父任务汇总后验收；验证任务没有被拆分（ADR 0025 的保护生效）；两次 `inconclusive` 都停住上报，没有放行。

冒烟发现、已修：
- codex 沙箱按 `run_command` 选 `workspace-write`，导致「可写不可跑命令」的授权以只读启动，写不出产物文件（`cliAgent.ts` 的 `codexSandboxForGrant`，ADR 0021 已补说明）。
- **`recover_task` 对无效产物原地打转**：`recoverProofIfPossible` 在任务已停在 `invalid_business_artifact` Hold 上时，重新抓到的产物仍不可审就返回 `still_unreviewable`——不写新产物、不再 block、不开第二个 Hold；`recover` 于是走重跑分支，`refresh` 只报告原因。首次抓取（如 `no_proof` → 缺产物）仍照常 block，那是新信息。已在冒烟库副本上重放：卡住的验证任务从「blocked + 2 个重复 Hold」变为 queued、Hold 全部解除。只影响失败原因为 `missing_business_artifact` / `missing_deliverable` / `non_reviewable_artifact` / `no_proof` 的任务；`invalid_business_artifact`（如 JSON 损坏）本来就会直接重跑。

- **验证快照只给摘要、不给文件**：快照原先从生产者**任务**的 `artifactWorkspacePath` 取文件，而这个字段只有部门拆分出的子任务才有；CEO 规划、未拆分的任务（调研、简报）因此只交出产物记录。第二轮冒烟里简报验证者 4 条要求全部 `not_run`、裁决 `inconclusive`、公司停住。改为抓取时把产出工作区记在**产物**上（`deliveryWorkspacePath`，runtime 写、agent 不能声明），快照从产物取；没有记录来源的交付直接具名失败，不再静默只给记录（ADR 0023 已补记）。旧产物没有这个字段，按约定不做兼容，会走具名失败。
- **中文 ASCII 引号破坏 `business-artifact.json`**：运行完成后若产物文件不能解析，同一 agent 做一次 Artifact Syntax Repair（只给 workspace 读写、2 分钟、告知解析错误）；runtime 要求修后能解析且去掉引号/转义/标点/空白后内容一致，否则还原原文件、照常停在 `invalid_business_artifact`（ADR 0028）。结构化输出契约走不通：codex `--output-schema` 是 strict 模式，拒绝自由结构的 `payload`（已实测）。真实 claude-code 修复冒烟里那份坏产物：22 秒，只在两处引号前加了反斜杠。

冒烟发现、未修（待讨论）：
1. **draft 公司的任务被派发**：`fetchQueuedTasks` 不看公司状态，激活前已开始运行（`main` 上已有）。
2. 联网调研在 medium 档（300s）偏紧：第二轮里每个 claude-code 联网任务第一次运行都在 300s 超时，升到 10 分钟档后才完成；第四轮里调研任务连 10 分钟档也超时，转 `needs_replan`，公司停住。
3. claude-code 的 brief 回复满足 schema 但内容全是「测试」占位——结构化输出契约只保证形状，不保证内容。

已修（ADR 0032，失败归属）：
- **Execution Brief 超时被错记成任务超时**：brief 限 `min(任务预算, 60s)`，其结果原先被当成整次运行的结果，记成 `timeout after 5m`，还会升级预算再跑一次同样 60s 上限的 brief，长档下甚至会把任务推向 `needs_replan`。现在按 brief 自己的预算报告、不升级、不作为重新规划的依据。
- **额度用尽被记成 agent 失败**：新增 `agent_quota_exhausted` 失败原因与同名 Hold（出路：额度恢复后重跑，或重新规划），且不计入 Bounded Recovery 的 3 次上限——否则一次额度中断就把任务推到只能重新规划。信号由 adapter 读 CLI 自己的输出（两个 CLI 都没有退出码或结构化字段），已知的误判方向在测试里都钉住了。

### 3) 收紧契约、删掉兼容层（删库之后就没有旧数据要照顾了）
- `payload.actions` 改为**必填**（缺失即交付物无效），然后**整段删除** `automaticAcceptance.ts` 里的 `FORBIDDEN_RISK_PATTERNS`（约 70 条正则）与相关测试。代价：十几处测试 fixture / mock agent 要补 `actions: []`。
- 删除 ADR 0017 的一次性迁移 `reviewReconciliation.ts` 及其 `runtime_state` 标记。
- 视情况清理更早的兼容层（`businessArtifact.ts` 的 legacy artifactType 分类、`founderDecision.ts` 的 legacy `recommendation` 字符串、`ceoOffice.ts` 的 legacy plan snapshot 视图、`outcome_summary` 兼容字段）。价值递减，别为清理而清理。

### 4) 规划契约三片——已完成（2026-09-20）
一起做掉的三件同类事，都是「runtime 不再从文本或 schema 猜规划意图」：
- **拆分改为规划声明**（ADR 0029）：blueprint 任务必填 `decomposition`（`null` 或 `{ template: "define_execute_validate" }`）；删除 `isLargeDepartmentTask` 与 `inferValidationDependencies`；schema 拒绝「既验证又拆分」和未知 template。原型指导语保留（拆分不再读文本，它就只是关于 proof 形态的建议）。
- **消费者等验证结论**（ADR 0030）：`resolveDependencyReadiness` 要求每个声明的验证者对「即将被消费的那一版产物」有通过且当前的裁决；验证者自身豁免；验证者被阻塞时消费者具名阻塞。
- **本地网络能力**（ADR 0031）：新增 `local_network`，由 `local-url`/`screenshot` 触发，按 `run_safe_command` 授权；codex 翻译成 `sandbox_workspace_write.network_access`。实测：codex 没有它绑不了 127.0.0.1，有它可以；claude-code 的 Bash 本来就能绑且无法收回——同一份授权在两个 CLI 上含义不同，这点已记入 ADR。

真实规划冒烟验证（两轮，各 3 份规划，`pnpm smoke:real-planning`）：字段 6/6 都填了，解析全过；但**没有一个任务声明拆分**。第一版提示词写的是「任务大到需要拆时声明」＋任务类型清单，第二版改写成一条判定原则（「评判对象是它构建并运行出来的东西，而不是它写下的推理」，不含 proof schema 名与类型清单），结果不变。

结论：模型不是漏填，而是**把拆分表达在规划层**——用独立任务加声明验证者，而不是部门三段模板。例如 codex 英文规划的 `build_cleaning_prototype` → `create_realistic_samples` → `run_validation_checks` → `verify_validation_outputs`（5 条必验要求），claude 中文规划的 `eng_build_site` → `eng_verify_site`（8 条要求）。配合 ADR 0030（消费者等裁决），这种形状给出的保障与部门拆分基本等价；部门模板只多两样：Define 阶段在运行时产出更细的必验要求，以及三段之间是内部交付、不进 CEO 审核。

与用户确认的处理（2026-09-20）：**保持 opt-in，不再改提示词、也不按 proof schema 强制拆分，更不把决定移交给部门**（部门在派发时判断，等于重新引入刚删掉的 runtime 推断，且与规划层表达重复）。若后续真实运行中长期无人声明，再单独立项评估是否废弃部门三段模板（它承载 ADR 0007/0024/0026 的机制，改动大）。

提示词写法上的教训（借鉴 Cumora 的 anti-pattern「Don't accrete scenario examples in the prompt」）：规则写成一条可判定的原则，不要堆场景条款或类型清单——前者会让模型在同构场景上变差，也会让规划契约和 proof schema 名字重新耦合，正是 ADR 0029 删掉 `isLargeDepartmentTask` 要避免的。

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
