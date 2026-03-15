# Braintrust Review System PRD

> Current implementation status and code mapping now live in [2026-03-15-openclaw-control-plane-architecture.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-openclaw-control-plane-architecture.md) and [2026-03-15-control-plane-handover.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/handovers/2026-03-15-control-plane-handover.md).

## 1. 文档目标

本 PRD 定义 Braintrust Review System 的第一阶段产品能力。目标是把现有的松散审查链路统一收进控制平面，解决以下问题：

- 审查材料经常缺失
- reviewer packet 依赖人工脚本落盘
- 同一 incident 被重复入队
- chief 长时间停在等待前
- 审查结束后没有明确下游接手

本 PRD 的目标不是重新定义全部审查哲学，而是把审查流程变成可执行、可审计、可恢复的运行时子系统。

## 2. 角色与席位

### 2.1 `architect`

负责架构可行性、系统边界、集成代价、结构风险。

### 2.2 `critic`

负责风险、失败模式、可绕过点、合规与脆弱性。

### 2.3 `innovator`

负责替代方案、简化路径、增效方向和能力扩展。

### 2.4 `braintrust_chief`

负责汇总 reviewer packets，形成最终裁决，并推动下游动作。

### 2.5 边界

上述四个席位继续保留为独立 Agent，但它们不再依赖各自会话外的隐式上下文。审查创建、材料打包、分发、回写和裁决都必须在控制平面中可见。

## 3. 审查对象

第一阶段审查对象包括：

- `governance review`
- `design review`
- `change review`
- `incident review`

不要求第一阶段覆盖所有历史方案审查场景，但新的高风险治理、关键设计、共享变更和 incident 必须进入该系统。

## 4. 审查任务对象

### 4.1 Review Task

`review_task` 是控制平面中的正式对象，至少包含：

- `review_id`
- `review_type`
- `target_id`
- `status`
- `priority`
- `created_by`
- `required_seats`
- `seat_status`
- `chief_status`
- `next_action`

### 4.2 Submission Bundle

`submission_bundle` 是审查的最小输入。审查任务没有材料包就不能派发。材料包至少包含：

- 目标摘要
- 原任务或变更链接
- 关键背景
- 影响范围
- 相关 incident/analysis 路径
- 期望 reviewer 输出格式
- 下游预期动作

### 4.3 Review Packet

`review_packet` 是单席位结构化回写对象，至少包含：

- `review_id`
- `reviewer_id`
- `verdict`
- `findings`
- `conditions`
- `risks`
- `system_impact`
- `recommended_next_action`
- `generated_at`

### 4.4 Chief Decision

`chief_decision` 是审查结果的唯一汇总对象，至少包含：

- `review_id`
- `verdict`
- `decision_summary`
- `required_actions`
- `next_owner`
- `next_stage`
- `decision_at`

## 5. 审查流程

### 5.1 创建

控制平面创建审查任务时，必须同步创建 `submission_bundle`。如果材料未齐，不允许进入 `dispatched`。

### 5.2 打包

材料打包由控制平面完成，不再依赖 reviewer 从会话或 workspace 猜测材料位置。打包后的 bundle 是 reviewer 唯一正式输入。

### 5.3 派发

审查席位派发顺序：

- 创建 review task
- 验证材料包完整
- 记录 seats
- 派发到 `architect`、`critic`、`innovator`
- 进入 `in_review`

### 5.4 席位回写

每个 reviewer 完成后必须直接写回控制平面的 packet 接口。审查不允许仅输出“请执行脚本写 packet”。

### 5.5 Chief 裁决

`braintrust_chief` 在达到裁决条件后汇总 packets，生成 `chief_decision`。裁决条件至少包括：

- 所需 reviewer packets 已齐
- 或已达到明确的降级裁决门槛
- 或已命中超时裁决策略

### 5.6 推进下游

审查结束不是停在结论，而是必须推进下游动作。允许的下游动作包括：

- `rework`
- `approve`
- `block`
- `escalate`
- `publish`

没有 `next_action` 和 `next_owner` 的 chief decision 不能算完整结束。

## 6. 停滞与异常

### 6.1 材料缺失

若 `submission_bundle` 不完整，则 review task 必须停在 `blocked`，不得派发 reviewer。

### 6.2 Packet 缺失

若 reviewer 会话完成但未回写 packet，则 review task 标记为 `packet_missing`，进入恢复策略，不允许 chief 静默汇总。

### 6.3 重复 Incident

相同 `incident/source` 在未终结前只允许一个活跃 `review_task`。后续事件作为附加证据追加，而不是新建平行审查单。

### 6.4 席位超时

任一 reviewer 超时未回写时，控制平面必须标记：

- `seat_timeout`
- `stalled_state`
- `reclaim_eligible`

并允许 `luban` 执行 reclaim 或 redispatch。

### 6.5 Chief 超时

chief 长时间未裁决时，也必须进入 `recovery_pool`，由 `luban` 触发提醒、重派或升级。

## 7. 下游交接

### 7.1 Rework

若 verdict 为返工，必须写清：

- 回退阶段
- 返工原因
- 修复要求
- 责任人

### 7.2 Approve

若 verdict 为通过，必须显式指定：

- 下游接手人
- 下游阶段
- 生效条件

### 7.3 Block

若 verdict 为阻断，必须说明阻断原因、解除条件和下一次触发条件。

### 7.4 Escalate

若需要升级，必须指定升级对象和升级原因，不允许停在抽象的“等待 chief”。

### 7.5 Publish

若审查对象是共享变更，则通过后只能推进到 `publish gate`，不能直接默认生效。

## 8. 成功标准

Braintrust Review System 第一阶段视为成功，至少应满足：

- 新审查必须通过控制平面创建
- 审查材料不再依赖 reviewer 自行寻找
- reviewer packet 直接回写到控制平面
- chief 决议必须带下游动作
- 相同 incident 不重复堆积多个活跃审查单
- 任一停滞审查都能被 `luban` 识别并进入恢复

## 9. 与控制平面的关系

本 PRD 是控制平面的审查子系统定义。控制平面的任务池、租约、版本锁和发布口规则，由 [`2026-03-14-openclaw-control-plane-prd.md`](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-openclaw-control-plane-prd.md) 定义；本 PRD 只补充审查子系统专属对象和流程。

## 10. 依赖文档

- [`2026-03-14-openclaw-control-plane-prd.md`](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-openclaw-control-plane-prd.md)
- [`2026-03-14-constitution-runtime-mapping-spec.md`](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-constitution-runtime-mapping-spec.md)
