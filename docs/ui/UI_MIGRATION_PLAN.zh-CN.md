# Last Mile Studio UI 迁移计划

状态：拟议的实现顺序；本文档不授权开始实现

## 迁移不变量

- 只在 `main` 上工作，保留无关改动，并使用 Node.js 22 或更高版本。
- 不迁移 UI 框架，不新增生产依赖。
- `SourceDocument.document` 保持规范状态；画布保持为经清理的派生物。
- 保持标准 HTML/SVG 序列化、稳定的 `data-editor-id`、选择状态、历史记录、导出、片段、源码同步。
- 应用外壳的响应式行为绝不能修改已编辑文档的几何属性。
- 保留受保护的 ID、`data-*` 钩子、键盘调整大小、布局偏好，以及源码抽屉默认折叠和 `展开源码` / `收起源码` 标签。
- 每个阶段只处理一个连贯界面，最多涉及五个源文件和约 500 行非生成改动。若一个连贯改动超过此边界，应在编辑前拆分。
- 在 1280×800、1440×900 和 1920×1080 下采集前后截图。每个实现阶段后运行 Impeccable 和 Web Design Guidelines 评审；在最多三轮内修复范围内的 P0/P1 问题。

## 通用受保护契约

受保护选择器包括：

`#import-menu`、`#export-menu`、`#export-document-action`、`#export-document-label`、`#preview-presentation`、`#undo`、`#redo`、`#document-status`、`#selection-status`、`#sync-status`、`#layers-panel`、`#layers-tree`、`[data-layer-id]`、`[data-layer-action]`、`[data-layer-drag-handle]`、`[data-layout-toggle]`、`[data-layout-resizer]`、`#canvas-viewport`、`#canvas-host`、`#page-filmstrip`、`#page-thumbnails`、`#build-control`、`#build-panel`、`#inspector-panel`、`#inspector-content`、`#code-drawer`、`#toggle-code`、`#apply-code`、`#code-editor`、所有片段对话框/库 ID，以及 `UI_BASELINE.md` 中盘点的自动化钩子。

持久化布局键 `last-mile-studio:layout:v1` 必须保持可读。如果未来阶段增加活动栏/上下文状态，必须迁移或扩展之前的状态，而不是丢弃它。

## 阶段 1——视觉基础

**连贯界面：** 仅处理设计 token 和共享基础控件样式。

- 范围：语义颜色、字号层级、间距、圆角、层级、动效、控件高度、可见焦点、原生深色方案、减少动效，以及本地化图标基础组件。
- 预期文件：`src/styles.css`；如果行为/标记需要，最多增加一个位于 `src/ui/` 下的小型本地图标辅助文件，以及对应的聚焦测试。
- 预计差异：250–450 行。
- 不得改变：布局区域、命令位置、文档行为、选择行为、序列化或自动化钩子。
- P1 目标：B-P1-04、B-P1-06；只有在局限于基础控件/控件标记的情况下，才可包含可访问名称修复。
- 门禁：`bash scripts/ui-gate.sh fast`，然后 `bash scripts/ui-gate.sh checkpoint`；对所有默认/选中/SVG 状态进行截图比较。
- 回滚边界：仅回滚 token/基础控件改动和可选图标辅助文件；后续阶段不依赖未提交的基础工作。

## 阶段 2——全局外壳与活动栏

**连贯界面：** 顶部栏、工作区网格和活动栏容器。

- 范围：48 px 全局顶部栏、42 px 活动栏（Layers/Pages/Fragments 目的地）、响应式列 token，以及保留可折叠/可调整大小的面板外壳。
- 预期文件：`src/ui/editor-app.ts`、`src/ui/layout-controller.ts`、`src/styles.css`、一个聚焦的 UI/布局测试文件；只有在新行为需要覆盖且不改变现有断言时，才修改 `scripts/browser-smoke.mjs`。
- 预计差异：350–500 行。
- 必须保留：所有全局 ID、导入/导出文档类型标签、撤销/重做、预览、布局键盘调整大小、现有存储恢复、画布最小宽度、源码抽屉高度，以及切换活动栏目的地时当前活动文档状态不变。
- 不得臆造：History、Search、云端、协作、账户或设置目的地。
- 门禁：fast + checkpoint + canvas；在三个视口下验证恢复后的折叠/宽度偏好和所有全局操作。
- 回滚边界：活动栏/外壳标记、控制器扩展和相关 CSS/测试一起回滚；规范文档代码保持不变。

## 阶段 3——左侧上下文导航

**连贯界面：** 左面板中的 Layers、Pages 和 Fragments 视图。

- 范围：活动栏路由；将现有页面缩略图/管理界面移入 Pages 上下文；在 Fragments 上下文中暴露现有片段发现/插入入口；完成图层树键盘选择和重排/重新挂载替代路径。
- 预期文件：`src/ui/editor-app.ts`、`src/ui/layout-controller.ts`、`src/ui/fragment-workspace.ts`、`src/styles.css`、一个聚焦的测试/浏览器文件。
- 预计差异：400–500 行。如果超过此边界，将 Fragments 拆成后续子阶段。
- 必须保留：`#layers-panel`、`#layers-tree`、`[data-layer-*]`、`#page-filmstrip`、`#page-thumbnails`、所有页面操作/快捷键、片段 ID/存储/导入安全、稳定的选择身份，以及树/画布/源码同步。
- 门禁：fast + checkpoint + canvas；树导航/重新挂载的纯键盘序列；页面复制/重排/删除；片段库打开/搜索/插入。
- 回滚边界：每个上下文视图仍由现有命令支持。回滚路由/位置时，不回滚页面、图层或片段领域行为。

