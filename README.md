# AfterPrompt — Visually refine what AI generates.

AfterPrompt 是一个面向 AI 生成 HTML、HTML Slide 和 SVG 的可视化精修编辑器。它直接编辑真实 DOM / SVG 节点，并持续生成可读、可导出的标准源代码；没有把页面栅格化，也没有把 Canvas 状态当作唯一数据源。

当前版本是可运行的 MVP（`0.4.0`），已经完成 Phase 1–4，并提供 local-first 视觉片段、组件保存与复用主链路：

```text
HTML / SVG 源码 → 安全解析与稳定 ID → 真实节点画布
      ↑                                  ↓
      └──── CodeMirror / JSON 命令 / CLI ← 视觉操作

选中 DOM / SVG → Visual Fragment → 用户本地目录中的 .vfrag
                         ↓
        冲突预检 → 独立副本或关联实例 → 仍回写标准 DOM / SVG
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
npm run build:production # 为 /last-mile-studio/ 生成无 source map 的生产制品
npm run test         # 核心自动化测试
npm run test:browser # 可选：用本机 Chrome/Chromium 跑真实 UI 冒烟测试
npm run check        # 核心测试 + 生产构建
npm run cli -- --help
```

如果浏览器测试找不到 Chrome：

```bash
CHROME_PATH=/path/to/chrome npm run test:browser
```

## 生产部署

当前生产拓扑使用系统 Nginx 直接服务不可变静态制品，不运行 Vite preview 或常驻 Node 进程。发布采用版本目录、SHA-256 校验、原子 `current` 链接和显式回滚；IP HTTPS 使用自动续期的 Let's Encrypt 短期证书。

完整的首次部署、日常升级、验收和回滚流程见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 已实现能力

### 导入、画布与双向同步

- 顶栏只保留“导入”一个入口，并按打开文档、插入当前页面、片段库和示例分组现有能力；
- 导入 `.html`、`.htm`、`.svg` 和 `.visual-project.json`；
- 直接粘贴 HTML / SVG；
- 使用目录选择器载入简单本地项目，优先选择 `index.html`，并解析本地 CSS、SVG 和图片；
- 在隔离的 Shadow DOM 中渲染静态 HTML，在原生 SVG DOM 中渲染 SVG；
- 自动识别 `deck-stage > section` 等静态多页演示稿，读取演示稿尺寸，并通过上一页 / 页面选择器 / 下一页逐页编辑；
- 多页胶片栏使用裁剪后的真实 DOM 渲染页面缩略图，并支持点击切页；
- 页面复制会为整棵子树分配新稳定 ID；页面删除、按钮排序和拖拽排序均进入 Undo / Redo；
- 提供 16:9（1920×1080）、4:3（1024×768）和自定义画布尺寸；尺寸切换不会暗中缩放页面元素；
- 左侧图层、右侧编排/属性、上方 PAGES 均可拖拽调整或折叠；Build 编排与元素属性也可上下分配空间，布局偏好保存在当前浏览器；
- 画布右侧和底部提供可拖动的纵向/横向滚动滑块；触控板双指或滚轮也可上下左右平移视图，`Shift + 滚轮` 可横向平移，`Ctrl/Cmd + 滚轮` 以指针位置为中心缩放，并保留 Space/中键拖动画布和适应窗口；
- 画布修改后更新底层源码；代码修改通过“应用代码”重新解析并更新画布；
- 代码解析失败时保留上一个有效画布，不覆盖有效版本。

### 演示预览与保真 HTML 导出

