# Last Mile Studio UI 基线

日期：2026-07-19

范围：仅设计审计；不涉及应用、测试、依赖、脚本或运行时改动

证据：当前 `main` 工作区、源码检查、自动化浏览器审计，以及 1280×800、1440×900、1920×1080 下的截图

## 总体评估

Last Mile Studio 已经具备正确的产品中心：以源码为先的画布、可见的文档结构、直接操作、检查器和明确的源码抽屉。它克制的深色视觉语言比通用仪表盘更接近精准工作站。重设计应完善这套基础，而不是替换它。

主要问题是信息架构，而不是装饰。页面管理、Build 播放、Build 编排、选择对齐、画布几何和缩放都在争用中心工具栏。Pages 还占用第二条水平带，而 Build 在中心和检查器之间重复出现。结果是在 1920 px 下尚可，在 1440 px 的 deck 场景下紧张，在 1280 px 下发生裁切。

没有发现 P0 问题。基线有六类 P1：必要工具栏溢出、控件不可访问或定义不足、交互字号和目标尺寸过小、上下文层级薄弱、次要文字对比度低，以及演示审计 harness 不匹配。这些是重设计要求，不是本审计阶段修改代码的授权。

## 审计方法与证据边界

按要求的顺序应用了三个视角：

1. **UI UX Pro Max**——针对低动效、低变化度的高密度桌面开发者/编辑器系统进行查询。其最初偏营销的建议因大字号、紫色渐变和 Hero 构图与仓库契约冲突而被拒绝。保留的指导是扁平中性表面、单一功能性强调色、4/8 基础间距、可见焦点和画布优先层级。
2. **Impeccable**——从信息架构、层级、交互成本、一致性和完成度角度，对现有产品进行批评。本阶段只允许写入审计文档和产物，因此没有初始化产品上下文文件。
3. **Web Design Guidelines**——应用于可访问名称、标签、焦点、键盘替代方案、目标尺寸、状态播报、减少动效、对话框行为和响应式溢出。

证据具有三种不同含义：

- 现有单元测试和浏览器测试是**行为 oracle**。它们建立当前的源码同步、历史记录、导出、演示、页面、Build、片段和布局行为。
- `scripts/ui-visual-audit.mjs` 是**结构指标**。它检测溢出、缺少名称、小控件、过小交互文字、裁切、重复 ID 和运行时错误。它不能替代人的视觉判断。
- 捕获的 24 张截图是**视觉判断基线**。它们揭示层级和密度，但不能单独证明行为或可访问性。

## 当前界面盘点

| 界面 | 当前职责 | 主要实现 | 评估 |
|---|---|---|---|
| 顶部栏 | 产品身份、导入、撤销/重做、演示预览、导出 | `src/ui/editor-app.ts` `.topbar`、`#import-menu`、`#undo`、`#redo`、`#preview-presentation`、`#export-menu` | 全局职责合理；宽视口下中心空白过多，图标处理不一致仍存在。 |
| 左面板 | 图层树、添加元素、可见性/锁定/z-order、层级拖动 | `#layers-panel`、`#layers-tree`、`[data-layer-id]`、`[data-layer-action]` | 暴露了较强的文档模型，但永久绑定 Layers，无法承载 Pages 或 Fragments 上下文。 |
| 画布工具栏 | 对齐/分布、页面导航、Build 播放、画布尺寸、缩放 | `.canvas-toolbar`、`#page-control`、`#build-control` | 首要密度缺陷。不相关的范围共享一条不可换行的水平带。 |
| Pages 胶片条 | 页面缩略图和复制/移动/删除操作 | `#page-filmstrip`、`#page-thumbnails` | 能力有用，但消耗稀缺的画布垂直空间，并重复上方的页面导航。 |
| 画布 | 经清理的派生物、平移/缩放、直接操作、状态 | `#canvas-viewport`、`#canvas-host`、`.canvas-status` | 正确的产品中心。已编辑几何属性保持独立于视口尺寸。 |
| 右面板 | 垂直分割的 Build 序列和元素属性 | `#inspector-panel`、`#build-panel`、`#inspector-content` | 上下文目的地正确，但同时堆叠过长会降低总览，并迫使用户大量滚动。 |
| 源码抽屉 | 定位/搜索/格式化/应用源码和代码编辑器 | `#code-drawer`、`#toggle-code`、`#apply-code`、`#code-editor` | 源码优先边界正确。折叠状态紧凑，并释放画布高度。 |
| 导入/导出菜单 | 文档、项目、片段、本地库和自动化操作 | `#import-menu`、`#export-menu` | 能力分组合理，应保持全局。 |
| 片段对话框 | 保存片段、临时剪贴板、库、依赖报告 | `src/ui/fragment-workspace.ts` 对话框/库 ID | 工作流能力完整，但小字号和模态密度需要统一。 |
| 预览对话框 | 选择预览起点，然后运行演示 | `#preview-choice-dialog`、`#presentation-dialog` | 产品流程连贯；视觉审计场景尚未跟上选择步骤。 |

