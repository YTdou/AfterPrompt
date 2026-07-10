# Last Mile Studio

Last Mile Studio 是一个面向 AI 生成 HTML、HTML Slide 和 SVG 的“最后一公里”可视化编辑器。它直接编辑真实 DOM / SVG 节点，并持续生成可读、可导出的标准源代码；没有把页面栅格化，也没有把 Canvas 状态当作唯一数据源。

当前版本是可运行的 MVP（`0.1.0`），已经打通 Phase 1–3 的主链路：

```text
HTML / SVG 源码 → 安全解析与稳定 ID → 真实节点画布
      ↑                                  ↓
      └──── CodeMirror / JSON 命令 / CLI ← 视觉操作
```

## 快速开始

要求 Node.js 22 或更高版本。

```bash
npm install
npm run dev
```

浏览器打开终端显示的地址，默认是 <http://localhost:4173>。

常用命令：

```bash
npm run dev          # 开发服务器
npm run build        # 严格类型检查并生成 dist/
npm run test         # 核心自动化测试
npm run test:browser # 可选：用本机 Chrome/Chromium 跑真实 UI 冒烟测试
npm run check        # 核心测试 + 生产构建
npm run cli -- --help
```

如果浏览器测试找不到 Chrome：

```bash
CHROME_PATH=/path/to/chrome npm run test:browser
```

## 已实现能力

### 导入、画布与双向同步

- 导入 `.html`、`.htm`、`.svg` 和 `.visual-project.json`；
- 直接粘贴 HTML / SVG；
- 使用目录选择器载入简单本地项目，优先选择 `index.html`，并解析本地 CSS、SVG 和图片；
- 在隔离的 Shadow DOM 中渲染静态 HTML，在原生 SVG DOM 中渲染 SVG；
- 自动识别 `deck-stage > section` 等静态多页演示稿，读取演示稿尺寸，并通过上一页 / 页面选择器 / 下一页逐页编辑；
- 缩放、以鼠标位置为中心缩放、Space/中键平移、适应窗口和自定义画布尺寸；
- 画布修改后更新底层源码；代码修改通过“应用代码”重新解析并更新画布；
- 代码解析失败时保留上一个有效画布，不覆盖有效版本。

### 选择、变换与属性

- 点击画布或图层树选择节点；Ctrl / Shift 点击多选；Alt 点击选择父级；
- Moveable 驱动的拖动、缩放、旋转、吸附控制框；
- SVG `path`、`polygon`、`polyline`、`line`、`text` 与分组等无原生宽高节点使用固定点变换缩放；
- X、Y、W、H、旋转角度的精确输入；
- 方向键 1 px 微调，Shift + 方向键 10 px 微调；
- 单元素对齐画布，多元素对齐与水平/垂直分布；
- 双击画布文字直接编辑，或在属性面板编辑文字；
- 字体、字号、字重、行高、字间距、对齐和文字颜色；
- HTML 背景 / SVG 填充、描边、透明度、圆角、阴影和滤镜；
- HTML `img` / SVG `image` 路径修改和本地图片替换；
- CSS class 与 inline style 编辑。

### 图层、历史与代码

- 统一的 DOM / SVG 层级树，显示节点类型、名称、显隐和锁定状态；
- 重命名、显隐、锁定、复制、删除和同级顺序调整；
- 添加文本和基础矩形；
- Undo / Redo；连续 Moveable 手势只在结束时写入一次历史；
- CodeMirror 语法高亮、行号、搜索、选中元素定位；
- 收起代码区会同步压缩外层布局，只保留工具栏并把空间完整返还给画布；
- Prettier 按需加载并格式化 HTML / SVG；
- 所有视觉编辑完成后，代码视图同步到当前有效源代码。

### 导出与 Codex 控制

- 导出标准 `.html` 或 `.svg`；
- 导出包含源代码、画布尺寸、稳定 ID、元数据和资源的 `.visual-project.json`；
- 项目文件保留最近 500 条 UI、代码、历史与 CLI 操作日志；
- 导出包含入口文件与本地资源的 ZIP；
- 导出 AI 易读的页面结构 JSON；浏览器导出包含实际渲染后的边界；
- 本地 CLI 支持查询、获取、准备稳定 ID、批量执行 JSON 命令、验证和导出；
- 命令层支持修改、移动、缩放、旋转、文字、样式、添加、删除、显隐、锁定和重排。

## 基本使用方法

### 编辑 HTML Slide

1. 点击“导入文件”“导入目录”或“粘贴代码”；
2. 在画布中点击标题、图片、色块或内嵌 SVG；
3. 拖动控制框，或在右侧属性面板输入精确值；
4. 在下方代码视图确认 `data-editor-id`、属性和样式变化；
5. 点击“导出源文件”得到独立 HTML，或“导出 ZIP”保留本地资源。

### 编辑 SVG

1. 从示例菜单选择 `SVG shapes`，或导入自己的 `.svg`；
2. 从图层树选择 `text`、`rect`、`circle`、`path` 或 `g`；
3. 直接变换，或编辑填充、描边、文本和图层顺序；
4. 导出后可直接用浏览器打开 SVG。

### 修改代码并返回画布

代码区允许自由编辑。只有点击“应用代码”后，草稿才会成为新的有效文档；如果 SVG 语法错误，错误会显示在工具栏中，画布仍保留上一个有效版本。点击“定位选中元素”会搜索当前稳定 ID。

## Codex / CLI 工作流

先查看元素列表：

```bash
npm run cli -- list examples/ai-slide.html
npm run cli -- get examples/ai-slide.html title-001
npm run cli -- summary examples/ai-slide.html --output /tmp/slide-structure.json
```