- 原生识别正整数 `data-build`，同一步元素作为一组累计出现；页面与 Build 是互相独立的编辑维度；
- 编辑器提供 Playback State、Current Group 和 All Builds 三种视图；后续 Build 中的真实元素仍可选择、移动、缩放和双击编辑；
- Build 编排面板支持设置/移除 Build、拖动元素跨组、拖动组排序、新建、拆分和合并，所有文档变更进入 Undo / Redo 并同步标准源码；
- 页面缩略图默认显示 Final Build，并标记每页 Build 数；非法 Build 值和父子 Build 可见性冲突会明确提示；
- 在隔离 iframe 中预览当前 HTML 演示稿，前进时先推进当前页 Build，完成后再翻页；后退时先撤销 Build，Initial 再返回上一页 Final；同时支持方向键、Page Up / Page Down、Home / End 和全屏；
- HTML 只保留一种“导出 HTML”：直接导出修改后的完整源文档，保留源文件自己的脚本、事件处理器和 Presentation controls；
- 完整源码在编辑器中仅作为惰性 DOM 数据保存；画布只渲染再次净化的克隆，不执行导入脚本；
- 重新导入会恢复页面、Build、稳定 ID、画布与原生运行时；旧版 `*-slides.html` 仍会尽力解包；
- 导出时内嵌已导入的本地 CSS、图片、SVG 和字体资源，无法解析的本地资源会明确提示；
- 编辑器内演示预览仍使用禁止源脚本的隔离播放器；下载导出不再用 LMS 播放外壳替换源文件运行时；
- 演示预览是规范 HTML DOM 的安全派生视图，保真导出则直接序列化规范文档。
- 对要求跨机器排版一致的演示稿，可在根 `<html>` 设置 `data-lms-deterministic-font="inter"`；编辑器和导出会使用同一份内嵌 Inter Variable WOFF2，并在字体就绪后进行最终渲染；
- 编辑器与内部演示播放器从 `presentation-layout.ts` 复用固定页面盒模型，viewport 只缩放最外层画布，不改变设计坐标中的文字换行；
- `npm run test:layout-parity` 会按 `data-editor-id` 对比真实浏览器中的字体、行数和 client/scroll 几何，默认容差为 0.5 px；
- vendored Inter 字体使用 SIL Open Font License 1.1，许可证位于 `src/assets/fonts/Inter-OFL-1.1.txt`。

### 视觉片段、组件与本地库

- 将单个元素或多选元素组保存为 `element`、`group`、`component` 或 `template`；
- Source-preserving 模式保留节点、class 和匹配的 CSS 声明；Self-contained 模式额外捕获计算样式；
- 计算选区包围盒并保存局部坐标，可在原位置、画布中心、最近鼠标位置或指定坐标插入；
- 自动收集本地图片、字体、CSS URL、CSS 变量和选区外 SVG defs，并生成 SVG 缩略图；
- `.vfrag` 是带版本的 ZIP 包：1.0 保存 HTML/SVG 结构，1.1 保存单层 PNG/JPEG Raster；公开 Schema 位于 [schemas/visual-fragment-manifest.schema.json](schemas/visual-fragment-manifest.schema.json)；
- 导入前验证 Schema、ZIP 路径与大小，并展示普通 ID、编辑器 ID、CSS、字体和资源兼容性报告；
- 重写 HTML/SVG IDREF、CSS `#id`、SVG `href` 和 `url(#id)`，同一片段重复插入不会静默冲突；
- 用户可连接一个本地目录，目录内 `.vfrag` 文件是长期事实源；刷新或重新连接后从文件 manifest 重建库；
- IndexedDB 明确作为“临时片段剪贴板”，只服务 `Ctrl/Cmd+C`、`Ctrl/Cmd+V` 和旧片段迁移；它可能被浏览器清理，不承担长期保存，也不作为保存对话框目标；
- 从“导入 → 片段或图片”可直接把 `.vfrag`、原始 `.svg`、`.png`、`.jpg` 和 `.jpeg` 插入当前页面，不会自动写入片段库；SVG 保留节点树，Raster 只生成一个图片图层；
- 组件可暴露文本、数字、颜色、图片、图标、布尔、枚举、尺寸和 URL 属性，也可定义有类型和尺寸约束的内容插槽；
- 片段可插入为独立副本或关联实例；定义升级和“同步实例”是显式操作，并保留实例级属性覆盖与已填充插槽；
- 支持导出 `.vfrag`、标准 SVG、HTML/CSS ZIP、预览 SVG/PNG，以及复制标准 HTML/SVG 源码。
- 顶栏“导出”按当前文档、选区片段、可编辑项目、资源 ZIP 和 AI 结构 JSON 集中提供所有导出格式。

### 选择、变换与属性

