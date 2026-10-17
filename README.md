# AI 前端验收组件

这是一个独立的、框架无关的 AI 前端验收组件。上游 Agent 提供标准化的页面、API、交互和验收要求；组件根据规格驱动浏览器执行，调用模型进行语义复核，并输出可被后续 Agent 继续消费的标准化结果。

## 组件边界

组件只负责四件事：

1. 接收并校验验收规格；
2. 根据变更指纹选择需要执行或复用的场景；
3. 通过真实浏览器采集页面、交互、请求和响应证据，并调用模型完成语义复核；
4. 输出机器可读的验收结果和证据索引。

组件不绑定 Vue、React 或其他前端框架，也不绑定某种后端语言或特定上游、下游 Agent。

## 标准数据流

```text
上游 Agent
  → acceptance-spec.yaml / normalized-spec.json
  → 规格校验与规范化
  → 依赖解析与场景指纹
  → 执行或复用验收场景
  → 浏览器规则检查 + 模型语义复核
  → acceptance-result.json + 证据文件
  → 后续 Agent 继续开发、修复或决定验收通过
```

## 目录说明

- `docs/01-总体方案.md`：组件目标、边界和证据要求
- `docs/02-门禁分层.md`：本地、PR、发布前检查分层
- `docs/03-前端与API检查矩阵.md`：前端、API 和浏览器检查项
- `docs/04-实施路线图.md`：分阶段落地计划
- `docs/05-AI验收组件方案.md`：输入、处理、模型调用和输出协议
- `docs/06-变更判定与重验策略.md`：指纹、依赖和全局组件重验规则
- `schemas/acceptance-spec.schema.json`：标准输入 JSON Schema
- `schemas/acceptance-result.schema.json`：标准结果 JSON Schema
- `templates/acceptance-spec.example.yaml`：标准输入示例
- `templates/Makefile.example`：项目接入命令示例
- `templates/ci-gate.yml`：CI 接入示例
- `examples/demo/`：可本地启动的订单列表验收示例

## 最小接入方式

1. 编写 `acceptance-spec.yaml`，声明页面、控件、交互、API、断言和质量要求；
2. 将规格规范化为稳定 JSON，并校验 schema；
3. 为页面和组件提供可解析的源码、依赖、API schema、测试数据和运行环境指纹；
4. 执行验收组件；
5. 将 `acceptance-result.json` 和证据目录交给后续 Agent；
6. 后续 Agent 只根据 `pass`、`fail`、`blocked`、`needs_review` 及证据引用继续处理。

## 运行时实现

当前实现是 Node.js/TypeScript 包，提供 `acceptance-runner` CLI 和 `runAcceptance()` 库接口。Playwright 负责浏览器执行和证据采集，规则引擎负责确定性断言，模型通过 `ModelAdapter` 接口接入。默认的 `NoopModelAdapter` 只用于本地开发，生产环境应注入实际模型适配器。

```bash
npm install
npm run build
npm run plan -- acceptance-spec.yaml
npm run acceptance -- acceptance-spec.yaml --output artifacts --reuse

# 仓库内 demo
node examples/demo/server.mjs
node dist/cli.js run examples/demo/acceptance-spec.yaml --output artifacts
```


## 示例页面

`examples/demo/` 提供一个订单列表页面和本地 API，可直接验证搜索、编辑弹窗、PATCH 请求和成功反馈：

```bash
node examples/demo/server.mjs
npm run build
PLAYWRIGHT_BROWSERS_PATH=/Volumes/1T/codex-cache/frontend-api-evidence-gate/ms-playwright \
  npm run acceptance -- examples/demo/acceptance-spec.yaml --output /Volumes/1T/codex-cache/frontend-api-evidence-gate/artifacts
```
