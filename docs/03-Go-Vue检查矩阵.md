# 03 Go + Vue 检查矩阵

| 层次 | 检查内容 | 推荐工具 | 通过标准 |
|---|---|---|---|
| Go | 单元测试 | `go test ./...` | 相关包通过 |
| Go | 静态检查 | `go vet`、golangci-lint | 无新增问题 |
| Go | 接口定义 | OpenAPI/schema | 接口变更已声明 |
| Go | 数据库 | migration/integration test | 可升级、失败可回滚 |
| Vue | 代码质量 | ESLint | 无阻断问题 |
| Vue | 类型 | vue-tsc | 无类型错误 |
| Vue | 组件 | Vitest、Storybook | 状态和交互通过 |
| Vue | 构建 | Vite build | 生产构建成功 |
| 浏览器 | 用户流程 | Playwright | 主流程可完成 |
| 浏览器 | 请求协议 | Playwright request assertion | URL、方法、参数、body 正确 |
| 浏览器 | 布局 | Screenshot、viewport | 无遮挡、异常换行、溢出 |
| 浏览器 | 无障碍 | axe-core | 无关键问题 |
| 数据 | 分页 | 真实 API 或稳定 mock | page/pageSize/total 正确 |

## 最低页面覆盖

每个关键列表页至少有：

1. 正常列表；
2. 空列表；
3. 加载中；
4. 接口错误；
5. 搜索；
6. 分页；
7. 详情；
8. 新增或编辑；
9. 保存成功；
10. 保存失败；
11. 长文本；
12. 手机宽度。