- 点击画布或图层树选择节点；Ctrl / Shift 点击多选；Alt 点击选择父级；
- 非文字编辑状态下，`Ctrl/Cmd+C` 将选区复制到应用内临时片段剪贴板，`Ctrl/Cmd+V` 粘贴最新片段并按 16 px 连续偏移；HTML 粘贴根会作为独立绘制组置于当前页面最前方，组内子级保留原有层次；输入框和代码编辑器仍使用系统原生剪贴板；
- Moveable 驱动的拖动、缩放、旋转、吸附控制框；
- SVG `path`、`polygon`、`polyline`、`line`、`text` 与分组等无原生宽高节点使用固定点变换缩放；
- X、Y、W、H、旋转角度的精确输入；
- 方向键 1 px 微调，Shift + 方向键 10 px 微调；
- 单元素对齐画布，多元素对齐与水平/垂直分布；
- 双击画布文字直接编辑，或在属性面板编辑文字；
- 字体使用可选目录；Times New Roman、微软雅黑、宋体和楷体优先使用本机合法安装版本，缺失时明确提示并分别回退到内嵌的 Liberation Serif、思源黑体 SC、思源宋体 SC 和霞鹜文楷 Lite；
- 字号、字重、行高、数字化字间距、对齐和文字颜色；
- HTML 背景 / SVG 填充、可见描边、透明度、圆角、可视化单层阴影和滤镜；
- HTML `img` / SVG `image` 路径修改和本地图片替换；
- CSS class 与 inline style 编辑。

内嵌的 Liberation Serif、思源黑体 / 思源宋体和霞鹜文楷均使用 SIL Open Font License 1.1，许可证随字体位于 `src/assets/fonts/catalog/`。Windows 提供的 Times New Roman、微软雅黑、宋体和楷体不会被复制或打包；编辑器仅在浏览器确认本机存在时使用它们。

### 图层、历史与代码

- 统一的 DOM / SVG 层级树，显示节点类型、名称、显隐和锁定状态；
- 画布或其他面板选中元素后，图层树会自动展开祖先并把对应行定位到可视区域中央；分支可独立折叠；
- 双击图层名称或按 `F2` 可行内重命名；显隐、锁定、复制、删除和同级顺序调整仍使用现有命令或快捷键；
- 拖动行首手柄时，上/中/下三区分别表示插入到前面、成为子级和插入到后面；单次只允许同级排序、缩进一级或提升一级，复杂跨父级移动需要分步完成；
- 合法换父级会保持画布位置和尺寸；若新坐标系无法在 1 px 容差内可靠补偿，则整次操作回滚；
- 添加文本和基础矩形；
- Undo / Redo；连续 Moveable 手势只在结束时写入一次历史；
- CodeMirror 语法高亮、行号、搜索、选中元素定位；
- 代码区默认收起，收起时仅保留“展开源码”入口并把空间完整返还给画布；展开后恢复完整源码工具栏；
- Prettier 按需加载并格式化 HTML / SVG；
- 所有视觉编辑完成后，代码视图同步到当前有效源代码。

### 导出与 Codex 控制

- 导出标准 `.html` 或 `.svg`；
- 导出包含源代码、画布尺寸、稳定 ID、元数据和资源的 `.visual-project.json`；
- 项目文件保留最近 500 条 UI、代码、历史与 CLI 操作日志；
- 导出包含入口文件与本地资源的 ZIP；
- 导出 AI 易读的页面结构 JSON；浏览器导出包含实际渲染后的边界；
- 本地 CLI 支持查询、获取、准备稳定 ID、批量执行 JSON 命令、验证和导出；
- CLI 还能创建、检查、验证、插入和查询 Visual Fragment；
- 命令层支持修改、移动、缩放、旋转、文字、样式、添加、删除、显隐、锁定、重排、组件属性、插槽插入和解除实例关联。
- Build 结构化命令与界面复用同一个文档模型入口，支持设置元素 Build、移动/合并 Build 组和拆出新组。

## 基本使用方法

### 编辑 HTML Slide

1. 打开顶部“导入”，选择“文档文件”“项目目录”或“粘贴 HTML / SVG”；
2. 在画布中点击标题、图片、色块或内嵌 SVG；
3. 拖动控制框，或在右侧属性面板输入精确值；
4. 在下方代码视图确认 `data-editor-id`、属性和样式变化；
5. 使用“演示预览”检查播放效果，再点击“导出 HTML”；该文件既可直接播放，也可重新导入继续编辑。