## 主要用户工作流

1. **打开或创建文档**——导入 HTML/SVG/项目/目录、粘贴源码或加载示例；文档类型会改变标签和可用的演示功能。
2. **浏览结构**——选择图层或页面，在树、画布、检查器和源码之间定位同一元素，并保持稳定的 `data-editor-id` 身份。
3. **可视化编辑**——在画布上选择一个或多个元素，进行变换、对齐/分布，并编辑几何、文字、外观、属性和内联样式。
4. **编排演示 deck**——管理页面，将元素分配到 Build 组，重排 Build 顺序，选择播放状态，并从起始页或当前页预览。
5. **使用片段**——将选择保存为 `.vfrag`，使用临时剪贴板或本地库，检查变量/依赖，并在不执行不可信代码的情况下插入。
6. **编辑规范源码**——展开抽屉，定位/搜索/格式化，明确应用代码，并返回同步的视觉派生物。
7. **导出**——导出 HTML/SVG、选定片段、可编辑项目、源码/资源包或结构 JSON。

## 层级、密度和一致性缺陷

### P1——中心命令带过载

`.canvas-toolbar` 同时暴露选择对齐、页面导航、Build 播放、画布尺寸和缩放。这些命令有四种不同的范围，却没有渐进式披露。在紧凑 deck 状态下，审计测得 640 px 的水平溢出；紧凑的页面折叠 deck 状态仍溢出 168 px。在 1440 px 下，deck 状态溢出 480 px，页面折叠 deck 状态溢出 8 px。

预期修正：永久显示紧凑模式条，仅在存在选择对象时显示选择操作，并将管理界面移到所属面板。必要控件绝不能要求水平滚动页面。

### P1——页面和 Build 职责重复

- Pages 同时由 `#page-control` 和 `#page-filmstrip` 表示。
- Build 播放位于 `#build-control`，而编排同时位于 `#build-panel`。
- 检查器标题同时描述“编排与属性”，但内容没有明确的 Design / Build / Advanced 心智模型。

预期修正：一个左侧上下文 Pages 目的地，一个右侧 Build 编排分组，以及画布上下文中只有紧凑的上一页/状态/下一页播放控件。

### P1——检查器中的上下文优先级薄弱

选中元素的检查器是很长的单列表单。在 1440×900 的选中基线中，外观/阴影和 Advanced 字段位于初始折叠线以下。它们仍可通过面板滚动访问，因此不是硬裁切，但层级导致常用属性和高级属性扫描成本相同。

预期修正：采用 Design、Build 和 Advanced 分组，将常用选择属性放在前面，并在分组折叠或切换时保持持久状态。

### P1——交互目标和交互文字过小

结构审计反复发现 20 px 图层控件、21 px Build 控件和 23 px 页面控件。这违反仓库规定的 28×28 px 纯图标按钮最小目标尺寸。完整的 8–10 px 交互文字盘点如下。

### P2——图标语言不一致

撤销/重做、添加形状/文字、z-order、收藏、展开/折叠、预览箭头以及若干片段/schema 操作使用 Unicode 字符作为可见含义。标题不一致，若干纯图标按钮缺少可访问名称。需要统一的本地内联 SVG 图标语言。

### P2——永久面板文字与工作内容竞争

眉题、重复标题、脚注和冗长工具标签占用空间，却没有建立更清晰的命令层级。重设计应保留有用的状态和说明文字，但将其放在至少 11 px，并把永久空间留给当前上下文。

## 可访问性和键盘缺陷

### P1 发现

