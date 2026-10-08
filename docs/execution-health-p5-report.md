# P5：有限恢复与 Codex 初步观测

日期：2026-10-08。分支：`execution-settlement-and-observation`。

本轮交付 `brief-only-v1` 有界自动恢复、持久续做来源、故障测试和隔离真实 Codex 样本。默认仍为 `observe` / `report_only`。**短样本验证完成，真实长任务阈值校准及全功能默认启用门槛未达**，不能把这份报告理解为全部 adapter 的生产验收。

## 恢复范围与理由

仅接收当前 Task **第一次 run** 在简报阶段发生的 `agent_failed`，且全部满足：

- 公司 active、Task failed，只有一个 `runtime_interrupted` Hold；原 run 是最新且 epoch 仍匹配。
- adapter 明确确认终止；持久 invocation 只有一段简报和可选的本地 finalizing，均已关闭。没有正式执行或修复。
- 原 run 持久记录 Codex/Claude CLI 的 strong 启动隔离。历史未知、自定义命令和 compatible 模式不进入自动恢复；新增列不为旧 run 补造证据。
- 原 run 使用 `budget-v1`，已经结算，无预算停止请求，Task 有未预留余额，无活动 run、Task 锁或工作区 claim。
- 依赖已就绪，没有达到现有三次尝试上限。此前存在其他 run 的 Task 必须人工检查外部副作用与部分产物。

简报使用既有 `noToolGrant`；Claude 禁用工具，Codex 使用只读沙箱、关闭搜索和用户配置。这里没有声称 Codex 具备独立的“禁用所有工具”开关，也不覆盖绕开进程组的后代进程。CLI 自然退出只有在 POSIX 进程组已不存在时新增明确终止证据；权限不明、仍有同组进程或不支持的平台保持未知。

恢复条目以 Task 唯一、sourceEventId 唯一持久保存。每任务至多一次自动恢复，等待 30 秒（保守操作初值，未经统计调优）；即使清理历史事件、重启、重复投递或重置普通尝试计数，也不会重新获得自动恢复次数。30 秒后由 Supervisor 的周期扫描重新校验所有条件，并比较任务、交付契约、依赖产物身份、权限模式及 Founder Vision。变化时记录 `recovery_blocked`，保留现有人工出口。

决策、队列、重新排队和相应事件各自在同库事务中提交。去重只忽略 sourceEventId 冲突，存储故障会传播并回滚。第二连接竞争先取得 SQLite 写锁再读取条件。wake 不是必要条件；周期扫描读取持久队列。

新 run 保持原 Task 身份、累计授权与消耗，调度器仍检查权限、审批、依赖及工作区独占。恢复清单保留 `resumeFromRunId`、sourceEventId、原任务/契约/输入、日志引用和下一步，条目在新 run 认领事务中绑定 `nextRunId`。本子集不采纳或发布任何候选文件，`verifiedSteps`、`candidateFiles`、`externalActions` 为空；已有文件明确未验证。因此没有把缺失的文件哈希伪装成已完成的通用产物续做机制。

正式执行、修复、未知外部写入结果、quota、预算停止、时钟不可信和 Worker 丢失均不自动重跑。部分产物验证仍走原有人工恢复/验证协议。

## 开关与回退

在隔离项目同时设置：

```bash
AUTO_CROP_EXECUTION_POLICY=budget-v1 AUTO_CROP_RECOVERY_MODE=brief-only-v1 pnpm --filter @auto-crop/cli start
```

缺省 `AUTO_CROP_RECOVERY_MODE=report_only`。非法值，或自动恢复与 observe 混用，会在启动 Worker 前报错。程序内部直接创建 Supervisor 的调用者需要显式传入 `recoveryMode`。

`GET /api/companies/:id/execution-events` 的 `recoveries` 返回队列状态、来源、新 run 与阻止理由；不外发原始日志或包含任务正文的完整清单。完整清单在本地 `execution_recoveries.manifest` 中。

回退先暂停公司新派发并排空/停止活动执行，关闭 Supervisor，再设置 `AUTO_CROP_RECOVERY_MODE=report_only`。pending 条目保留但不执行；已进入普通 queued 的任务必须在暂停状态下确认是否继续或取消，切换开关不会撤销已经排队的工作。保留 `execution_recoveries` 和恢复决策作为永久去重依据，不删表。回退 observe 的预算限制见 [P4 操作说明](execution-budget-opt-in.md)。

## 真实样本

