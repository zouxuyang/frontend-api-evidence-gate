# Go + Vue + Codex 标准验收门禁方案

这是一套面向 Go + Vue 项目的前端与接口验收方案，目标是把“页面看起来能用”变成可重复、可审查、可阻止合入的工程流程。

## 方案解决的问题

- 按钮或标签区域过窄导致换行、遮挡或不可点击；
- 输入框可以填写，但数据没有正确传给后端；
- 弹窗、抽屉、成功失败反馈行为不完整；
- 列表没有真正分页，或分页参数不符合后端约定；
- 表格展示过多低价值字段；
- Go 接口和 Vue 请求字段、枚举、分页结构不一致；
- Codex 报告“已完成”，但没有真实浏览器证据。

## 核心原则

`AGENTS.md` 约束 Codex 的工作方式，`Makefile` 固定验证入口，CI/PR 门禁真正阻止不合格代码合入，Playwright 验证真实用户流程。

## 目录说明

- `docs/01-总体方案.md`：完整流程和责任边界
- `docs/02-门禁分层.md`：本地、PR、发布前和定期检查
- `docs/03-Go-Vue检查矩阵.md`：Go、Vue、接口和浏览器验收项
- `docs/04-实施路线图.md`：分阶段落地计划
- `templates/AGENTS.user.md`：用户级 Codex 规范模板
- `templates/AGENTS.project.md`：Go+Vue 项目级规范模板
- `templates/Makefile.example`：统一验证命令示例
- `templates/playwright-critical.spec.ts`：关键流程测试模板
- `templates/ci-gate.yml`：CI 门禁示例
- `checklists/frontend-acceptance.md`：人工验收清单

## 推荐落地顺序

1. 将用户级规范合并到 `~/.codex/AGENTS.md`。
2. 将项目级规范复制到每个 Go+Vue 仓库根目录的 `AGENTS.md`。
3. 在仓库中提供 `make check`、`make e2e-critical` 和 `make verify`。
4. 先覆盖登录、列表、搜索、分页、详情、编辑、保存这条主链路。
5. 将 CI 中的 `backend`、`frontend`、`contract`、`e2e-critical` 设置为 PR 必检项。
6. 逐步加入视觉回归、无障碍和性能检查。

## Git

本方案目录已经初始化 Git 并提交首个版本。它是独立方案仓库，后续可以继续提交迭代，也可以复制其中模板到具体项目。