- `src/ui/editor-app.ts`——使用 `[data-prop="fill"]` 和 `[data-prop="stroke"]` 生成的填充/描边文字输入没有唯一的可访问名称。每个输入都与颜色输入共享一个包裹标签；一个标签不能同时命名两个控件。选中场景在每个视口报告两个可见但无名称的控件；SVG 在紧凑/标准视口报告两个，在宽视口报告三个。
- `src/ui/editor-app.ts`——图层行使用 `[data-layer-id]` 和树语义，但没有完整的 roving-tabindex/树键盘交互。指针选择、选择后使用 F2 重命名和拖动句柄存在，但纯键盘发现和层级重新挂载不完整。
- `src/ui/editor-app.ts`——图层重新挂载主要依赖指针拖动（`[data-layer-drag-handle]`）。向上/向下 z-order 按钮没有提供等价的键盘层级移动/重新挂载路径。
- `#undo`、`#redo`、`#add-text`、`#add-shape`、页面/Build 字符按钮以及若干片段控件依赖 `title` 或可见字符，而不是一致的可访问名称契约。
- 小于 28×28 px 的控件即使在桌面端也会降低指针和触控精度。

### P2 发现

- `#notice-bar`、`#toast`、`#document-status`、`#selection-status` 和 `#sync-status` 没有明确的 `aria-live` 策略。状态应当在不持续打断编辑的情况下播报。
- CSS 有过渡，但没有全局 `@media (prefers-reduced-motion: reduce)` 规则。JavaScript 仅为一种图层滚动行为检查减少动效，不是完整的动效策略。
- `index.html` 声明了深色 `color-scheme` meta 值，而 CSS 没有设置 `color-scheme: dark`；原生表单控件应明确继承预期方案。
- 对话框需要记录焦点进入、焦点陷阱/原生对话框、Escape、焦点返回和 `overscroll-behavior: contain` 的验收序列。
- Impeccable 检测器报告 `fragment-workspace.ts` 的预览 `<img>` 没有初始 `src`。源码检查显示 `src` 在异步加载后赋值并带有回退；这是检测器误报，不是当前缺陷。

## 必须提升的现有 8–10 px 交互文字

以下所有交互文字都必须达到至少 12 px。非交互元数据必须达到至少 11 px。该盘点特意精确到选择器级别，使实现不能悄悄保留过小控件。

| 当前选择器或控件族 | 当前尺寸 | 要求处理 |
|---|---:|---|
| `.io-menu-panel button small` | 9 px | 辅助文字 11 px；按钮标签 12–13 px |
| `.layer-actions button` | 10 px | 12 px，最小目标 28 px |
| `.layer-row` 操作/展开/拖动控件 | 8–10 px | 12 px 文字，或 28 px 目标中的 16 px SVG 图标 |
| `.page-control select` | 10 px | 12 px |
| `#build-view-mode` | 9 px | 12 px |
| `.page-filmstrip-actions button` | 9 px | 12 px |
| `.page-thumbnail` 内容：`.page-thumbnail-number`、`.page-thumbnail-label`、`.page-thumbnail-builds` | 8–9 px | 在 12 px 控件上下文中使用 11 px 元数据 |
| `.canvas-size-control select` | 9 px | 12 px |
| `.canvas-size-control input` | 10 px | 12 px |
| `.build-selection-row select`、`.build-selection-row button` | 9 px | 12 px |
| 可点击/可拖动的 `.build-group > header > strong` 和 `> span` | 10 / 8 px | 标题 12 px，元数据 11 px |
| `.build-group-actions button` | 8 px | 16 px 图标或 12 px 标签，目标 28 px |
| 交互行中的 `.build-element span`、`.build-element code` | 8 px | 11–12 px |
| `.build-drop-zone` | 7 px | 指导标签至少 11 px |
| `.identity-navigation button` | 9 px | 12 px |
| `.checkbox` | 9 px | 12 px |
| `.field > span` 和 `.field input, .field select, .field textarea` | 10 px | 12 px |
| `.wide-button` | 10 px | 12 px |
| `.shadow-preset small` | 8 px | 元数据 11 px |
| `.shadow-control`、`.shadow-color` 及其输出控件 | 8–9 px | 11–12 px |
| `.code-toolbar button` | 10 px | 12 px |
| `.fragment-schema-row input, .fragment-schema-row select` | 10 px | 12 px |
| `.fragment-library-toolbar input, .fragment-library-toolbar select` | 10 px | 12 px |
| `.fragment-coordinate` 交互值 | 10 px | 12 px |
| `.fragment-card-actions button`、交互片段 `summary` 控件 | 8 px | 12 px，或 28 px 目标中的 16 px 图标 |

