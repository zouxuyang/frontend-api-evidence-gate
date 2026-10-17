# Go + Vue 项目级 Codex 规范

## 常用命令

- 后端测试：`go test ./...`
- 后端静态检查：`go vet ./...`、`golangci-lint run`
- 前端检查：`pnpm lint`
- 前端类型：`pnpm typecheck`
- 前端测试：`pnpm test -- --run`
- 前端构建：`pnpm build`
- 浏览器测试：`pnpm playwright test`

## 约定

- 不猜测 API 路径、分页字段、状态枚举和请求字段。
- 优先使用 OpenAPI 生成类型或现有 API 封装。
- 列表优先使用后端分页，不在前端一次性拉取全部数据再切片。
- 表单字段必须有可访问 label。
- 页面交互改动必须有 Playwright 覆盖。
- 报告中不得把未执行的检查写成通过。
