# 执行预算策略：隔离试运行与回退

P4 允许显式启用 `budget-v1`；默认仍为 `observe`。当前证据来自本地真实子进程、模拟模型命令和临时 SQLite，尚不代表真实模型阈值已经验证。自动恢复仍为 report-only；真实 adapter 样本与默认启用门槛属于 P5。

## 先验证，再隔离启用

1. 运行 `pnpm smoke:execution-health`。它使用临时目录和本地模拟的模型命令，经过真实 start / Supervisor / Worker / adapter 链路，不调用付费模型。覆盖事务故障、重复投递、同 run 跨旧预算成功，以及硬停止后重启仍无余额。
2. 升级已有项目之前停止 Supervisor，确认 Worker 和 Agent 子进程已经结束。对 SQLite 做一致性备份，保留预算账本、授权记录和运行历史。可以先在备份副本上验证幂等迁移；迁移不为历史 run 补造预算。不能让旧版写入器和新版同时运行。
3. 第一次试运行使用新的隔离项目、工作区和公司。备份库可能含原项目的绝对工作区路径，不应直接启动它来充当隔离试运行。模型调用应使用已有授权并限定任务数量。
4. 在选定的隔离项目根目录，通过本仓库的 CLI 启用策略：

```bash
AUTO_CROP_EXECUTION_POLICY=budget-v1 pnpm --filter @auto-crop/cli start
```

CLI 使用原有 `INIT_CWD` / 当前工作目录解析项目根目录；从其他目录调用时先确认目标路径。`start` 与 `supervise` 都有独立 Supervisor；直接调用程序内部 `startAutoCrop` 不会替调用者创建外层监督。

可选的 `AUTO_CROP_EXECUTION_BUDGET_JSON` 接受下表字段，单位均为毫秒。未知字段、非正安全整数、阶段关系无效或未知策略名会报错，不会静默回退。每个 run 认领时钉选快照，运行期间修改环境不会改变已有 run 或自动增加 Task 授权。

| 字段 | 默认值 | 含义 |
| --- | ---: | --- |
| runHardMs | 1200000 | 单次 run 从认领至最终提交的硬上限 |
| taskTotalMs | 2700000 | Task 跨 run 的累计授权 |
| briefMs / repairMs / finalizeMs | 60000 / 120000 / 60000 | 阶段上限 |
| checkpointMs / persistMs | 60000 / 5000 | 后续软检查点间隔 / 计量持久化间隔 |
| clockToleranceMs | 5000 | 墙钟与单调时钟偏差容忍度 |
| suspectAfterMs / lostAfterMs | 45000 / 90000 | Worker 心跳延迟 / 失联阈值 |
| quietAfterMs | 60000 | 输出转为未知进展的窗口，不是终止依据 |
| resumeGraceMs | 30000 | Supervisor 启动、跳时或长停顿后的探测宽限 |

`persistMs < suspectAfterMs < lostAfterMs`，且 `persistMs < runHardMs`。原有 `AUTO_CROP_AGENT_TIMEOUT_MS` / `AUTO_CROP_FORCE_AGENT_TIMEOUT_MS` 在新策略下影响软检查点，不能扩大硬预算；run 硬预算不得小于实际软检查点。Supervisor 默认每 5 秒扫描；短于扫描周期的测试阈值不会获得更高检测频率。

## 如何读取和操作

任务的执行面板展示阶段、最后一次独立健康判断及采样时间、累计消耗、预留未消耗时间、剩余额度、可分配额度、停止原因、终止等待和确认依据。消耗可能包含显式标出的保守估算；剩余额度包含当前 run 已预留但尚未消耗的部分，可分配额度不包含它。

- 静默且心跳新鲜显示进度未知，不直接判死；重复输出不购买更多时间。
- 健康结果由 Supervisor 写入。`GET /api/tasks/:id/execution` 只读取已持久化事实，打开页面或高频轮询不触发判定、续租或续时。
- 阶段/run/Task 预算耗尽后，使用 **授权续做**。追加分钟为 0 表示使用剩余额度；余额耗尽需要明确追加。必须填写理由。授权请求幂等，旧授权版本、其他未解决 Hold、活动执行或已取消状态会被拒绝。
- **取消任务** 有独立确认步骤。取消会撤销继续权限并触发真实取消链，不能被输出或后续授权撤销。若终止未确认，工作区保持隔离；人工确认终止后仍保持取消，不重新开放续做。
- 失联不等于进程已退出。Supervisor 只终止自己持有且启动身份匹配的 Worker；退出后保守结算并隔离可能仍有 Agent 写入的工作区。人工确认释放隔离必须基于真实终止证据，不自动补额度。

系统休眠不承诺检测 SLA。Supervisor 唤醒后先探测并留恢复宽限；Worker 自己无法重建时间依据时仍可按 `clock_untrusted` 保守停止、禁止该 owner 再派发。P4 不自动恢复这类 run，也不把休眠说成死锁。停止/确认或隔离后，经监督对账重启；不通过校正墙钟补充预算。

公司创建、最终报告和可选 Session 等 Task run 以外作业仍沿用原有策略，不能把本轮覆盖宣称为这些作业的完整监控。

## 回退 observe

1. 暂停新派发，等待预算 run 结束；必要时取消，并完成终止确认或保留隔离。关闭 Supervisor，确认相关进程情况。
2. 保留完整数据库，不删除 `task_budgets`、`run_budgets`、`budget_ledger` 或授权记录。
3. 设置 `AUTO_CROP_EXECUTION_POLICY=observe` 后重新启动。已有预算授权的 Task 在 observe 下保持禁止派发，不会获得新的旧策略额度；无预算记录的 Task 才走原策略。需要继续预算 Task 时重新显式启用预算策略并按合法 Hold 操作。
4. 若必须回退代码版本，先处理全部预算 run，并使用兼容该数据库的版本；旧版程序不认识预算约束，不能直接对同一个预算库继续调度。

长时间持续运行仍须完成观测/outbox 的保留期与容量策略；跨主机控制、完整 Agent 进程树控制、整机掉电后的自动拉起和 webhook 不在本次交付内。