相关的非交互元数据也需要统一：`#page-count`、`#build-status`、画布状态/提示文字、眉题、面板脚注、片段卡片元数据以及拖放反馈必须至少 11 px。

## 对比度缺陷

当前 `--muted-2: #5f6878` 在 `--surface-1: #11141b` 上的对比度约为 3.28:1。它不满足 WCAG 普通文字对比度要求，并且经常与 8–10 px 字号一起使用。其他弱化组合约为 3.1:1 到 4.34:1。重设计必须在最深和抬高的永久表面上使用至少 `#8792a5`，即使在 `#202633` 上也能保持约 4.82:1。

## 响应式和裁切缺陷

| 视口/状态 | 结构结果 | 视觉解释 |
|---|---|---|
| 1280×800 默认 | `.canvas-toolbar` 溢出：60 px | 基本编辑可用，但命令带没有预留容量。 |
| 1280×800 deck | 溢出：640 px；`#canvas-width` 被裁切 | Pages、Build、尺寸和缩放不能共存于一行永久栏。 |
| 1280×800 deck 折叠 | 溢出：168 px；`#zoom-display` 被裁切 | 折叠胶片条不能解决工具栏范围过载。 |
| 1280×800 选中/SVG | 检查器控件被报告在视口以下 | 检查器滚动可以触达它们，但缺少常用/高级分组。 |
| 1440×900 deck | 溢出：480 px | 标准桌面仍无法承载完整 deck 命令布局。 |
| 1440×900 deck 折叠 | 溢出：8 px | 临界适配不是稳健的响应式策略。 |
| 1920×1080 默认 | 无明显溢出 | 层级平静，但顶部栏存在未使用空间，上下文仍重复。 |
| 所有演示场景 | 等待 `#presentation-dialog[open]` 的场景设置超时 | 审计点击 Preview，但产品首先打开 `#preview-choice-dialog`；捕获文件显示的是选择对话框，而不是演示模式。 |

已编辑文档本身没有跨视口改变几何属性。响应式缺陷被正确限制在应用外壳内。

## 按严重程度排列的发现

### P0——会导致发布停止的数据丢失、安全问题或核心任务不可访问

本次审计未观察到。

### P1——必须在相关迁移阶段内解决

| ID | 发现 | 精确位置 |
|---|---|---|
| B-P1-01 | 画布必要命令在紧凑和标准宽度的 deck 状态下溢出 | `src/styles.css` `.canvas-toolbar`；`src/ui/editor-app.ts` `#page-control`、`#build-control`、`.canvas-size-control`、`.zoom-control` |
| B-P1-02 | 两个可见的填充/描边文字输入没有唯一可访问名称 | `src/ui/editor-app.ts` 生成的 `[data-prop="fill"]`、`[data-prop="stroke"]` 控件 |
| B-P1-03 | 图层树和层级移动缺少完整的键盘交互模型 | `src/ui/editor-app.ts` `#layers-tree`、`[data-layer-id]`、`[data-layer-drag-handle]` |
| B-P1-04 | 核心/编辑器/片段界面的交互文字为 7–10 px，目标为 20–23 px | `src/styles.css` 上述选择器盘点；`src/ui/fragment-workspace.ts` 生成的控件 |
| B-P1-05 | Pages 和 Build 在永久区域之间重复，检查器上下文没有分组 | `#page-control`、`#page-filmstrip`、`#build-control`、`#build-panel`、`#inspector-content` |
| B-P1-06 | `--muted-2` 及相关弱化颜色不满足普通文字对比度 | `src/styles.css :root`，当前 `--muted-2: #5f6878` |
| B-P1-07 | 演示截图场景没有完成产品的预览选择流程 | `scripts/ui-visual-audit.mjs` 演示设置与 `src/ui/editor-app.ts` `#preview-choice-dialog` |

### P2——重要的完善或加固，只能在明确负责人下延期

