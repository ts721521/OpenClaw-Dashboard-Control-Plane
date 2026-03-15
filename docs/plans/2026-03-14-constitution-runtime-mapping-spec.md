# Constitution to Runtime Mapping Spec

> Use this spec for hard-rule intent. For current implementation status and code mapping, read [2026-03-15-openclaw-control-plane-architecture.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-openclaw-control-plane-architecture.md) and [2026-03-15-control-plane-handover.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/handovers/2026-03-15-control-plane-handover.md).

## 1. 文档目标

本规范把 OpenClaw 宪章和 Technical Brain Trust 中会进入第一阶段运行时的原则，映射成控制平面与审查子系统必须执行的硬规则。

本规范不是重新复述方法论，而是回答：

- 哪条原则进入运行时
- 它由谁强制执行
- 需要哪些字段
- 什么情况下通过
- 什么情况下阻断
- 应留下什么审计证据

## 2. 来源文档

本规范只从以下来源抽取会进入运行时的内容：

### 2.1 OpenClaw 宪章来源

- 角色边界
- 统一状态机
- 治理单元接入协议
- 契约与 Gate
- 自愈与恢复
- 版本与发布策略

### 2.2 Technical Brain Trust 来源

- 审查席位及职责
- 审查一致性与裁决
- 发布门禁
- 产物与证据纪律
- artifact 路径策略

## 3. 规则分类

第一阶段只抽五类运行时规则：

- 角色规则
- 任务规则
- 审查规则
- 变更规则
- 学习规则

每条规则必须以统一格式表示，禁止只写“按宪章精神执行”。

## 4. 统一格式

每条规则固定采用如下字段：

- `principle`
- `runtime_rule`
- `enforced_by`
- `required_fields`
- `pass_condition`
- `block_condition`
- `audit_evidence`

## 5. 第一批规则映射

### 5.1 不能绕过业务真相源

- `principle`: 业务真相源不可绕过
- `runtime_rule`: 任何标记为 `business_bound=true` 的任务，必须声明 `business_truth_source`，否则不能进入 `READY` 或 `DONE`
- `enforced_by`: Control Plane gate
- `required_fields`: `business_bound`, `business_truth_source`, `acceptance_criteria`
- `pass_condition`: 已声明正式业务真相源，且交付验证引用该来源
- `block_condition`: 仅有技术链结果、未声明正式业务来源、试图直接完成
- `audit_evidence`: `requirement_trace_report`, `business_truth_reference`, gate audit

### 5.2 技术完成不等于业务完成

- `principle`: 技术链成功不能冒充业务完成
- `runtime_rule`: `technical_done`、`script_passed`、`artifact_generated` 不能直接把任务推进到 `completed`
- `enforced_by`: Control Plane status gate
- `required_fields`: `technical_status`, `business_status`, `artifact_index`, `acceptance_result`
- `pass_condition`: 业务验收和产物证据都通过
- `block_condition`: 仅有技术成功，无业务验收
- `audit_evidence`: `acceptance_result`, `artifact_index`, `stage_handoff_record`

### 5.3 不懂先问

- `principle`: 理解不完整时不得瞎猜
- `runtime_rule`: 任务若命中 `missing_required_input` 或 `unknown_business_rule`，状态必须进入 `WAITING_INPUT` 或 `BLOCKED`
- `enforced_by`: Stage validation + reviewer validation
- `required_fields`: `required_inputs`, `missing_inputs`, `question_log`
- `pass_condition`: 输入齐全且关键约束已确认
- `block_condition`: 缺关键输入却继续执行
- `audit_evidence`: `input_validation_log`, `question_log`, `waiting_reason`

### 5.4 同类错误进入双环学习

- `principle`: 重复错误不能只修动作，必须修规则
- `runtime_rule`: 命中重复失败模式的任务或审查，必须生成 `error_review` 与 `rule_promotion_candidate`
- `enforced_by`: Recovery workflow + KM intake
- `required_fields`: `failure_type`, `error_review`, `rule_promotion_candidate`
- `pass_condition`: 失败样本已沉淀并进入学习闭环
- `block_condition`: 只修当前实例，不沉淀规则候选
- `audit_evidence`: `error_review`, `rule_promotion_candidate`, KM artifact index

### 5.5 共享规则变更必须走发布口

- `principle`: 共享配置不得被任意 Agent 直接生效
- `runtime_rule`: 所有 `shared` 和 `global` 范围变更必须创建 `change_task` 并通过 `impact_check -> review -> publish`
- `enforced_by`: Change gate + Braintrust review
- `required_fields`: `change_scope`, `impact_targets`, `publish_window`, `rollback_plan`
- `pass_condition`: 变更已审查、已确认影响、已进入发布窗口
- `block_condition`: 直接写共享配置、绕过审查或无回滚计划
- `audit_evidence`: `change_task`, `impact_report`, `chief_decision`, `publish_audit`

### 5.6 运行中任务绑定规则版本

- `principle`: 在途任务不能被静默切到新规则
- `runtime_rule`: 任务启动时必须记录 `workflow_version` 和 `routing_version`；共享变更默认不影响运行中任务
- `enforced_by`: Control Plane lease/version policy
- `required_fields`: `workflow_version`, `routing_version`, `lease_id`, `interruptible`
- `pass_condition`: 在途任务明确锁定版本，切换经批准
- `block_condition`: 无版本字段、静默切换、未评估影响即改
- `audit_evidence`: task snapshot, version binding log, publish audit