如果原文件没有稳定 ID，先输出一份带 ID 的源文件：

```bash
npm run cli -- prepare input.html --output prepared.html
```

批量执行结构化命令：

```bash
npm run cli -- apply examples/ai-slide.html \
  --commands examples/codex-commands.json \
  --output /tmp/ai-slide-edited.html
```

CLI 默认不覆盖输入文件。只有显式传入 `--in-place` 才会原地写入：

```bash
npm run cli -- apply prepared.html --commands changes.json --in-place
```

命令文件可以是单个对象，也可以是对象数组。完整契约见 [docs/COMMAND_API.md](docs/COMMAND_API.md)。

## 示例与验收材料

- [examples/ai-slide.html](examples/ai-slide.html)：标题、两段正文、本地图片、色块和内嵌 SVG 图标；
- [examples/simple-page.html](examples/simple-page.html)：目录导入示例，依赖本地 CSS 和图片；
- [examples/shapes.svg](examples/shapes.svg)：`text`、`rect`、`circle`、`line`、`path`、`polygon` 和 `g`；
- [examples/codex-commands.json](examples/codex-commands.json)：修改标题、移动图片、修改色块、删除图标；
- [tests/document-model.test.ts](tests/document-model.test.ts)：解析、净化、稳定 ID、HTML/SVG 命令与错误恢复；
- [scripts/browser-smoke.mjs](scripts/browser-smoke.mjs)：真实浏览器中的选择、属性修改、代码同步、格式化、Undo 和 SVG 切换。

## 项目结构

```text
src/
├── canvas/
│   ├── renderer.ts              # Shadow DOM / 原生 SVG 预览与节点映射
│   └── transform-controller.ts  # Moveable 交互适配层
├── cli/
│   └── index.ts                 # Codex 本地 CLI
├── core/
│   ├── commands.ts              # 共享命令、变换和结构摘要
│   ├── document-model.ts        # 源文档生命周期、解析与序列化
│   ├── history.ts               # Undo / Redo 与操作合并
│   ├── ids.ts                   # 稳定 ID
│   ├── project.ts               # 本地资源、项目 JSON 与 ZIP
│   ├── sanitizer.ts             # 静态内容安全边界
│   └── types.ts                 # 公共数据与命令类型
└── ui/
    ├── code-editor.ts           # CodeMirror 适配
    └── editor-app.ts            # 工作台编排
```

架构细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，本地参考项目和技术选型比较见 [docs/TECHNICAL_DECISIONS.md](docs/TECHNICAL_DECISIONS.md)，安全模型见 [docs/SECURITY.md](docs/SECURITY.md)。

本地第三方参考仓库和旧演示素材统一保存在 `reference/`，该目录被 Git 忽略，不属于本项目发布内容。

## 安全默认值

导入内容被当作静态视觉文档，而不是可信应用：

- 删除 `script`、`iframe`、`object`、`embed`、SVG 动画和 `foreignObject`；
- 删除 `on*` 事件、`srcdoc`、`javascript:`、`vbscript:` 和非图片 `data:` URL；
- 禁用 CSS `@import`、`expression()` 和危险 CSS URL；
- 不提供本地命令执行通道；
- 外部资源会被标记，外部 CSS 不会注入预览；
- 项目目录资源只在浏览器内映射为临时 Blob URL。

这不是通用 HTML 恶意内容沙箱。不要把本工具部署成允许匿名用户互相打开文档的多租户服务，除非再增加严格 CSP、进程隔离和服务端净化。

## 明确限制

当前 MVP 不声称完整支持所有网页或 SVG：

- 只支持静态视觉内容；导入页面的 JavaScript 交互会被移除；
- 视觉修改写入 inline style 或标准 SVG 属性，不会反向编辑复杂样式表规则；
- 对 Flex / Grid 流式元素使用可逆的 CSS transform，避免无提示改成绝对定位；尚未提供“转换为自由定位”的显式命令；
- 多选支持组拖动、对齐和分布；多选组缩放与组旋转暂未开放；
- HTML 中由 class 样式表定义的既有 `transform` 可能在首次变换时被 inline transform 覆盖；既有 inline transform 和 SVG transform 会被保留并组合；
- 复杂富文本直接替换文本时可能移除内部标签，因此属性面板只把叶子或文本型节点作为文本对象；
- 浏览器导出的结构 JSON 使用真实布局边界；CLI 没有浏览器布局引擎，只能报告声明式 CSS / SVG 几何，自动高度可能为 `0`；
- DOMParser 会修复不规范 HTML，序列化会统一标签和属性格式。未编辑的语义结构、class、id、注释和资源引用会保留，但无法保证逐字符 diff；
- 高级 SVG 滤镜、mask、clipPath、textPath、动画和外部脚本不在可靠编辑范围；
- 多页 Slide 当前提供静态识别和逐页编辑，尚未提供缩略图、页面复制 / 排序、演示播放、云协作、账号、位图语义分层和像素级编辑。

## 后续阶段建议

1. 加入基于 source location 的局部文本补丁，进一步减少序列化 diff；
2. 增加显式“脱离流式布局”操作和 Flex / Grid 专用属性面板；
3. 在现有静态多页识别上增加缩略图、页面复制和页面排序；
4. 增加选择穿透 / 同一点循环选择、参考线和更完整的组合变换；
5. 在本地 HTTP API 或 MCP 服务上复用现有命令层；
6. 增加 Playwright 覆盖导入目录、图片替换、拖拽坐标和下载内容；
7. 对超大文档增加增量树刷新与代码编辑器懒加载。

## License

本项目代码使用 MIT License。参考目录中的第三方项目保持各自许可证；本实现没有复制它们的源码。