| ID | 发现 | 精确位置 |
|---|---|---|
| B-P2-01 | Unicode 图标语言以及 tooltip/可访问性处理不一致 | `src/ui/editor-app.ts`、`src/ui/fragment-workspace.ts`、`src/ui/layout-controller.ts` 生成的字符控件 |
| B-P2-02 | 状态和临时反馈缺少明确的实时区域策略 | `#notice-bar`、`#toast`、`#document-status`、`#selection-status`、`#sync-status` |
| B-P2-03 | 没有全局减少动效 CSS 策略 | `src/styles.css` 过渡；缺少 `@media (prefers-reduced-motion: reduce)` |
| B-P2-04 | 深色原生控件及对话框过度滚动/焦点契约不明确 | `src/styles.css`、`index.html`、所有对话框界面 |
| B-P2-05 | 检查器可通过滚动访问，但常用和高级字段共用一条流，导致总览性差 | `#inspector-content` |
| B-P2-06 | 片段预览图检测器警告是已知误报；只有在改善检测器语义时才应抑制 | `src/ui/fragment-workspace.ts` 异步预览图片 |

## 受保护行为和钩子盘点

只要相关功能存在，以下内容必须保持稳定：

- 全局/文档：`#import-menu`、`#export-menu`、`#export-document-action`、`#export-document-label`、`#preview-presentation`、`#undo`、`#redo`、`#document-status`、`#selection-status`、`#sync-status`。
- 结构/布局：`#layers-panel`、`#layers-tree`、`[data-layer-id]`、`[data-layer-action]`、`[data-layer-drag-handle]`、`[data-layout-toggle]`、`[data-layout-resizer]`。
- 画布/页面/Build：`#canvas-viewport`、`#canvas-host`、`#page-filmstrip`、`#page-thumbnails`、`#build-control`、`#build-panel`。
- 检查器/源码：`#inspector-panel`、`#inspector-content`、`#code-drawer`、`#toggle-code`、`#apply-code`、`#code-editor`。
- 片段工作区：所有对话框/库 ID 以及 `[data-fragment-action]`、`[data-fragment-id]`、`[data-fragment-version]`、`[data-schema-field]`。
- 序列化/自动化：`[data-editor-id]`、`[data-editor-name]`、`[data-page-id]`、`[data-page-index]`、`[data-build]`、`[data-build-action]`、`[data-build-element-id]`、`[data-build-group]`、`[data-prop]`、`[data-shadow-part]`、`[data-shadow-output]`、`[data-shadow-preset]`、`[data-thumbnail-host]`、`[data-vfrag-definition-id]`、`[data-vfrag-definition-version]`。
- 布局持久化：存储键 `last-mile-studio:layout:v1`；任何 schema 变更都需要迁移。

必须保留的其他活动自动化钩子包括 `[data-editor-build-visibility]`、`[data-editor-canvas-height]`、`[data-editor-canvas-width]`、`[data-editor-preview-page-root]`、`[data-editor-scale-x]`、`[data-editor-translate-x]`、`[data-font-status]`、`[data-inspector-action]`、`[data-label]`、`[data-layer-name]`、`[data-layer-toggle]` 和 `[data-load-example]`。

## 截图索引

所有文件位于 `artifacts/ui-audit/`。

| 场景 | 1280×800 | 1440×900 | 1920×1080 |
|---|---|---|---|
| 默认 | `compact__default.png` | `standard__default.png` | `wide__default.png` |
| 选中元素 | `compact__selected.png` | `standard__selected.png` | `wide__selected.png` |
| Deck | `compact__deck.png` | `standard__deck.png` | `wide__deck.png` |
| Deck，Pages 折叠 | `compact__deck-collapsed.png` | `standard__deck-collapsed.png` | `wide__deck-collapsed.png` |
| SVG | `compact__svg.png` | `standard__svg.png` | `wide__svg.png` |
| 源码展开 | `compact__code.png` | `standard__code.png` | `wide__code.png` |
| 片段库 | `compact__fragment-library.png` | `standard__fragment-library.png` | `wide__fragment-library.png` |
| 演示 | `compact__presentation.png` | `standard__presentation.png` | `wide__presentation.png` |

三份演示文件显示预览起点选择对话框，这是因为 B-P1-07。完整的机器可读审计位于 `artifacts/ui-audit/report.json`。