用户明确授权 Codex，最多 10 次短执行。本轮恰好启动 10 次：首次受限沙箱初始化失败，随后正常环境中 9 次。CLI `0.147.0`，adapter 默认模型 `gpt-5.5`，macOS。本轮未调用 Claude，未访问项目的用户运行库。

| 样本 | 阶段 | 结果 | 耗时 ms | 最长观测静默 ms |
| --- | --- | --- | ---: | ---: |
| 初次启动 | 简报 | CLI 状态库只读 / IPC 初始化失败，未取得模型回复 | 1866 | 1843 |
| 1 | 简报 | 结构化 JSON 验证通过 | 14116 | 5250 |
| 2 | 正式文件写入 | JSON 文件验证通过 | 23041 | 10808 |
| 3 | 等价语法修复 | 移除尾逗号，JSON 验证通过 | 31410 | 10766 |
| 4 | 简报 | 结构化 JSON 验证通过 | 16214 | 13007 |
| 5 | 正式文件写入 | JSON 文件验证通过 | 20619 | 10425 |
| 6 | 等价语法修复 | 移除尾逗号，JSON 验证通过 | 33769 | 7384 |
| 7 | 简报 | 结构化 JSON 验证通过 | 19629 | 10664 |
| 8 | 正式文件写入 | JSON 文件验证通过 | 22885 | 8108 |
| 9 | 主动取消 | 1500ms 发出取消，1506ms 返回 cancelled，终止确认 true | 1506 | 1410 |

取消样本标记 censored，不计为正常完成耗时。自然完成样本的采集进程启动于本轮自然退出证据修复前，因此终止确认字段为 null；不事后改写。新增自然退出证据另由真实本地子进程测试验证。

以上为真实 CLI 的分阶段短调用，修复使用等价 JSON 小任务，不是完整产品任务的长链运行。8 次成功都超过采样记录采用的 **1 秒缩放旧上限**；这只说明缩放案例成功，不证明超过生产原始 120 秒或更长预算。真实样本中没有覆盖生产级长静默、网络瞬断后成功恢复、完整 scheduler 的真实模型续做或 p99。

最长正常静默 13.007 秒，最大成功耗时 33.769 秒。样本太少且任务简单，不据此缩短 `quietAfterMs=60000`、`suspectAfterMs=45000`、`lostAfterMs=90000`，不调整 60 秒简报预算或宣称阈值已校准。Worker 心跳与输出静默是不同信号，不能用这些字节间隔推断 Worker 丢失。

采样命令（会调用付费/额度模型，必须单独授权）：

```bash
AUTO_CROP_ALLOW_REAL_SAMPLES=codex pnpm sample:execution-health
```

脚本最多执行 9 次，每次上限 60 秒；遇到非预期失败立即停下，不自动重试。重新运行会产生新的调用，不能在本轮 10 次额度之外直接再跑。

原始日志与 `summary.json` 保存在本机临时目录，不提交仓库：

- 首次初始化失败：`/var/folders/92/kxgfp5k13f5_gmm4q8m_hr5c0000gn/T/auto-crop-p5-codex-43tUKC`
- 9 次正常环境采样：`/var/folders/92/kxgfp5k13f5_gmm4q8m_hr5c0000gn/T/auto-crop-p5-codex-MFZBkm`

目录权限 0700，日志/摘要 0600。仅用于本轮核查，最迟 2026-10-15 由操作者删除；系统可能提前清理临时目录。本轮没有建立自动清理任务。仓库仅保留以上无原始正文的摘要。

## 验证与剩余门槛

本轮最终验证：`pnpm test` **64 文件 / 921 项通过**；`pnpm typecheck`、`pnpm smoke:mock`、`git diff --check` 通过。`pnpm lint` 退出 0，但当前子包没有独立 lint 脚本，不能据此声称额外静态规则已检查。

自动化覆盖真实本地进程失败、Supervisor 延迟恢复、独立连接接管、重复投递、来源绑定、累计预算不重置、取消/暂停/权限/契约变化、旧 epoch、锁/隔离阻止、停止预算、quota、只报告默认及事务注入故障。原有预算、进程树取消、Worker 退出、真实 start 冒烟继续作为跨模块回归。

持续运行容量/保留期策略、Claude 等其他 adapter 样本、真实生产级长静默/长任务、通用部分文件哈希清单及外部系统幂等确认仍未达标。默认启用与扩展自动恢复范围必须在这些对应门槛取得证据后进行。