## 阶段 4——画布上下文控件

**连贯界面：** 画布模式行和条件式选择条。

- 范围：重组 `.canvas-toolbar`；保留紧凑页面/Build 播放、画布尺寸和缩放/适应控件；只在相关选择存在时显示对齐/分布；在紧凑宽度下使用受控溢出/弹出层。
- 预期文件：`src/ui/editor-app.ts`、`src/styles.css`、一个聚焦的 UI 测试，以及只有为修正场景设置或增加结构断言时才修改的 `scripts/ui-visual-audit.mjs`。
- 预计差异：250–450 行。
- 必须保留：`#page-control`、`#build-control`、页面/Build 键盘快捷键、画布尺寸语义、缩放/适应、选择对齐语义、`#canvas-viewport`、`#canvas-host`，以及不改变已编辑布局的视口不变性。
- P1 目标：B-P1-01，以及在修改审计脚本时处理 B-P1-07 的演示场景部分。
- 门禁：fast + checkpoint + canvas；在三个视口的默认、选中、deck、deck 折叠和 SVG 状态下，结构审计必须报告零外壳水平溢出。
- 回滚边界：工具栏标记/样式/测试作为一个整体回滚；不修改模型或画布渲染器。

## 阶段 5——上下文检查器

**连贯界面：** 右侧检查器的信息架构。

- 范围：Design、Build 和 Advanced 分组；常用属性在前；仅在支持时显示 Build；为颜色/文字成对控件提供明确的可访问标签；保持可持久化的展开状态。
- 预期文件：`src/ui/editor-app.ts`、`src/ui/layout-controller.ts`、`src/styles.css`、一个检查器聚焦测试/浏览器文件。
- 预计差异：350–500 行。
- 必须保留：`#inspector-panel`、`#inspector-content`、`#build-panel`、`[data-prop]`、`[data-inspector-action]`、`[data-shadow-*]`、Build 排序/分配、实时源码同步、历史边界，以及切换分组时当前字段值不变。
- P1 目标：B-P1-02、B-P1-05 以及 B-P1-04 的检查器部分。
- 门禁：fast + checkpoint + canvas；选中 HTML/SVG、多选、Build 分配/重排、键盘标签/焦点、撤销/重做、源码同步。
- 回滚边界：分组外壳和布局状态回滚，但不改变属性/Build 命令实现。

## 阶段 6——片段与临时工作流

**连贯界面：** 片段保存/库/报告对话框和共享临时状态行为。

- 范围：规范对话框层级、字号、目标尺寸、图标、空/错误/加载状态、焦点返回、Escape 行为、过度滚动限制，以及状态/实时区域策略。
- 预期文件：`src/ui/fragment-workspace.ts`、仅用于共享临时/状态基础组件的 `src/ui/editor-app.ts`、`src/styles.css`、一个片段聚焦测试文件，以及必要时的 `scripts/browser-smoke.mjs`。
- 预计差异：300–500 行。
- 必须保留：所有片段 ID/`data-*` 钩子、存储 schema、`.vfrag` 导入/导出、版本/依赖报告、临时剪贴板行为、不可信脚本安全，以及对话框自动化覆盖。
- P1/P2 目标：B-P1-04 的片段部分和 B-P2-01/B-P2-02/B-P2-04。
- 门禁：fast + checkpoint；保存、取消、重新打开、库过滤、插入、依赖报告、键盘焦点/返回、空/错误状态截图。
- 回滚边界：临时界面呈现改动回滚时，不修改片段序列化/存储逻辑。

## 阶段 7——源码抽屉与发布加固

**连贯界面：** 源码工作流收尾和全系统验收。

- 范围：优化源码工具栏层级和展开尺寸；统一跨界面的焦点/状态/图标；修正剩余视觉审计场景设置；解决范围内所有 P0/P1 问题。
- 预期文件：`src/ui/editor-app.ts`、`src/ui/code-editor.ts`、`src/styles.css`、`scripts/ui-visual-audit.mjs`、一个聚焦的测试/浏览器文件。
- 预计差异：250–450 行。
- 必须保留：`#code-drawer` 默认折叠且不超过 44 px；`#toggle-code` 文本；`#apply-code`；`#code-editor`；定位/搜索/格式化；脏数据/错误语义；历史/源码同步；画布最小面积。
- 门禁：fast + checkpoint + canvas + release；完整截图矩阵；`git diff --check`；`git diff --stat`；零浏览器控制台/页面/请求错误。
- 回滚边界：源码抽屉样式/标记/审计设置一起回滚；源码解析器/模型变更不在范围内。

## 阶段完成报告模板

每个实现阶段都要报告：

1. 实际文件和改动行数。
2. 通过 `UI_ACCEPTANCE.md` 中 ID 标识的验收标准。
3. 命令和精确结果。
4. 紧凑、标准、宽屏三种视口的前后截图路径。
5. Impeccable 和 Web Design Guidelines 的 P0/P1/P2 分类发现。
6. 已完成的 P0/P1 修复，以及带负责人而有意延期的 P2 项。
7. 预期观察是否与实际结果一致。
8. 回滚边界和残余风险。

不要仅因为当前差异可以编译就开始下一阶段。只有当行为 oracle、结构指标、视觉判断和受保护钩子审计一致时，一个阶段才具有可评审性。
