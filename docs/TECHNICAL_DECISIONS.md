# Technical decisions

本文件记录针对当前目录内参考项目的只读比较。它们用于理解成熟方案的边界，不是本项目的源码供应目录。

## 方案比较

| 方案 | 本地参考 | 优点 | 与本项目目标的冲突 | 决策 |
|---|---|---|---|---|
| GrapesJS | `reference/grapesjs/` | 完整组件模型、样式管理、历史与插件生态 | 导入后主要进入 GrapesJS 内部组件模型；对“保留 AI 原始 DOM / SVG 并做最小局部修改”需要大量适配 | 不作为核心；参考组件树和编辑器能力划分 |
| Silex | `reference/Silex/` | GrapesJS 上的完整产品、发布流程、插件和 MCP 思路 | 产品/服务器/桌面端范围远超 MVP；AGPL；当前本地版本要求更高 Node 版本 | 不嵌入；参考产品层和程序化控制方向 |
| VvvebJs | `reference/VvvebJs/` | iframe 网页编辑思路直接、Apache-2.0 | 本地代码以传统 JavaScript 和页面构建器为中心，缺少本项目需要的 TypeScript 共享命令模型 | 只参考 iframe/结构面板思路 |
| Moveable | `reference/moveable/`、`reference/moveable-kernelscale-demo/` | 只负责真实 DOM 元素的拖动、缩放、旋转和控制框；MIT；不抢占文档所有权 | 需要自己实现文档模型、历史、净化和导出 | 采用为交互层 |
| 自研 Pointer 控制框 | 无 | 最少依赖、完全控制 | SVG、旋转、缩放、组操作和跨 Shadow DOM 几何细节会消耗大量验证时间 | 不在 MVP 重造 |
| Canvas / Fabric / Konva 作为唯一模型 | 无 | 图形交互容易 | 会把真实 DOM / CSS / SVG 降为导入输出格式，违背 source-first | 明确排除 |

## 最终技术栈

- TypeScript：共享浏览器与 CLI 的命令、文档和项目类型；
- Vite：开发服务器与生产构建；
- 原生 DOMParser / XMLSerializer：保留真实节点类型；
- Shadow DOM：隔离导入 CSS，不给导入文档脚本执行机会；
- Moveable：仅作为几何交互辅助；
- CodeMirror 6：代码编辑、语法高亮、搜索和定位；
- Prettier：按需加载的显式格式化；
- JSZip：按需加载的项目目录导出；
- JSDOM：CLI 中解析 HTML / SVG 和解析声明式 CSS；
- Vitest：核心模块测试；
- Playwright Core + 系统 Chrome：真实浏览器冒烟测试。

没有引入 React 或全局状态库。当前工作台只有一个编排实例，显式类和模块边界比引入第二套响应式状态更小、更容易核验；后续若进入多页和组件生态阶段，再评估 React。

## 为什么使用 Shadow DOM 而不是 iframe

MVP 需要 Moveable 直接绑定真实节点，并让选择、边界和属性读取保持同一 JavaScript realm。Shadow DOM 能隔离大部分导入 CSS，同时允许控制框绑定内部节点。

代价：Shadow DOM 不是完整安全边界，`html` 选择器需要有限重写，某些依赖浏览器根上下文的 CSS 行为不会完全一致。因此：

- 所有脚本和事件属性在挂载前删除；
- 不支持导入页面 JavaScript；
- 多租户部署需要升级为 sandboxed iframe / 独立 origin 和 CSP；
- 当前适合本地、可信操作者使用的静态视觉文档。

## 为什么不用 GrapesJS 作为 MVP 核心

GrapesJS 的能力覆盖远大于 Phase 1，但它的组件、CSS composer 和存储模型会成为第二套需要维护的规范状态。对普通网站构建器这是优势，对本项目的主要矛盾——“尽量保留 AI 已生成的原始结构，只改指定节点”——则会增加导入/回写和 source diff 风险。

当前设计保留了以后接入 GrapesJS 插件或组件面板的可能性，但稳定 ID、命令层与标准源文件不会依赖它。

## 许可证边界

- 本项目代码使用 MIT；
- Moveable 是运行时依赖，不复制其仓库源码；
- Silex、GrapesJS、VvvebJs 等参考目录没有被复制进 `src/`；
- 每个参考目录仍受它自己的许可证约束；
- `dist/` 只包含 npm 依赖正常打包的运行时代码。