### 管理多页演示稿

1. 从“导入 → 示例”选择 `Multi-page deck`，或导入包含 `deck-stage > section`、`.slides > section` 等结构的 HTML；
2. 点击胶片栏缩略图切换页面；
3. 使用“复制页”“删除页”“前移”“后移”，或直接拖动缩略图调整顺序；
4. 在画布尺寸菜单选择 16:9、4:3 或手动输入尺寸；
5. 点击“演示预览”检查键盘翻页，再点击“导出 HTML”。

### 编辑和编排 Build

1. 导入包含正整数 `data-build` 的静态 HTML 演示稿；顶部 Build 控件会显示 `Initial / N`；
2. 用 Previous / Next Build 在真实累计播放状态之间切换；编辑模式到达 Final 后不会自动翻页；
3. 切换到 `Current Group` 聚焦当前组，或用 `All Builds` 查看并选择所有隐藏元素；
4. 在右侧 Build 编排面板中选择元素并设置为已有组、New Build 或 Always Visible；也可拖动元素跨组、拖动组标题排序；
5. 使用拆分和合并调整同一步分组，随后用 Undo / Redo 验证编排；源码中的 `data-build` 会同步更新，临时 `revealed` 状态不会写入源码；
6. 用“演示预览”和“导出 HTML”验证 Build-first 播放语义，并将导出文件重新导入确认 Build 仍可编辑。

### 编辑 SVG

1. 从“导入 → 示例”选择 `SVG shapes`，或导入自己的 `.svg`；
2. 从图层树选择 `text`、`rect`、`circle`、`path` 或 `g`；
3. 直接变换，或编辑填充、描边、文本和图层顺序；
4. 导出后可直接用浏览器打开 SVG。

### 修改代码并返回画布

代码区允许自由编辑。只有点击“应用代码”后，草稿才会成为新的有效文档；如果 SVG 语法错误，错误会显示在工具栏中，画布仍保留上一个有效版本。点击“定位选中元素”会搜索当前稳定 ID。

### 保存和复用视觉片段

1. 打开“导入 → 本地片段库”并选择一个本地目录；目录中的 `.vfrag` 是长期事实源。不支持目录访问时仍可下载 `.vfrag`；
2. 在画布或图层树选择一个或多个元素，打开“导出 → 导出选区为片段”；
3. 填写名称、版本、分类和标签，选择 Source-preserving 或 Self-contained。已连接目录时默认写入目录，否则默认下载 `.vfrag`；保存对话框不会写入临时剪贴板；
4. 对 `component` / `template`，用结构化表单指定属性绑定和内容插槽；
5. 使用 `Ctrl/Cmd+C` 将当前选区放入临时片段剪贴板，`Ctrl/Cmd+V` 粘贴最新记录；也可从“导入 → 临时片段剪贴板”管理历史；
6. 从“导入 → 片段或图片”直接插入 `.vfrag/.svg/.png/.jpg/.jpeg`，或在本地片段库中搜索定义、选择独立副本或关联实例；Raster 只支持独立副本；
7. 阅读兼容性报告并确认后，片段才会写入当前文档；
8. 选中组件实例可直接编辑暴露属性、解除关联，或从本地库显式同步最新版。

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

创建、检查并插入 `.vfrag`：

```bash
npm run cli -- fragment-create examples/ai-slide.html \
  --elements title-001 --name reusable-title \
  --type component --mode self-contained \
  --schema examples/title-component-schema.json \
  --output /tmp/reusable-title.vfrag

npm run cli -- fragment-inspect /tmp/reusable-title.vfrag
npm run cli -- fragment-validate /tmp/reusable-title.vfrag

npm run cli -- fragment-insert examples/ai-slide.html \
  --fragment /tmp/reusable-title.vfrag \
  --parent slide-001 --placement 120,80 --linked \
  --output /tmp/ai-slide-with-fragment.html

npm run cli -- fragments /tmp/ai-slide-with-fragment.html
```

将原始 SVG、PNG 或 JPEG 封装为 `.vfrag`：

```bash
npm run cli -- fragment-pack logo.svg --name logo --output /tmp/logo.vfrag
npm run cli -- fragment-pack photo.jpg --name photo --output /tmp/photo.vfrag
```

