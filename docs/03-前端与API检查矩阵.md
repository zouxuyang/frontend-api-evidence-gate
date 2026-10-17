# 03 前端与 API 检查矩阵

| 层次 | 检查内容 | 推荐工具 | 通过标准 |
|---|---|---|---|
| 前端 | 代码质量 | ESLint 或项目等价工具 | 无阻断问题 |
| 前端 | 类型 | TypeScript checker 或项目等价工具 | 无类型错误 |
| 前端 | 组件 | Vitest、Storybook 或项目等价工具 | 状态和交互通过 |
| 前端 | 构建 | Vite、Next、Webpack 或项目等价工具 | 生产构建成功 |
| API | 接口定义 | OpenAPI、JSON Schema 或等价契约 | 路径、字段和枚举已声明 |
| API | 请求协议 | Playwright request assertion | URL、方法、参数、body 正确 |
| API | 响应处理 | schema 校验和场景断言 | 成功、错误和空数据处理正确 |
| 浏览器 | 用户流程 | Playwright | 主流程可完成 |
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
