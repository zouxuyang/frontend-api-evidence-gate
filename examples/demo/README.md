# 演示：验收一个有问题的页面

这个目录演示组件如何发现页面实现和验收规格之间的差异。

## 组件做什么

组件接收 `acceptance-spec.yaml`，按场景打开页面、填写输入、点击按钮，并监听真实 API 请求和响应。每个断言都会记录 `expected` 和 `actual`，最后输出标准结果 JSON 和截图。

本例的输入规格要求：

- 搜索请求使用 `page=1&pageSize=20&keyword=ORD-001`；
- 编辑请求使用 `PATCH /api/orders/1`；
- 请求体字段使用 `{ remark: "需要尽快处理" }`；
- API 返回 200，并显示“保存成功”。

`bad-page/index.html` 刻意包含两个问题：

1. 列表请求把 `pageSize` 错发成 10；
2. 编辑请求把 `remark` 错发成 `notes`，API 返回 422，页面显示失败提示。

## 运行演示

在项目根目录执行：

```bash
npm install
npm run build
node examples/demo/server.mjs
```

另开终端执行：

```bash
PLAYWRIGHT_BROWSERS_PATH=/Volumes/1T/codex-cache/frontend-api-evidence-gate/ms-playwright \
  npm run acceptance -- examples/demo/bad-page/acceptance-spec.yaml \
  --output /Volumes/1T/codex-cache/frontend-api-evidence-gate/artifacts/bad-page
```

预期结果是 `fail`。这不是执行器失败，而是执行器成功证明页面不符合规格。

## 项目内输出

`output/` 保存了一次固定演示结果，便于直接查看：

- `acceptance-result.json`：标准化失败结果；
- `screenshot.png`：失败场景最终页面截图；
- `requests.json`：实际请求明细；
- `responses.json`：对应响应结果；
- `checks.json`：每条断言的 expected/actual。