`fragment-create --schema component-schema.json` 可定义 `properties` 与 `slots`。CLI 输出普通 HTML/SVG 时会把包内资源写到输出文件旁的 `fragments/`；输出 `.visual-project.json` 时资源嵌入项目文件。

命令文件可以是单个对象，也可以是对象数组。完整契约见 [docs/COMMAND_API.md](docs/COMMAND_API.md)。

## 示例与验收材料

- [examples/ai-slide.html](examples/ai-slide.html)：标题、两段正文、本地图片、色块和内嵌 SVG 图标；
- [examples/multi-page-deck.html](examples/multi-page-deck.html)：页面管理、Build 状态/编排、预览和保真导出的三页演示稿；
- [examples/simple-page.html](examples/simple-page.html)：目录导入示例，依赖本地 CSS 和图片；
- [examples/shapes.svg](examples/shapes.svg)：`text`、`rect`、`circle`、`line`、`path`、`polygon` 和 `g`；
- [examples/codex-commands.json](examples/codex-commands.json)：修改标题、移动图片、修改色块、删除图标；
- [examples/title-component-schema.json](examples/title-component-schema.json)：CLI 创建组件时使用的结构化属性 Schema；
- [tests/document-model.test.ts](tests/document-model.test.ts)：解析、净化、稳定 ID、HTML/SVG 命令与错误恢复；
- [tests/presentation.test.ts](tests/presentation.test.ts)：页面操作、资源内嵌、Build-first 状态机、可逆 HTML 往返和播放安全边界；
- [tests/fragments.test.ts](tests/fragments.test.ts)：Schema、包往返、冲突修复、组件属性/插槽、实例同步和本地库；
- [scripts/browser-smoke.mjs](scripts/browser-smoke.mjs)：真实浏览器中的基础编辑、页面管理、Build A/B、HotCarbon 真实样本，以及完整 Visual Fragment 保存—插入—修改—升级链路；
- [scripts/oom-regression-smoke.mjs](scripts/oom-regression-smoke.mjs)：使用受版本控制的确定性 18 页大型夹具，验证惰性缩略图、共享样式表、规范 DOM—画布—`.vfrag` 结构一致性、历史操作、导出尺寸和浏览器堆指标，不依赖被忽略的 `problem/` 本地文件。

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
│   ├── fragments/               # Schema、包、提取、导入、组件语义与本地库
│   ├── presentation.ts          # 独立 HTML Slides 与资源内嵌
│   ├── project.ts               # 本地资源、项目 JSON 与 ZIP
│   ├── sanitizer.ts             # 静态内容安全边界
│   └── types.ts                 # 公共数据与命令类型
└── ui/
    ├── code-editor.ts           # CodeMirror 适配
    ├── fragment-workspace.ts    # 保存对话框、本地库、兼容性报告与实例属性
    ├── layout-controller.ts     # 可拖拽、可折叠的工作台布局与本地偏好
    └── editor-app.ts            # 工作台编排
