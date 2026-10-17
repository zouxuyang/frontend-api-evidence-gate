# AI 前端验收组件

一个独立的 Node.js/TypeScript 验收执行器。它接收页面、交互和 API 的标准化规格，使用真实浏览器执行场景，记录请求与响应证据，调用可插拔模型进行语义复核，最后输出后续 Agent 可以继续消费的标准结果。

## 它解决什么问题

AI 生成的页面可能“看起来完成”，但仍然存在：

- 搜索条件没有进入请求；
- 分页参数错误；
- 表单字段和 API 契约不一致；
- 弹窗、保存、失败反馈不完整；
- 没有截图和真实请求证据。

组件把这些问题转换成可执行的输入和可审查的输出。它不绑定 Vue、React 或其他前端框架，也不绑定某种后端语言或特定 Agent。

## 工作流

```text
上游 Agent 编写 acceptance-spec.yaml
        ↓
输入规范校验与规范化
        ↓
场景指纹和影响范围分析
        ↓
执行未验证或已变化的场景
        ↓
Playwright 采集页面、截图、请求、响应和 Trace
        ↓
规则引擎判定 + 模型语义复核
        ↓
acceptance-result.json
        ↓
后续 Agent 修复、继续开发或确认通过
```

## 快速开始

```bash
npm install
npm run build
npm run plan -- examples/demo/acceptance-spec.yaml
```

启动示例 API 和页面：

```bash
node examples/demo/server.mjs
```

另开终端执行通过版验收：

```bash
PLAYWRIGHT_BROWSERS_PATH=/Volumes/1T/codex-cache/frontend-api-evidence-gate/ms-playwright \
  npm run acceptance -- examples/demo/acceptance-spec.yaml \
  --output /Volumes/1T/codex-cache/frontend-api-evidence-gate/artifacts/demo
```

通过版会验证搜索、编辑弹窗、PATCH 请求、响应和“保存成功”提示，结果为 `pass`。

## 演示：验收一个有问题的页面

[examples/demo/README.md](examples/demo/README.md) 展示了完整的失败案例。问题页面故意：

- 把 `pageSize=20` 错发成 `pageSize=10`；
- 把请求体字段 `remark` 错发成 `notes`；
- 接收到 API 422 后显示错误提示，但没有完成成功流程。

运行：

```bash
PLAYWRIGHT_BROWSERS_PATH=/Volumes/1T/codex-cache/frontend-api-evidence-gate/ms-playwright \
  npm run acceptance -- examples/demo/bad-page/acceptance-spec.yaml \
  --output /Volumes/1T/codex-cache/frontend-api-evidence-gate/artifacts/bad-page
```

预期结果是 `fail`。项目内已经保存了一份可直接查看的结果：

- [失败结果 JSON](examples/demo/bad-page/output/acceptance-result.json)
- [实际请求明细](examples/demo/bad-page/output/requests.json)
- [实际响应结果](examples/demo/bad-page/output/responses.json)
- [断言明细](examples/demo/bad-page/output/checks.json)
- [失败场景截图](examples/demo/bad-page/output/screenshot.png)

![问题页面验收截图](examples/demo/bad-page/output/screenshot.png)

## 输入和输出

输入文件是 `acceptance-spec.yaml`，声明：

- 页面和路由；
- 按钮、输入、弹窗和可访问定位器；
- 用户操作步骤；
- API 路径、方法、query、body 和响应要求；
- 测试数据、视口和质量要求；
- 页面、组件、API、schema 和全局样式依赖。

输出目录包含：

```text
acceptance-result.json  # 标准结果、结论、指纹和证据索引
screenshot.png          # 最终页面截图
requests.json           # URL、方法、参数、请求体
responses.json          # 状态码、耗时、响应体
checks.json             # expected / actual / status
trace.zip               # Playwright 调试证据
```

结果结论为：

- `pass`：规则和模型复核均通过；
- `fail`：确定性规则失败；
- `blocked`：页面、API、数据或执行环境不可用；
- `needs_review`：证据不足或模型发现语义问题。

## 运行时实现

- `acceptance-runner`：CLI 入口；
- `runAcceptance()`：TypeScript 库接口；
- Playwright：浏览器执行和证据采集；
- Ajv + JSON Schema：输入和结果协议校验；
- `ModelAdapter`：模型调用适配器；
- 指纹选择器：判断场景是否可以复用上次结果。

默认 `NoopModelAdapter` 只用于本地开发。生产环境应注入实际模型适配器。

## 目录

- `src/`：执行器实现
- `schemas/`：输入和输出 JSON Schema
- `examples/demo/`：通过版和问题版完整演示
- `docs/`：总体方案、执行流程和重验策略
- `templates/`：接入项目的 CI、Makefile 和规格模板
