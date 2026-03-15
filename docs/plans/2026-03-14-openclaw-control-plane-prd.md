# OpenClaw Control Plane PRD

> Current implementation status and code mapping now live in [2026-03-15-openclaw-control-plane-architecture.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-openclaw-control-plane-architecture.md) and [2026-03-15-control-plane-handover.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/handovers/2026-03-15-control-plane-handover.md).

## 1. 文档目标

本 PRD 定义 OpenClaw 第一阶段的控制平面产品。控制平面不是普通 dashboard，也不是单纯的任务列表，而是系统任务、审查、治理变更和恢复动作的唯一真值源与操作面。

本 PRD 只覆盖最小规则内核，不重建全部历史团队，不直接承载所有宪章条款。第一阶段的目标是让系统能稳定回答以下问题：

- 任务是否已经开始
- 当前卡在哪个阶段
- 当前责任人是谁
- 下一个接手人是谁
- 任务是否停滞
- 是否存在返工、阻塞或升级
- 当前规则版本是什么
- 当前变更会影响哪些在途任务

## 2. 用户与角色

### 2.1 人类操作者

人类操作者是系统的最终服务对象和最终拍板人。人类通过控制平面查看系统状态、批准高风险变更、查看审查裁决、手动停止或恢复任务。

### 2.2 Main

`main` 是轻入口，不是复杂任务主控。它只负责：

- 接收新任务
- 把任务登记到控制平面
- 标记任务来源、优先级、类型和是否需要审查
- 在需要时触发升级

`main` 不直接分发复杂任务，不直接改共享规则，不直接编排团队内阶段。

### 2.3 LuBan

`luban` 是治理调度器，不是总执行者。它只负责：

- 领取治理与恢复任务
- 拆解复杂治理任务为阶段卡
- 检查任务和审查是否停滞
- 提交规则变更任务
- 触发回收、重派、恢复和升级建议

`luban` 不负责领取所有业务任务，不直接绕过发布口修改共享规则。

### 2.4 Braintrust

`braintrust` 是审查与裁决子系统，由 `architect`、`critic`、`innovator`、`braintrust_chief` 组成。Braintrust 只负责：

- 审查治理变更和关键任务
- 输出 reviewer packets
- 生成 chief decision
- 对高风险冲突和系统性问题做裁决

Braintrust 不承担日常任务分发，不直接作为运行态真值源。

### 2.5 KM

知识管理团队负责：

- 归档关键产物
- 维护 artifact index
- 保存失败样本和学习闭环证据
- 维护阶段交接中的摘要、链接、版本和路径

KM 不直接管理运行中任务，不直接改共享配置。

### 2.6 RD Claw

第一阶段采用双 Claw 拓扑。研发 Claw 是执行面，只负责从控制平面领取 `team-rd` 的业务任务，并把状态和交付回写到控制平面。

## 3. 系统边界

### 3.1 第一阶段边界

第一阶段系统由以下单元组成：

- 治理 Claw：`main`、`luban`、`braintrust`、`km`
- 研发 Claw：`team-rd`
- OpenClaw Control Plane
- 共享工作流/调度底座

### 3.2 非目标

第一阶段不做以下事情：

- 不恢复所有历史团队的活跃执行链
- 不让旧的 `pangu`、`proposal`、`smart3d`、`presales` 自动继续分派任务
- 不把整套宪章一次性全部变成运行时代码
- 不把 Discord/Telegram 直接当真值源
- 不允许多个 Claw 各自持有一套活跃任务真值

### 3.3 外部入口

第一阶段允许的入口包括：

- Web 控制平面
- 治理 Claw 内部调用
- 后续的 Discord/Telegram ChatOps

所有入口都只负责创建命令或任务，不直接写最终状态。

## 4. 核心对象

### 4.1 Parent Task

`parent_task` 是复杂任务的母任务，记录：

- `task_id`
- `title`
- `intent`
- `source`
- `priority`
- `task_type`
- `assigned_domain`
- `workflow_version`
- `routing_version`
- `status`
- `current_stage`
- `created_by`
- `created_at`

### 4.2 Stage Card

`stage_card` 是母任务下的阶段单元，记录：

- `stage_id`
- `parent_task_id`
- `stage_type`
- `owner`
- `owner_team`
- `status`
- `started_at`
- `updated_at`
- `next_owner`
- `handoff_note`
- `rework_target`
- `stalled_state`
- `lease_expires_at`

### 4.3 Change Task

`change_task` 是共享规则、路由、状态机、配置和系统结构变更的唯一发布单元，记录：

- `change_id`
- `change_scope` (`local|shared|global`)
- `proposed_by`
- `impact_targets`
- `required_review`
- `publish_window`
- `publish_status`
- `rollback_plan`

### 4.4 Artifact Index

`artifact_index` 是关键产物索引，记录：