```

架构细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，片段格式和语义见 [docs/VISUAL_FRAGMENTS.md](docs/VISUAL_FRAGMENTS.md)，本地参考项目和技术选型比较见 [docs/TECHNICAL_DECISIONS.md](docs/TECHNICAL_DECISIONS.md)，安全模型见 [docs/SECURITY.md](docs/SECURITY.md)。

本地第三方参考仓库和旧演示素材统一保存在 `reference/`，该目录被 Git 忽略，不属于本项目发布内容。

## 安全默认值

导入内容被当作静态视觉文档，而不是可信应用：

- 删除 `script`、`iframe`、`object`、`embed`、SVG 动画和 `foreignObject`；
- 删除 `on*` 事件、`srcdoc`、`javascript:`、`vbscript:` 和非图片 `data:` URL；
- 禁用 CSS `@import`、`expression()` 和危险 CSS URL；
- 不提供本地命令执行通道；
- 外部资源会被标记，外部 CSS 不会注入预览；
- 项目目录资源只在浏览器内映射为临时 Blob URL。
- `.vfrag` 导入限制压缩包大小、文件数、单文件和解压总量，拒绝绝对路径、反斜杠与 `..` 路径；
- 片段脚本权限固定为 `false`；外部和缺失资源进入兼容性报告，不由导入器主动下载。

这不是通用 HTML 恶意内容沙箱。不要把本工具部署成允许匿名用户互相打开文档的多租户服务，除非再增加严格 CSP、进程隔离和服务端净化。

## 明确限制

当前 MVP 不声称完整支持所有网页或 SVG：

- 画布只支持静态视觉编辑；导入页面的 JavaScript 不在编辑器内执行，但会保留到 HTML 导出；
- 视觉修改写入 inline style 或标准 SVG 属性，不会反向编辑复杂样式表规则；
- 对 Flex / Grid 流式元素使用可逆的 CSS transform，避免无提示改成绝对定位；尚未提供“转换为自由定位”的显式命令；
- 多选支持组拖动、对齐和分布；多选组缩放与组旋转暂未开放；
- HTML 中由 class 样式表定义的既有 `transform` 可能在首次变换时被 inline transform 覆盖；既有 inline transform 和 SVG transform 会被保留并组合；
- 复杂富文本直接替换文本时可能移除内部标签，因此属性面板只把叶子或文本型节点作为文本对象；
- 浏览器导出的结构 JSON 使用真实布局边界；CLI 没有浏览器布局引擎，只能使用声明式 CSS / SVG 几何，并对纯文本自动高度作近似估算；
- DOMParser 会修复不规范 HTML，序列化会统一标签和属性格式。未编辑的语义结构、class、id、注释和资源引用会保留，但无法保证逐字符 diff；
- 高级 SVG 滤镜、mask、clipPath、textPath、动画和外部脚本不在可靠编辑范围；
- 页面管理只支持可静态识别、且页面节点共享同一容器的 HTML 演示稿；不会执行 Reveal.js、SlideV 或自定义框架的原始运行时；
- 导出 HTML 会内嵌已导入的本地资源，但保留外部 HTTP(S) 引用；离线播放前应确认没有外部依赖；
- 画布比例切换只修改画布和已识别 deck 的尺寸元数据，不会自动重排或缩放页面内元素；
- Source-preserving 会保留源结构和匹配声明，但依赖复杂祖先选择器时只能以局部映射声明回退；Self-contained 更便携，但产生的 CSS 更详细；
- 浏览器无法读取的跨域样式、外部字体或网络资源不会被伪装成已打包内容；兼容性报告会保留这些依赖；
- HTML 缩略图的完整视觉版本是 `preview.svg`；若浏览器因 `foreignObject` 的 canvas 安全规则拒绝直接编码 PNG，PNG 导出会明确提示并使用文字、尺寸和配色摘要回退；
- 关联实例仅在用户点击同步时更新当前文档；没有后台更新、跨项目自动迁移或云端版本解析；
- PNG/JPEG 是不可分解的单个 Raster 图层，不提供 OCR、自动分层、矢量化或像素级编辑；
- 尚未提供云协作、账号、云存储或同步。

## 后续阶段建议

1. 加入基于 source location 的局部文本补丁，进一步减少序列化 diff；
2. 增加显式“脱离流式布局”操作和 Flex / Grid 专用属性面板；
3. 增加选择穿透 / 同一点循环选择、参考线和更完整的组合变换；
4. 在本地 HTTP API 或 MCP 服务上复用现有命令层、Fragment API，并按需增加页面级命令；
5. 增加 Playwright 覆盖导入目录、图片替换和更复杂的 CSS/SVG 资源组合；
6. 对超大文档增加缩略图虚拟化、增量树刷新与代码编辑器懒加载。

## License

AfterPrompt 自 2026-07-20 起对项目自有代码和文档采用
[Apache License 2.0](LICENSE)。它允许使用、修改和商业分发，同时要求保留
相关声明，并明确处理贡献者专利授权；旧 MIT 版本的授权历史见
[RELICENSING.md](RELICENSING.md)。

“AfterPrompt”名称、Logo、图标及其他品牌标识不随代码授权，具体边界见
[TRADEMARKS.md](TRADEMARKS.md)。内嵌字体和第三方依赖继续遵循各自许可证，
清单见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。用户导入、编辑或
导出的内容不会因此自动改用项目许可证。