## 6. 角色规则

### 6.1 Main 轻入口规则

- `principle`: main 是入口，不是复杂任务主控
- `runtime_rule`: `main` 只能创建和登记任务，不可直接领治理任务或团队内阶段任务
- `enforced_by`: Dispatch policy
- `required_fields`: `created_by`, `task_type`, `assigned_pool`
- `pass_condition`: 任务已登记并正确进入任务池
- `block_condition`: main 直接跳过控制平面编排复杂任务
- `audit_evidence`: task creation audit, dispatch record

### 6.2 LuBan 治理规则

- `principle`: luban 负责治理调度，不负责全部业务分发
- `runtime_rule`: `luban` 只能领取 `governance_pool` 和 `recovery_pool` 的任务
- `enforced_by`: Pool assignment policy
- `required_fields`: `assigned_pool`, `task_type`
- `pass_condition`: 仅在治理和恢复池中工作
- `block_condition`: 领取普通业务交付任务
- `audit_evidence`: claim audit, pool history

### 6.3 Braintrust 审查规则

- `principle`: Braintrust 负责审查和裁决，不负责日常编排
- `runtime_rule`: Braintrust 仅处理 `review_task`，并通过 packet 和 chief decision 回写
- `enforced_by`: Review subsystem
- `required_fields`: `review_id`, `review_packet`, `chief_decision`
- `pass_condition`: 审查闭环完成并推进下游
- `block_condition`: 审查停留在口头结论或外部脚本中
- `audit_evidence`: review packet log, chief decision log

## 7. 任务规则

### 7.1 无契约不交接

- `principle`: 没有契约和证据不得进入下游
- `runtime_rule`: 阶段卡推进到下一阶段前，必须有交接记录和最小产物摘要
- `enforced_by`: Stage gate
- `required_fields`: `handoff_note`, `artifact_summary`, `next_owner`
- `pass_condition`: 下游能消费当前产出
- `block_condition`: 只有状态变化，没有交接内容
- `audit_evidence`: stage handoff record, artifact index

### 7.2 Gate 结果只能 PASS / REWORK / ESCALATE

- `principle`: Gate 结果不可模糊
- `runtime_rule`: 阶段和变更 Gate 的正式结果只能是 `PASS`、`REWORK`、`ESCALATE`
- `enforced_by`: Gate evaluation
- `required_fields`: `gate_result`, `gate_reason`
- `pass_condition`: Gate 结果明确且可追踪
- `block_condition`: 使用“基本完成”“先往后走”等模糊状态
- `audit_evidence`: gate report, decision audit

## 8. 审查规则

### 8.1 材料包必填

- `principle`: 审查必须基于正式材料，而不是 reviewer 自己找
- `runtime_rule`: 审查单没有 `submission_bundle` 不能派发 reviewer
- `enforced_by`: Review dispatch gate
- `required_fields`: `submission_bundle`, `target_id`, `review_type`
- `pass_condition`: 材料包完整
- `block_condition`: 审查任务派发时材料缺失
- `audit_evidence`: submission bundle record, dispatch audit

### 8.2 Reviewer packet 必须直写控制平面

- `principle`: 审查结果必须可收集、可汇总、可恢复
- `runtime_rule`: reviewer 完成后必须写入 `review_packet`，不能停留在“请执行脚本”
- `enforced_by`: Review completion gate
- `required_fields`: `review_packet`, `reviewer_id`, `generated_at`
- `pass_condition`: packet 已写入并可供 chief 汇总
- `block_condition`: 只在会话文本中输出结论
- `audit_evidence`: packet store, review audit

## 9. 变更规则

### 9.1 影响检查必需

- `principle`: 共享变更必须知道影响哪些在途任务
- `runtime_rule`: 所有 `shared/global` 变更都必须写 `impact_targets` 和 `at_risk_tasks`
- `enforced_by`: Publish gate
- `required_fields`: `impact_targets`, `at_risk_tasks`, `change_scope`
- `pass_condition`: 受影响对象已列清
- `block_condition`: 未知影响范围就尝试发布
- `audit_evidence`: impact report, publish audit

## 10. 学习规则

### 10.1 关键产物必须有索引

- `principle`: 正式完成必须绑定版本与证据
- `runtime_rule`: `PRD`、`架构设计`、`测试报告`、`审查裁决`、`发布记录` 必须进入 artifact index
- `enforced_by`: KM intake gate
- `required_fields`: `artifact_type`, `path`, `version`, `summary`
- `pass_condition`: 关键产物已索引且可访问
- `block_condition`: 关键阶段无产物索引
- `audit_evidence`: artifact index entry, KM audit

## 11. 使用方式

本规范用于约束以下两份文档中的实现：

- [`2026-03-14-openclaw-control-plane-prd.md`](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-openclaw-control-plane-prd.md)
- [`2026-03-14-braintrust-review-system-prd.md`](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-braintrust-review-system-prd.md)

当实现者无法判断某条产品行为是否必须硬编码进控制平面时，应优先参考本规范，而不是直接回读整套宪章总包。
