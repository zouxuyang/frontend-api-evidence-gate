# AI 前端验收组件

一个独立的 Node.js/TypeScript 验收执行器。外部 Agent 提供页面、交互和 API 的标准化任务；本工具使用真实浏览器执行场景，记录请求与响应证据，并运行可确定判定的布局规则。视觉模型复核通过外部 `ModelAdapter` 接入，不内置或隐式调用模型。

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
确定性行为、API、布局与可访问性规则
        ↓
可选的、按固定规则执行的视觉模型复核
        ↓
acceptance-result.json
        ↓
后续 Agent 修复、继续开发或确认通过
```

## 环境要求

- Node.js 20 或更高版本；npm 随 Node.js 一起安装。
- 默认浏览器是 Playwright Chromium。安装 npm 包不会自动下载浏览器，首次运行前需要单独安装一次。
- Linux 可能需要系统级浏览器依赖；安装系统依赖需要当前机器具备相应包管理权限。
- 使用 `--browser edge` 时，机器上必须已安装 Microsoft Edge。
- 本工具不需要 Python 或 PyYAML；YAML 解析由 npm 依赖 `yaml` 提供。JSON 和 YAML 均可作为任务输入。

## npm 首次使用

在需要验收的前端项目目录运行：

```bash
npm install -D @zouxuyang/frontend-api-evidence-gate
npx playwright install chromium
npx acceptance-runner plan node_modules/@zouxuyang/frontend-api-evidence-gate/examples/quick-start/acceptance-task.json
```

Windows PowerShell 使用相同步骤，任务路径改用反斜杠：

```powershell
npm install -D @zouxuyang/frontend-api-evidence-gate
npx playwright install chromium
npx acceptance-runner plan .\node_modules\@zouxuyang\frontend-api-evidence-gate\examples\quick-start\acceptance-task.json
```

这三步分别安装执行器、下载 Chromium，并预览随包提供的验收任务。浏览器只需按 Playwright 版本安装一次；包升级后如果提示找不到浏览器，再运行一次安装命令。无需设置 `PLAYWRIGHT_BROWSERS_PATH`，Playwright 会使用当前用户的默认浏览器缓存目录。需要统一管理缓存时，可在安装和运行时设置同一个 `PLAYWRIGHT_BROWSERS_PATH`。

Linux 缺少系统共享库时，可安装浏览器和系统依赖：

```bash
npx playwright install --with-deps chromium
```

这个命令可能需要 `sudo` 或管理员权限。也可以由系统管理员按 Playwright 官方支持的发行版安装依赖。若使用已有的 Edge 浏览器，则需自行安装 Edge，并将任务浏览器设为 `edge`；这种方式不会下载 Playwright Chromium。

### 跑通随包示例

在项目目录打开两个终端。终端一启动示例页面和 API：

```bash
node node_modules/@zouxuyang/frontend-api-evidence-gate/examples/quick-start/server.mjs
```

终端二执行浏览器验收：

```bash
npx acceptance-runner run node_modules/@zouxuyang/frontend-api-evidence-gate/examples/quick-start/acceptance-task.json \
  --output ./artifacts/acceptance-quick-start
```

预期结论为 `pass`。任务、页面和 API 服务源码位于 npm 包的 `examples/quick-start/`。`plan` 只校验并展示执行计划，不需要浏览器；`run` 才会启动浏览器并采集证据。

如果只需在项目代码中调用，不需要安装 Codex Skill。安装 npm 包不会自动注册 Codex Skill；需要 Agent 自动识别并按本项目验收流程工作时，再把 `node_modules/@zouxuyang/frontend-api-evidence-gate/skills/frontend-api-evidence-gate` 目录复制到 `$CODEX_HOME/skills/frontend-api-evidence-gate`（未设置 `CODEX_HOME` 时通常是 `~/.codex/skills/frontend-api-evidence-gate`；Windows 默认是 `%USERPROFILE%\.codex\skills\frontend-api-evidence-gate`），然后重启 Codex。

## 源码仓库开发

以下命令用于开发本仓库，不是 npm 使用者的安装步骤：

```bash
npm install
npm run build
npm run plan -- examples/demo/acceptance-spec.yaml
```

## 本地调试与自动重载

本地开发建议让 Codex 使用源码链接，而不是复制发布包：

```bash
npm install --global --prefix /Volumes/1T/codex-cache/npm-global \
  /Users/wowo/Desktop/projects/frontend-api-evidence-gate \
  --no-audit --no-fund
