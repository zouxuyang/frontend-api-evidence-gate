# 前端与 API 证据化验收门禁方案

这是一套面向 AI 生成或修改页面的、框架无关的前端与 API 验收方案，目标是把“页面看起来能用”变成可重复、可审查、可阻止合入的证据链。

## 方案解决的问题

- 按钮或标签区域过窄导致换行、遮挡或不可点击；
- 输入框可以填写，但数据没有正确进入实际请求；
- 弹窗、抽屉、成功失败反馈行为不完整；
- 列表没有真正分页，或分页参数不符合 API 约定；
- 表格展示过多低价值字段；
- 页面实现与 API 字段、枚举、分页结构不一致；
- AI 报告“已完成”，但没有真实浏览器证据。

## 核心原则

验收以用户场景为单位，使用真实浏览器验证交互，使用 API schema 和请求断言核实数据契约，使用截图和布局规则检查视觉结果，并保存命令、日志、截图和 trace 作为过程证据。方案不绑定 Vue、React 或其他前端框架。

## 目录说明

- `docs/01-总体方案.md`：完整流程和责任边界
- `docs/02-门禁分层.md`：本地、PR、发布前和定期检查
- `docs/03-前端与API检查矩阵.md`：框架无关的前端、API 和浏览器验收项
- `docs/04-实施路线图.md`：分阶段落地计划
- `docs/05-AI驱动验收组件方案.md`：规格驱动的验收执行器设计
- `docs/06-变更判定与重验策略.md`：变更影响分析和证据复用规则
- `templates/AGENTS.user.md`：用户级 Codex 规范模板
- `templates/AGENTS.project.md`：项目级规范模板
- `templates/Makefile.example`：统一验证命令示例
- `templates/playwright-critical.spec.ts`：关键流程测试模板
- `templates/ci-gate.yml`：CI 门禁示例
- `templates/acceptance-spec.example.yaml`：验收规格示例
- `checklists/frontend-acceptance.md`：人工验收清单

## 推荐落地顺序

1. 将用户级规范合并到 `~/.codex/AGENTS.md`。
2. 将项目级规范复制到前端或全栈仓库根目录的 `AGENTS.md`。
3. 在仓库中提供 `make check`、`make e2e-critical` 和 `make verify`。
4. 先覆盖登录、列表、搜索、分页、详情、编辑、保存这条主链路。
5. 将 `frontend`、`contract`、`e2e-critical` 设置为 PR 必检项。
6. 逐步加入视觉回归、无障碍和性能检查。