- `artifact_id`
- `task_id`
- `stage_id`
- `artifact_type`
- `summary`
- `path`
- `version`
- `producer`
- `created_at`

### 4.5 Runtime Health

`runtime_health` 用于表示任务、阶段和审查的运行态，记录：

- `heartbeat_status`
- `last_heartbeat_at`
- `last_progress_at`
- `stalled_state`
- `health_hint`
- `control_flags`

### 4.6 Control Audit

`control_audit` 记录每一次治理动作、人工介入、停止、恢复、重试和发布。

## 5. 任务池

控制平面必须将任务分为不同池，而不是一个总列表。

### 5.1 `intake_pool`

新任务登记池。所有复杂任务先进入这里，等待分类和复杂度判断。

### 5.2 `team_dispatch_pool`

团队业务任务池。业务任务按归属团队进入该池，由对应团队负责人领取并做团队内拆解。

### 5.3 `governance_pool`

治理任务池。只允许 `luban` 领取，包括：

- 系统变更
- 路由调整
- 状态机变更
- 共享配置调整
- 故障恢复
- 冲突仲裁准备

### 5.4 `review_pool`

审查任务池。只允许 Braintrust 席位领取，用于治理审查、设计审查、变更审查和 incident 审查。

### 5.5 `recovery_pool`

恢复任务池。用于停滞、超时、返工、失败、重派和恢复流程。默认由 `luban` 处理，必要时升级到 Braintrust。

## 6. 分发模型

### 6.1 分发原则

控制平面负责仲裁分发，不依赖某个 Agent 自行拍脑袋。分发必须先分类，再发领取权。

### 6.2 分发规则

- `main` 只做登记，不做最终分发
- 团队业务任务由团队负责人领取
- 治理和恢复任务由 `luban` 领取
- 审查任务由 Braintrust 领取
- 共享规则变更必须以 `change_task` 形式进入发布管道

### 6.3 领取权

同一时刻一个任务或阶段只能存在一个有效租约。租约至少包括：

- `holder`
- `resource_scope`
- `started_at`
- `lease_expires_at`
- `interruptible`

## 7. 强规则

### 7.1 唯一真值源

活跃任务、活跃审查、活跃变更和活跃恢复的最终状态只能写入控制平面。旧 JSON、旧 queue、旧 cron 队列只能作为历史镜像和审计来源。

### 7.2 唯一发布口

共享规则、路由、状态机和全局配置变更不得直接由任一 Agent 生效。必须经过：

`change_task -> impact_check -> review -> publish -> verify`

### 7.3 规则版本锁

运行中任务必须绑定启动时的 `workflow_version` 和 `routing_version`。新规则默认只影响新任务，不允许静默切换在途任务，除非命中明确的 P0 抢修条件。

### 7.4 租约与加锁

任何运行中任务、阶段卡和审查单必须持有租约。涉及 `shared` 或 `global` 资源的变更必须先做冲突检查，再决定并行、排队或抢占。

### 7.5 交接记录

阶段推进不能只改状态，必须同时写入：

- 当前完成摘要
- 输出是什么
- 交给谁
- 下游需要什么
- 是否需要返工

无交接记录不得推进到下一阶段 `started`。

### 7.6 返工条件

返工不是模糊失败，而是明确回退到指定阶段。返工时必须写清：

- `rework_target`
- `rework_reason`
- `requested_by`
- `required_fix`

## 8. 关键界面

### 8.1 总览

展示：

- 活跃任务数
- 活跃审查数
- 停滞数
- 待发布变更数
- 高风险告警

### 8.2 任务详情

展示：

- 母任务
- 阶段卡
- 当前责任人
- 下一接手人
- 规则版本
- 交接与返工轨迹
- 相关产物
- 会话跳转

### 8.3 变更发布

展示：

- 变更范围
- 受影响任务
- 变更窗口
- 审查状态
- 发布状态
- 回滚计划

### 8.4 停滞告警

展示：

- 疑似停滞
- 已停滞
- 等待输入超时
- 审查席位超时
- 租约即将到期

## 9. 成功标准

控制平面在第一阶段视为成功，至少应满足：

- 复杂任务必须以母任务和阶段卡表示
- 系统能明确显示任务开始、停滞、交接、返工、完成
- `main` 不再直接承担复杂编排
- `luban` 不再充当业务任务总分发员
- Braintrust 不再依赖松散 review queue 作为唯一运行态
- 任何共享变更都有唯一发布口和发布审计
- 任何运行中任务都能回答自己绑定的规则版本

## 10. 依赖文档

本 PRD 依赖以下文档：

- [`2026-03-14-braintrust-review-system-prd.md`](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-braintrust-review-system-prd.md)
- [`2026-03-14-constitution-runtime-mapping-spec.md`](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-constitution-runtime-mapping-spec.md)