```

该命令会把全局 `acceptance-runner` 链接到当前源码目录。启动 TypeScript watch：

```bash
npm run dev
```

源码变化会自动重新生成 `dist`。之后直接执行 `acceptance-runner` 或 `npm run acceptance -- ...`，每次都会加载最新构建结果，不需要重新安装。

调试常驻的 HTTP/MCP 服务时，另开终端执行：

```bash
npm run dev:server
```

Node 会在 `dist/server.js` 变化后自动重启服务。需要断点调试时使用 `npm run debug:cli`（Node Inspector `9229`）或 `npm run debug:server`（Inspector `9230`）。

`dist` 使用 source map，调试器可以回到 `src/*.ts`。依赖、浏览器缓存和验收产物仍应放在外置盘；源码修改后先让 watch 完成一次编译，再运行验收任务。

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

### Edge 和 Windows

可以通过系统 Edge 通道启动 Microsoft Edge：

```powershell
acceptance-runner run acceptance-task.json --browser edge --headed
```

也可以连接已经打开的 Edge 标签页：

```powershell
msedge.exe --remote-debugging-port=9222
acceptance-runner run acceptance-task.json `
  --target existing `
  --browser edge `
  --cdp-endpoint http://127.0.0.1:9222 `
  --tab-url https://test.example.com/orders
```

`--browser edge` 使用系统安装的 Microsoft Edge，不会下载 Playwright 自带浏览器。Windows 下可使用 PowerShell 或 `acceptance-runner.cmd`。

### TypeScript API 和视觉模型适配器

```ts
import { accept } from '@zouxuyang/frontend-api-evidence-gate';

const run = await accept({
  task,
  outputDir: './artifacts/acceptance',
  browser: 'chromium',
});

if (run.decision !== 'pass') throw new Error(`验收未通过：${run.decision}`);
console.log(run.results[0].quality?.visualReview);
```

`quality.visualReview` 可设为 `required`、`optional` 或 `off`。未显式配置时按 `optional` 处理，以保持旧任务兼容：没有适配器时行为/API可以通过，但视觉状态会明确记录为 `not_run`。设为 `required` 却未提供适配器时，场景结论为 `needs_review`；提供适配器也必须返回全部视觉规则的逐项证据，缺项不能通过。`off` 会跳过模型复核。不要把行为/API通过解释为视觉通过。

每个场景可指定 `viewport: { width, height }`。结果同时保留 `screenshot.png`（整页）和 `viewport.png`（真实可视区域），`quality.layoutOverflow: fail` 会额外检查页面横向溢出、打开的弹窗／抽屉是否越出视口、底部操作区是否可见，以及正文和底部操作区是否重叠，并写入 `layout.json`。模型适配器收到视口截图、整页截图、各步骤截图、布局测量、固定六项视觉规则、行为检查和 API 证据。配色、品牌方向等审美选择由产品负责人决定。

`ModelAdapter` 是可选集成：只有需要自动化视觉结论时才需要由调用方实现并注入。没有适配器时，行为/API检查照常执行，视觉状态按策略记录为 `not_run` 或 `needs_review`，不会伪报视觉通过。MCP 服务可通过 `acceptance-runner-server` 提供给其他 Agent。

npm 包包含 `skills/frontend-api-evidence-gate/SKILL.md` 和 quick-start 示例，但 npm 不会自动把 Skill 写入 Codex 配置目录。需要 Agent 工作流时，按“npm 首次使用”章节手动安装 Skill；只把执行器集成进代码或 CI 时，不需要安装 Skill。

目标模式和运行保护：

```bash
acceptance-runner run acceptance-task.json \
  --target existing \
  --cdp-endpoint http://127.0.0.1:9222 \
  --tab-url https://test.example.com/orders \
  --timeout 30000 \
  --scenario-timeout 15000 \
  --max-response-bytes 1048576
```

验收器采用单页模式：一次任务只能描述一个页面；同页可以有多个场景，但不能把多个路由放在同一个任务里。`--timeout` limits the whole task. `--scenario-timeout` independently limits each scenario, so the page's scenarios are reported separately when one is slow or blocked.

已有登录浏览器默认采用后台隔离模式：Runner 只从目标标签页复制 cookies 和 localStorage，随后在独立的无头 Chromium 中执行场景。用户原来的标签页不会被导航、点击或抢焦点，可以继续操作。需要兼容旧行为、确实要驱动当前标签页时，显式增加 `--foreground`；这会让 Runner 占用该标签页，适合调试，不适合日常验收。

页面异步数据可以在 `open` 上声明 `waitUntil: networkidle`，或单独增加 `{ action: waitFor, state: networkidle }`。前者等待导航和首屏请求稳定，后者适合页面壳已出现、列表接口仍在加载的 SPA 页面；默认仍保持原有 `load` 行为，避免把长轮询页面误判为加载完成。

HTTP/MCP 服务同样使用这个后台隔离策略；`async: true` 只负责把任务放到后台队列，浏览器隔离由 `browserTarget.background` 控制，默认开启。

外部 Agent 也可以启动本地入口：

```bash
acceptance-runner-server --port 3777
```

HTTP 使用 `POST /run`；传入 `async: true` 后，可通过 `GET /jobs/:jobId` 查询，并用 `POST /jobs/:jobId/cancel` 取消。MCP 使用 `POST /mcp` 的 `tools/list` 和 `tools/call`。

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

输入文件可以是标准 JSON（推荐供上游智能体生成），也可以是 YAML；两者都声明：

- 页面和路由；
- 按钮、输入、弹窗和可访问定位器；
- 用户操作步骤；
- API 路径、方法、query、body 和响应要求；
- 测试数据、视口和质量要求；
- 页面、组件、API、schema 和全局样式依赖。

JSON 任务可以在 `pages[].components` 中为按钮、输入框、选择器、表单、弹窗和表格登记稳定定位器，步骤使用 `component` 引用它们。执行器会把真实点击、输入、提交、请求和响应串起来，并把截图与 API 证据交给后续 AI 复核。

输出目录包含：

```text
acceptance-result.json  # 标准结果、结论、指纹和证据索引
screenshot.png          # 整页截图
viewport.png            # 浏览器实际可视区域截图
layout.json             # 视口、页面及弹窗/抽屉几何数据
requests.json           # URL、方法、参数、请求体
responses.json          # 状态码、耗时、响应体
checks.json             # expected / actual / status
trace.zip               # Playwright 调试证据
```

定位器应优先使用唯一的 `testId`、`label` 或作用域 CSS。角色和名称重复时，可在定位器中使用 `exact: true`、`nth`、`first` 或 `last`；执行器会在点击、输入和断言前报告多匹配原因。请求或响应只需核对稳定字段时，在断言步骤设置 `bodyMatch: subset`，默认仍为完整 body 精确匹配。

结果结论为：

- `pass`：已配置的确定性检查通过；若 `visualReview` 是 `optional` 且没有适配器，视觉结果仍为 `not_run`；
- `fail`：确定性规则失败；
- `blocked`：页面、API、数据或执行环境不可用；
- `needs_review`：必需视觉审查未运行、视觉证据或规则项不完整，或模型认为需要人工判断。

每个结果的 `quality.visualReview` 独立记录策略、状态、逐项规则结果和证据。运行汇总中的 `qualitySummary.visualReview` 汇总通过、失败、未运行、待复核和受阻数量。

## 运行时实现

- `acceptance-runner`：CLI 入口；
- `runAcceptance()`：TypeScript 库接口；
- Playwright：浏览器执行和证据采集；
- Ajv + JSON Schema：输入和结果协议校验；
- `ModelAdapter`：可选的外部模型复核适配器；
- 指纹选择器：判断场景是否可以复用上次结果。

默认不调用模型。需要视觉判断时，由外部 Agent 显式提供符合固定 rubric 的 `ModelAdapter`；包负责验证适配器是否覆盖全部规则和输出证据，不会把未运行的模型复核伪装成通过。

## 目录

- `src/`：执行器实现
- `schemas/`：输入和输出 JSON Schema
- `examples/demo/`：通过版和问题版完整演示
- `examples/quick-start/`：随 npm 发布的 JSON 任务及可运行页面/API 示例
- `docs/`：总体方案、执行流程和重验策略
- `docs/README.md`：文档索引和阅读顺序
- `docs/01-外部AI驱动验收执行器方案.md`：外部 AI 调用协议、浏览器接入和证据输出方案
- `templates/`：接入项目的 CI、Makefile 和规格模板
