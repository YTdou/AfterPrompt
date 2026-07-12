# HTML Slides Build 支持：设计、实施与进度共同文档

> 文档状态：设计基线（Design Baseline）  
> 创建日期：2026-07-11  
> 适用项目：Last Mile Studio  
> 示例基准：`reference/artifacts/HotCarbon_Oral_Slides_SelfContained.html`

## 1. 文档定位与持续维护声明

本文档是 Last Mile Studio 对 HTML Slides Build（逐步出现、增量展示）能力进行设计、实现、验证和进度跟踪的共同文档。

后续所有相关实现阶段都必须维护本文档，而不能把它当作一次性设计稿。每一阶段开始、发生设计变更、完成代码实现或取得验收结果时，都应同步更新以下内容：

- 阶段状态与完成度；
- 实际涉及的文件、模块和数据结构；
- 已确认、被推翻或修正的设计假设；
- 自动化测试和真实浏览器验收结果；
- 遗留问题、风险和下一阶段入口条件；
- 影响架构、DOM 语义或用户交互的决策记录；
- 文档末尾的变更日志。

本文档是 HTML Slides Build 功能范围内的设计基线、实施账本和进度对齐入口。项目级目标、阶段边界和整体路线仍以 `Project.md` 为上位依据；本文档不替代 `Project.md`，而是将其中与 Build 支持有关的目标展开成可实施、可验证、可持续跟踪的细化方案。

维护原则：

1. 代码状态、测试状态和文档状态必须一致，不允许先宣称阶段完成、后补证据。
2. 任何改变推荐架构、Build 数据语义、安全边界或验收标准的实现，都必须先更新“决策记录”。
3. 阶段完成必须记录实际验证命令与可观察结果，而不是只记录“代码已写”。
4. 如果实现与本文档设计不一致，应明确记录偏差、原因和新的验证依据，不能静默漂移。
5. 本文档中的进度表只反映已经验证的事实；计划中但未验证的能力必须保持为“未开始”或“进行中”。

## 2. 背景与用户问题

Last Mile Studio 已能识别并逐页编辑静态 HTML 演示稿，但对单页内部的 Build 状态支持不足。

以 `reference/artifacts/HotCarbon_Oral_Slides_SelfContained.html` 为例，原始演示稿在播放时支持：

- 在同一页内依次显示 Build 1、Build 2、Build 3；
- 前进时优先推进当前页 Build，所有 Build 完成后才进入下一页；
- 后退时优先撤销当前 Build，回到 Build 0 后才返回上一页；
- 进入上一页时可恢复该页的最终 Build 状态；
- 同一个 Build 值下的多个元素作为一个组同时出现。

导入编辑器后，目前只能逐页切换，不能控制当前页的 Previous Build / Next Build，也不能编辑某一页 Build 完成后的真实状态。原本被 Build 隐藏的元素虽然仍存在于源 DOM 中，但在画布中受到原 CSS 的隐藏规则影响，用户无法通过正常的编辑工作流访问它们。

用户提出的两个直接优化方向是：

1. 暂不支持修改 Build 顺序，但允许切换 Build 状态，并在每个状态下编辑；
2. 每页直接显示所有内容，同时显示 Build 顺序和 Build 组，并像 PowerPoint 动画窗格一样修改顺序。

本文档的结论是：这两个方向不应互斥。最优产品形态是基于同一份 Build 数据模型提供两种互补视图：

- **Build 状态视图**：准确查看和编辑 Initial / Build 1 / Build 2 / Build N；
- **Build 编排视图**：显示全部 Build 元素、顺序和分组，支持调整编排。

方向 1 应作为第一阶段闭环，方向 2 应作为第二阶段能力；最终产品同时保留两种视图。

## 3. 当前实现与证据

### 3.1 示例文件中仍然存在的 Build 结构

示例文件并不是只有不可恢复的 JavaScript 动画。其 DOM 保留了明确、可解析的 Build 元数据：

- 演示稿共有 23 个直接页面；
- 其中 14 页包含 Build；
- 共包含 94 个带 `data-build` 的元素；
- Build 值为 `1`、`2`、`3`；
- 同一页中相同 `data-build` 值的元素构成一个同时出现的 Build 组。

代表性结构如下：

```html
<div class="flow-card request build" data-build="1">...</div>
<div class="flow-arrow build" data-build="1">...</div>
<div class="flow-card candidates build" data-build="1">...</div>

<div class="flow-arrow build" data-build="2">...</div>
<div class="flow-card map-card build" data-build="2">...</div>

<div class="flow-arrow build" data-build="3">...</div>
<div class="decision-stack build" data-build="3">...</div>
```

其原始 CSS 采用 `.build` 隐藏元素、`.build.revealed` 显示元素：

```css
.build {
  opacity: 0;
  transform: translateY(18px) scale(.985);
  filter: blur(3px);
  pointer-events: none;
}

.build.revealed {
  opacity: 1;
  transform: none;
  filter: none;
  pointer-events: auto;
}
```

原始运行时的核心语义是：

```js
function maxBuild(slide) {
  return Math.max(
    0,
    ...Array.from(slide.querySelectorAll('[data-build]'))
      .map((element) => Number(element.dataset.build) || 0),
  );
}

function setStep(slide, step) {
  const next = clamp(step, 0, maxBuild(slide));
  slide.dataset.buildStep = String(next);
  slide.querySelectorAll('[data-build]').forEach((element) => {
    const show = (Number(element.dataset.build) || 0) <= next;
    element.classList.toggle('revealed', show);
    element.setAttribute('aria-hidden', show ? 'false' : 'true');
  });
}
```

因此，Build 的结构定义仍在，丢失的是运行时状态机及其派生的 `revealed` 状态。

### 3.2 当前导入路径为什么会丢失 Build 行为

当前安全模型会在 `SourceDocument` 构造阶段调用 `sanitizeDocument()`，移除：

- `script`；
- `iframe`；
- `object`、`embed`、`base`、`portal`；
- 事件处理属性；
- 危险 URL；
- SVG 动画节点。

移除导入脚本是正确且必须保留的安全边界。问题不在于 sanitizer 删除了脚本，而在于删除脚本后编辑器只接管了页面语义，没有接管 Build 语义。

当前 `SourceDocument` 已具备：

- `pages()`；
- `pageElement()`；
- `treeForPage()`；
- `editingRoot()`；
- `elementBelongsToPage()`；
- 页面复制、删除和排序。

但还没有：

- Build 检测；
- Build Sequence；
- 当前 Build Step；
- Build 组操作；
- Build 顺序操作；
- Build 感知的结构树、缩略图、历史和导出。

### 3.3 当前 Renderer 的边界

Canvas Renderer 会：

1. 克隆规范 DOM；
2. 只显示活动页面；
3. 注入静态页面 CSS；
4. 在 Shadow DOM 中完成安全交互；
5. 将画布修改写回规范 `SourceDocument`。

但 Renderer 没有当前 Build Step 参数，也不会为渲染克隆计算或切换 `revealed`。因此原始 CSS 仍会隐藏 `.build` 元素，形成“元素存在但无法在后续状态编辑”的问题。

### 3.4 当前预览与独立导出的边界

独立 Slides 的编辑器生成运行时目前只维护：

```text
slides[]
page index
previous page
next page
```

没有：

```text
build sequence per page
current build step
previous build
next build
build-first page navigation
```

所以即使只修复编辑画布，预览和导出仍会与编辑结果不一致。Build 支持必须贯穿文档模型、编辑器渲染、预览和导出，不能只做局部 UI 补丁。

## 4. 第一性原理分析

### 4.1 问题由什么组成

HTML Slides Build 能力可以拆成四类互相独立但必须闭环的状态：

1. **内容状态**：真实 DOM 元素及其文字、样式、位置和层级；
2. **Build 定义**：哪些元素属于哪个 Build 组，以及组的先后关系；
3. **编辑器观察状态**：用户当前正在查看 Page N / Build K，以何种视图查看；
4. **播放运行时状态**：预览或导出播放时当前位于 Page N / Build K。

当前系统已经拥有内容状态和页面状态，但缺少明确的 Build 定义模型，以及编辑器和播放器各自的 Build 状态。

### 4.2 不可破坏的约束

以下是本功能必须遵守的硬约束：

- 规范 HTML DOM 继续是内容和 Build 定义的唯一真相；
- 导入文档原始脚本不能在编辑环境或独立 Slides 内层页面中执行；
- 画布、源码编辑、历史记录、预览和导出必须对同一 Build 定义达成一致；
- Build 视图状态不能污染规范源码；
- 后续 Build 状态下的元素必须可以正常选择、移动、缩放和编辑；
- 页面管理和 Build 管理必须是两个清晰维度；
- 不应为了 Build 支持复制多份页面内容并制造第二套文档真相。

### 4.3 可改变的软约束

以下是实现选择，不是不可改变事实：

- Build 控件位于顶部工具栏还是右侧面板；
- 默认显示 Initial 还是 Final；
- 使用 `data-build` 还是内部专用属性；
- 第一版是否支持拖拽调整顺序；
- 是否立即兼容 Reveal.js、SlideV 等第三方格式；
- 是否立即支持持续时间、延时、路径动画等高级动画属性。

### 4.4 需要避免的隐藏假设

- “脚本被移除，所以 Build 无法恢复”是错误假设；声明式 Build 数据仍在。
- “支持 Build 就必须运行原稿 JavaScript”是错误假设；可由编辑器生成固定、安全的运行时。
- “把全部元素显示出来就等于支持 Build 编辑”是错误假设；用户仍需验证每个真实播放状态。
- “Build 顺序就是 DOM 顺序”并不总成立；示例明确使用 `data-build` 表达分组和顺序。
- “Build 是页面副本”是错误抽象；Build 是同一页内容的累计可见状态。

### 4.5 重构后的核心模型

只保留必要事实后，合理模型是：

```text
Canonical DOM
  ├─ Page nodes
  ├─ Base elements
  └─ Build elements with declarative step metadata
           ↓
      BuildSequence
       ↙        ↘
Editor View      Safe Playback Runtime
```

BuildSequence 从规范 DOM 派生；编辑操作修改规范 DOM 中的 Build 定义；当前观察状态和播放状态是临时状态，不成为第二份文档。

## 5. 候选方案比较

### 5.1 方案 A：只支持切换 Build 状态

能力：

- Previous Build / Next Build；
- 查看 Initial / Build 1 / Build N；
- 在任意状态编辑已经出现的元素；
- 不允许修改顺序或组。

优点：

- 实现范围小；
- 能快速修复当前最严重的可编辑性问题；
- 容易验证；
- 对规范 DOM 改动少。

不足：

- 用户不能纠正错误分组；
- 用户不能把新元素加入 Build；
- 不能满足类似 PowerPoint 的完整编排需求。

结论：适合作为第一阶段，不应成为最终形态。

### 5.2 方案 B：画布永久显示所有内容并允许修改 Build

能力：

- 所有元素始终可见；
- 用标签标出 B1、B2、B3；
- 支持修改 Build 归属和顺序。

优点：

- 信息密度高；
- 容易查看每一组包含哪些元素；
- 适合编排和批量调整。

不足：

- 绝对定位的 Slide 元素会互相覆盖；
- 无法确认某个真实播放状态是否构图正确；
- 隐藏元素可能遮挡已显示元素并影响选择；
- 将“编排模式”误当成“真实预览模式”。

结论：适合作为可切换的 Build 编排视图，不适合作为默认画布状态。

### 5.3 方案 C：执行原始演示稿脚本

优点：

- 视觉上最接近原稿；
- 理论上可复用其完整行为。

不足：

- 破坏安全模型；
- 原脚本可能访问网络、存储、父窗口或执行任意代码；
- 不同框架运行时完全不同；
- 运行时 DOM 变化可能无法同步回源码；
- 无法建立稳定、通用的命令和历史模型。

结论：不采用。

### 5.4 方案 D：将每个 Build 展开为页面副本

优点：

- 每个状态都可作为静态页查看；
- 播放器实现简单。

不足：

- 同一元素产生多份副本；
- 修改一个标题需要同步多个页面；
- 页面排序与 Build 排序混淆；
- 导出会产生重复内容；
- 违背规范 DOM 单一真相。

结论：不采用。

### 5.5 方案 E：原生 Build 模型 + 双视图

能力：

- 状态视图准确查看和编辑 Build；
- 编排视图查看全部 Build、组和顺序；
- 同一 BuildSequence 驱动画布、历史、预览和导出；
- 继续禁止运行原始脚本。

优点：

- 同时解决可编辑性和编排问题；
- 保持 source-first；
- 可扩展到结构化命令和第三方格式适配；
- 安全边界清晰；
- 预览和导出可复现编辑器语义。

不足：

- 需要跨模型、UI、Renderer、History、Presentation 和测试实现；
- 需要明确边界条件和兼容策略。

结论：作为推荐主线。

## 6. 推荐用户体验

### 6.1 页面和 Build 是两个独立维度

顶部工具栏建议分为两组：

```text
Page 3 / 23       [Previous Page] [Next Page]
Build Initial / 3 [Previous Build] [Next Build]
View              [Playback State] [Current Group] [All Builds]
```

规则：

- 页面切换只切页面；
- Build 切换只改变当前页的 Build 状态；
- 编辑模式中 Next Build 到达最后一步后不自动翻页；
- 编辑模式中 Previous Build 到达 Initial 后不自动退页；
- 正式预览和导出继续采用“Build 优先、页面其次”的演示语义；
- 每次进入新页面默认显示 Initial，或恢复该页最近的编辑观察状态；该策略在实现阶段通过可用性测试最终确认。

建议把初始状态明确命名为 `Initial` 或 `Build 0`，避免用户把“第一页的第一屏”与 `Build 1` 混淆。

### 6.2 Playback State 视图

这是默认编辑视图，目标是准确呈现播放到当前步骤时的真实页面。

当当前步骤为 `k` 时：

- 没有 Build 属性的基础元素始终显示；
- `step <= k` 的 Build 元素显示；
- `step > k` 的 Build 元素隐藏且不可拦截指针；
- 显示状态通过渲染克隆计算，不写回规范 DOM；
- 在 Build 2 编辑元素后，切换到 Build 3 时修改必须继续存在。

### 6.3 Current Group 视图

该视图用于聚焦某个 Build 组：

- 当前组以完整视觉样式显示；
- Base 和既有组可正常显示或降低强调度；
- 未来组以低透明度轮廓显示，或完全隐藏；
- 当前组元素显示统一的组标签；
- 可一键选择整个组。

是否显示基础元素应提供开关，以便用户既能观察组在完整页面中的位置，也能隔离检查复杂重叠。

### 6.4 All Builds 编排视图

该视图必须在原始坐标位置显示全部内容，不能把 Build 展开成多份页面。

建议视觉编码：

- Always Visible：不加 Build 色彩；
- 当前组：100% opacity，蓝色边框；
- 已完成组：正常或轻度降低强调；
- 未来组：25%–40% opacity，虚线边框；
- 元素角落显示 `B1`、`B2`、`B3`；
- 标签仅存在于编辑器 overlay，不写入源文件；
- 覆盖原始 `.build { opacity: 0 }`、transform、filter 和 pointer-events，仅作用于渲染克隆。

All Builds 视图主要服务于发现、选择和编排，不代表最终播放效果。

### 6.5 Build 编排面板

右侧面板建议采用类似 PowerPoint 动画窗格的层级：

```text
Always Visible
  ├─ Slide title
  └─ Background

Build 1 · 3 elements
  ├─ Request card
  ├─ Arrow
  └─ Candidate card

Build 2 · 2 elements
  ├─ Second arrow
  └─ Map card

Build 3 · 3 elements
  ├─ Final arrow
  ├─ Decision stack
  └─ Boundary strip
```

需要支持：

- 点击组切换到该 Build；
- 点击元素在画布和 Layers 面板中同步选择；
- 拖动整个组改变 Build 顺序；
- 将元素拖入另一个 Build 组；
- 将元素拖到两个组之间创建新组；
- 多选后批量设置 Build；
- 将元素设置为 Always Visible；
- 合并组；
- 从组中拆出元素创建新组；
- 对所有操作提供 Undo / Redo；
- 显示每组元素数量和可选名称。

第一版顺序语义限定为“点击推进的累计 Build”。PowerPoint 中的 On Click、With Previous、After Previous 可以先映射为：

- On Click：新 Build 组；
- With Previous：同一 Build 组；
- After Previous：第一版不单独建模，后续根据需求增加 trigger/timing 模型。

第一版不应支持声音、路径动画、持续时间曲线等完整动画引擎能力。

### 6.6 页面缩略图

页面缩略图建议默认渲染 Final Build：

- 更容易识别页面完整内容；
- 不会出现大量看似空白的缩略图；
- 在缩略图上显示 `+3 builds`；
- 活动页可选显示当前正在编辑的 Build 状态；
- 缩略图仍使用 pruned DOM branch，避免 N×N 页面克隆。

## 7. Build 数据模型与 DOM 语义

### 7.1 派生模型

建议新增以下派生结构：

```ts
interface BuildElement {
  elementId: string;
  step: number;
}

interface BuildGroup {
  step: number;
  elementIds: string[];
}

interface PageBuildSequence {
  pageId: string;
  steps: number[];
  groups: BuildGroup[];
  maxStep: number;
  elementCount: number;
}
```

`PageBuildSequence` 必须从规范 DOM 即时派生或缓存后可可靠失效，不能成为需要双向同步的第二份文档。

### 7.2 规范 DOM 语义

第一版推荐直接采用现有且人类可读的 `data-build`：

```html
<div data-build="1">...</div>
<div data-build="2">...</div>
```

语义：

- 无 `data-build`：Always Visible；
- 正整数 `data-build="N"`：属于 Build N；
- 相同 N：同一组、同时出现；
- 当前状态 k：显示所有无 Build 元素以及 `N <= k` 的元素。

`revealed` class、`aria-hidden` 和当前 Build Step 属于派生渲染状态：

- 不写入规范 DOM；
- 不进入导出源代码；
- 不作为用户内容变更进入 History；
- 只在编辑克隆和播放运行时中存在。

### 7.3 SourceDocument 建议能力

```ts
buildSequence(pageIndex: number): PageBuildSequence
buildStepForElement(elementId: string): number | null
setElementBuild(elementIds: string[], step: number | null): void
moveBuildGroup(pageIndex: number, fromStep: number, toStep: number): void
mergeBuildGroups(pageIndex: number, sourceStep: number, targetStep: number): void
splitBuildGroup(pageIndex: number, elementIds: string[], targetStep: number): void
normalizeBuildSteps(pageIndex: number): void
```

这些能力应遵循现有页面操作的架构：规范 DOM 仍由 `SourceDocument` 拥有，UI 不直接维护另一套 Build 数组。

### 7.4 Build 值和归一化

导入时：

- 只把正整数视为有效 Build；
- Build 值可以不连续，例如 10、20、30；
- 播放导航按排序后的不同值推进；
- 导入时不静默重写用户源码；
- 无效值产生明确 warning，并按 Always Visible 或 Unsupported 处理，具体策略需在实现前固定。

发生顺序编辑时：

- 整个操作原子地重新编号；
- 默认归一化为连续的 1…N；
- 同组元素保持同一个值；
- Undo 必须恢复完整的原始编号和归属。

### 7.5 嵌套 Build

需要显式处理父子元素都带 Build 的情况。

推荐规则：元素的有效可见步骤至少受到所有 Build 祖先约束。若子元素的步骤早于父元素，例如父为 Build 3、子为 Build 1，则子元素在 Build 1 仍无法实际显示。

第一版建议：

- 检测此类冲突；
- 在 Build 面板显示 warning；
- 不静默假装子元素可以提前显示；
- 可提供“提升到可见祖先之外”或“同步到父 Build”的修复操作；
- 不自动改变 DOM 层级。

## 8. 编辑器状态、History 与结构化命令

### 8.1 编辑器观察状态

建议编辑器维护：

```ts
interface BuildViewState {
  activePageId?: string;
  activeBuildStep: number;
  viewMode: 'playback' | 'group' | 'all';
}
```

需要决定是否按页记忆最近 Build Step。推荐按页记忆，以便用户在多页之间往返时保持编辑上下文。

### 8.2 History 边界

应区分两类状态：

- **文档变更**：元素加入 Build、移动组、合并组、修改内容，进入 Undo / Redo；
- **观察状态**：仅切换当前 Build 或视图模式，不应制造新的文档历史记录。

但 History Snapshot 应保存足够的上下文，使撤销文档操作后仍回到合理的页面和 Build 位置：

- `activePageId`；
- `activeBuildStep` 或页面级 Build 观察状态；
- 当前选区；
- 必要时保存 viewMode。

### 8.3 结构化命令

后续 AI / Codex Control Layer 可增加：

```json
{
  "action": "setElementBuild",
  "elementIds": ["request-card", "request-arrow"],
  "step": 1
}
```

```json
{
  "action": "moveBuildGroup",
  "pageId": "slide-s2",
  "fromStep": 3,
  "toStep": 2
}
```

```json
{
  "action": "removeElementBuild",
  "elementIds": ["persistent-title"]
}
```

命令必须复用同一个 Document Model 操作路径，不能让 UI、CLI 和 AI 各自直接改属性。

## 9. Renderer 设计

### 9.1 Renderer 输入

Renderer 至少需要接收：

```ts
interface RenderBuildOptions {
  activeBuildStep?: number;
  buildViewMode?: 'playback' | 'group' | 'all';
  focusedBuildStep?: number;
}
```

### 9.2 Playback 渲染

在克隆出的活动页中：

1. 找出所有带 Build 元数据的节点；
2. 计算当前状态是否应显示；
3. 对可见节点应用运行时 `revealed` 或编辑器私有状态属性；
4. 对不可见节点确保 opacity、visibility 和 pointer-events 正确；
5. 不修改规范 DOM；
6. 保留原 CSS 定义，使真实显示效果尽可能接近来源。

### 9.3 All Builds 渲染

All Builds 模式要注入优先级足够高的编辑器 CSS，覆盖来源中的隐藏效果：

```css
[data-editor-build-preview="all"] [data-build] {
  opacity: var(--editor-build-opacity, 1) !important;
  transform: none !important;
  filter: none !important;
  visibility: visible !important;
  pointer-events: auto !important;
}
```

实际实现应避免破坏本来就有业务意义的 transform。更稳妥的方案是：

- 仅在已识别 Build adapter 明确声明的隐藏属性上覆盖；或
- 在渲染克隆上添加来源预期的状态 class（例如 `revealed`），再使用 overlay 表达组状态；
- 对无法识别其显示机制的 Build 产生兼容性 warning。

### 9.4 选择与变换

无论当前元素通过哪个 Build 状态显示，都必须继续使用稳定 `data-editor-id` 映射回规范 DOM。Build overlay 不能成为选择目标，也不能干扰 Moveable/transform controller。

## 10. 安全预览和独立导出

> 当前实现更新：HTML 已收敛为一种可逆导出。单文件同时包含版本化的规范文档 payload 和固定播放 Runtime，可直接播放，也可重新导入恢复页面与 Build 继续编辑；“独立 Slides”不再是与源文件分离的第二种制品。

### 10.1 安全边界保持不变

- 导入脚本继续移除；
- 实际 Slide 页面继续位于不允许脚本的内层 iframe；
- 只运行编辑器生成的固定外层播放运行时；
- Build 定义只从已净化 DOM 的声明式属性读取；
- 不反序列化或执行用户提供的 JavaScript；
- 不允许导入页面控制父窗口。

### 10.2 播放状态机

每页拥有独立状态：

```text
Page 1: Initial → B1 → B2 → Final
Page 2: Initial → B1 → B2 → B3 → Final
```

Forward：

1. 如果当前页还有后续 Build，进入下一 Build；
2. 否则进入下一页 Initial；
3. 最后一页 Final 时保持不动或显示结束反馈。

Backward：

1. 如果当前页高于 Initial，回退一个 Build；
2. 否则进入上一页 Final；
3. 第一页 Initial 时保持不动。

Home：第一页 Initial。  
End：最后一页 Final。  
直接跳页：默认进入目标页 Initial；如未来支持“从后向前跳转进入 Final”，必须成为明确策略而不是隐式行为。

### 10.3 键盘与编辑冲突

编辑器中方向键用于移动选区，Page Up / Page Down 已用于页面切换，因此 Build 编辑快捷键不能直接抢占这些按键。

建议：

- 编辑模式主要使用显式按钮；
- 可增加 `Alt + [` / `Alt + ]` 等不冲突快捷键；
- 正式预览仍使用 Arrow、Page Up / Page Down、Space；
- 输入框、文本编辑器和 contenteditable 获得焦点时不响应播放快捷键。

## 11. 第三方格式兼容策略

### 11.1 第一版明确支持

- `.build[data-build]`；
- 任意带正整数 `data-build` 的元素；
- 示例文件中的 `.revealed` 累计显示语义。

### 11.2 后续适配器

可以引入 Build Adapter：

```ts
interface BuildAdapter {
  name: string;
  detect(page: Element): boolean;
  read(page: Element): PageBuildSequence;
  applyPreviewState(pageClone: Element, step: number): void;
  writeElementStep?(element: Element, step: number | null): void;
}
```

候选适配对象：

- Reveal.js `.fragment`；
- `data-fragment-index`；
- 其他明确、声明式的 step 属性；
- 可静态转换的 SlideV click 标记。

兼容原则：

- 只支持能静态理解的声明式行为；
- 不执行第三方运行时；
- 无法确定的行为必须明确报告；
- 首次修改第三方格式时，可以选择保持原格式或转换为统一 `data-build`，但必须让用户知道转换结果；
- 不得声称支持任意 JavaScript 动画。

## 12. 分阶段实施计划

### 12.1 Phase A：Build 识别与状态编辑闭环

目标：解决“只能编辑初始状态”的核心问题，并让预览、导出与编辑语义一致。

范围：

- Build 检测和 `PageBuildSequence`；
- Build Initial / N 控件；
- Playback State 画布渲染；
- 后续 Build 状态下的选择、文本编辑、移动和缩放；
- 按页维护活动 Build 状态；
- Final Build 缩略图与 build 数量标记；
- Build 感知的演示预览；
- Build 感知的独立 Slides 导出；
- History 上下文恢复；
- 单元测试和真实浏览器验收；
- 更新本文档 Phase A 状态和实测证据。

非目标：

- 不修改 Build 顺序；
- 不创建、合并或拆分 Build；
- 不适配多个第三方框架；
- 不增加复杂动画参数。

完成门槛：

- 示例稿每个 Build 状态可切换并编辑；
- 编辑后切换状态、页面、撤销和重做不丢失修改；
- 预览和导出按 Build-first 语义播放；
- 原始脚本仍未执行；
- 自动化和浏览器测试通过。

### 12.2 Phase B：Build 编排和顺序修改

目标：提供类似 PowerPoint 动画窗格的组与顺序控制。

范围：

- All Builds 和 Current Group 视图；
- Build 编排面板；
- 设置/移除元素 Build；
- 组拖拽排序；
- 元素跨组移动；
- 新建、合并、拆分组；
- Build 操作的结构化命令；
- Build warning 和嵌套冲突提示；
- Undo / Redo；
- 代码编辑同步；
- 更新本文档 Phase B 状态和实测证据。

完成门槛：

- 可直观看到每个组的元素；
- 调整顺序后源码、画布、预览和导出一致；
- 同组语义和跨组移动稳定；
- Undo / Redo 恢复完整 Build 编排；
- 不产生临时 `revealed` 源码污染。

### 12.3 Phase C：兼容层与高级语义

目标：扩大声明式 HTML Slides 生态兼容范围。

范围候选：

- Reveal.js fragment adapter；
- `data-fragment-index`；
- 兼容性报告；
- 格式转换预览；
- 可选 Build 名称；
- On Click / With Previous / After Previous 的更明确模型；
- timing、transition 等高级字段的可行性评估。

进入条件：

- Phase A 和 B 已稳定；
- 已有真实第三方样本和用户需求；
- 不为未验证需求预建完整动画引擎。

### 12.4 Phase D：可选的自动化与 AI 编排

候选能力：

- AI 根据语义建议 Build 分组；
- 自动检测一次出现过多内容；
- 结构化命令批量重排；
- Build 复杂度和可访问性检查；
- 演讲节奏辅助。

该阶段不是当前目标，必须依据真实需求另行确认。

## 13. 验收矩阵

### 13.1 示例文件结构验收

| 项目 | 预期 |
| --- | --- |
| 页面数量 | 23 |
| 包含 Build 的页面 | 14 |
| Build 元素总数 | 94 |
| 常见 Build 值 | 1、2、3 |
| 第一页最大 Build | 2 |
| 主要内容页最大 Build | 多数为 3 |

这些数字用于检测解析回归，不代表所有 HTML Slides 都必须采用相同结构。

### 13.2 Phase A 用户行为验收

1. 导入示例文件后，第一页显示 `Initial / 2`。
2. 点击 Next Build 能依次看到 Build 1 和 Build 2。
3. Build 2 中出现的元素可以选择和编辑。
4. 修改元素文字后退回 Initial，再返回 Build 2，修改仍存在。
5. 切换页面再返回，Build 编辑上下文符合确定的恢复策略。
6. Previous Build 在 Initial 时禁用，不错误退页。
7. Next Build 在 Final 时禁用，不错误翻页。
8. 页面缩略图能识别完整内容，并显示 build 数量。
9. 演示预览中 Forward 先推进 Build，再翻页。
10. Backward 从新页 Initial 返回上一页 Final。
11. 导出的单文件 Slides 与预览行为一致。
12. 导入脚本没有执行。

### 13.3 Phase B 用户行为验收

1. Build 面板按组列出所有元素。
2. 相同 `data-build` 的元素显示为同一组。
3. 将一个元素从 Build 3 移到 Build 2，源码属性同步变化。
4. 调整组顺序后 Build 状态视图同步更新。
5. 拖到组间能创建新 Build。
6. 将元素设为 Always Visible 后移除 Build 属性。
7. 合并组后所有元素获得相同 Build 值。
8. Undo / Redo 恢复组顺序和成员。
9. All Builds 视图能选择重叠元素，不污染导出源码。
10. 预览和导出使用修改后的新顺序。

### 13.4 源码与历史验收

- 源码保持标准、可读 HTML；
- Build 定义可由 `data-build` 直接理解；
- 不写入临时 `revealed`；
- 不写入编辑器 overlay；
- 代码编辑器修改 `data-build` 后，画布和面板重新解析；
- 非法 Build 值产生 warning；
- 页面复制保留 Build 语义，并为复制节点分配新稳定 ID；
- 页面删除和排序不损坏其他页面 Build；
- Project/History 恢复保持合理活动页面和 Build 上下文。

### 13.5 安全验收

- 导入脚本、事件处理器和危险 URL 继续被移除；
- Build 支持不会增加 `allow-scripts` 给内层页面；
- 独立 Slides 只执行编辑器生成的固定运行时；
- 外部文档无法访问父编辑器状态；
- 无法静态理解的行为以 warning 暴露，而不是尝试执行。

## 14. 测试策略

### 14.1 单元测试

建议覆盖：

- 解析连续和非连续 Build；
- 忽略或报告非法值；
- 相同值分组；
- Build Sequence 按页隔离；
- 设置、移除、移动、合并和拆分；
- 原子重编号；
- 嵌套冲突；
- 页面复制、删除和排序；
- Snapshot 恢复；
- prepare/export 不改变规范 DOM。

### 14.2 Renderer 测试

验证每个 view mode 下：

- Base、已显示、未来组的可见性；
- pointer-events；
- 选择映射；
- overlay 不进入源 DOM；
- 原始 `.build` CSS 下仍能正确显示；
- 缩略图 Final Build 正确。

### 14.3 Presentation 测试

验证：

- Forward / Backward 状态机；
- Home / End；
- 无 Build 页面直接翻页；
- 有 Build 页面逐步推进；
- 上一页 Final 恢复；
- inner iframe 不允许脚本；
- 输出不包含导入脚本；
- 资源内嵌仍正确。

### 14.4 真实浏览器测试

使用真实示例文件覆盖：

- 导入；
- 23 页识别；
- Build 切换；
- 后续状态双击文字编辑；
- 后续状态拖动和缩放；
- Build 面板拖拽；
- Undo / Redo；
- 页面切换；
- 预览；
- 导出并重新打开；
- 键盘导航；
- 安全断言。

阶段完成时应至少运行仓库既有的 `npm run check` 和 `npm run test:browser`，并把实际结果记录到本文档。

## 15. 风险与边界情况

### 15.1 来源 CSS 不使用 `.revealed`

并非所有文档都通过 `.revealed` 控制显示。适配器必须明确其显示机制；不能假定只要存在 `data-build` 就一定能复现来源动画外观。

降级策略：

- 保证离散可见状态正确；
- 过渡动画无法复现时显示兼容 warning；
- 不执行原始脚本补救。

### 15.2 Build 元素重叠

All Builds 模式可能产生大量重叠。需要结合：

- Layers / Build 面板选择；
- Tab 或循环选择；
- 当前组隔离；
- 降低未来组 opacity；
- 临时隐藏其他组。

### 15.3 Build 与 CSS transition

编辑时频繁切换可能触发过渡，影响定位和选择。建议编辑模式提供 `no-build-motion` 或 reduced-motion 覆盖，正式预览再启用来源 transition。

### 15.4 Build 状态与元素可访问性

隐藏元素必须同步：

- `aria-hidden`；
- pointer-events；
- 必要时 tab focus；
- 不能只设置 opacity。

### 15.5 页面级特殊导航规则

示例包含 Q&A lock、Backup 页面快捷键等自定义运行时逻辑。这些不是通用 Build 语义，第一版不应自动复现。

通用播放器只承诺：

- 页面顺序；
- Build 顺序；
- 前进、后退、Home、End；
- 全屏。

自定义跳转和锁定需要未来另建声明式导航模型。

### 15.6 术语边界

本文档文件名按用户指定为 `HTML_slices_support.md`，但产品和技术术语统一使用：

- HTML Slides：HTML 演示文稿；
- Slide/Page：演示页面；
- Build：同一页内的累计显示步骤；
- Build Group：同一步同时出现的元素组；
- Initial/Build 0：页面初始状态；
- Final Build：当前页全部 Build 完成后的状态。

## 16. 非目标

当前路线不承诺：

- 执行任意导入脚本；
- 完整兼容任意 Reveal.js、SlideV 或自定义框架；
- PowerPoint 全量动画系统；
- 路径动画、声音、视频时间线；
- 动画曲线和精确毫秒级时间编辑；
- 将每个 Build 复制成独立页面；
- 用截图或栅格图替代规范 DOM；
- 在第一阶段同时完成所有第三方适配器。

## 17. 阶段状态与进度追踪

此表必须在每个实现阶段持续更新。

| 阶段 | 状态 | 当前结论 | 代码范围 | 验证证据 | 下一入口 |
| --- | --- | --- | --- | --- | --- |
| Design Baseline | 已完成 | 采用原生 Build 模型和双视图主线 | 本文档 | 已核对示例和当前代码路径 | Phase A/B 已完成 |
| Phase A：识别与状态编辑 | 已完成 | `data-build` 派生模型贯通画布、缩略图、History、预览和独立导出 | `src/core/builds.ts`、`document-model.ts`、`renderer.ts`、`presentation.ts`、`editor-app.ts` | `npm run check`：34 tests；真实浏览器：23 页、14 Build 页、94 Build 元素及 Build-first 导出重开通过 | Phase B 已完成 |
| Phase B：Build 编排 | 已完成 | 双视图与编排面板复用规范 DOM 命令路径，支持归属、跨组、排序、新建、拆分、合并和 Undo/Redo | `src/core/types.ts`、`builds.ts`、`document-model.ts`、`editor-app.ts`、`styles.css`、`docs/COMMAND_API.md` | 单元测试覆盖非连续值/非法值/嵌套冲突/组操作；真实浏览器覆盖 All/Group、拖拽、源码同步和历史恢复 | Phase C 需真实第三方样本驱动 |
| Phase C：兼容层 | 未开始 | 需真实样本驱动 | 待记录 | 待记录 | 用户需求和样本确认 |
| Phase D：AI/自动化 | 未排期 | 非当前目标 | 无 | 无 | 另行确认 |

状态只允许使用：

- 未开始；
- 进行中；
- 阻塞；
- 已实现待验证；
- 已完成；
- 已放弃。

“已完成”必须同时具备代码、自动化测试、真实浏览器验收和本文档更新。

## 18. 阶段实施记录模板

每个阶段完成或发生重大进展时，在本节追加记录：

```markdown
### YYYY-MM-DD · Phase X · 标题

- 状态：
- 本轮目标：
- 实际修改文件：
- 数据模型或交互变化：
- 已运行验证：
- 预期结果：
- 实际结果：
- 是否一致：
- 已确认假设：
- 被推翻或修正的假设：
- 遗留风险：
- 下一步：
- Human Audit 点：
```

### 2026-07-11 · Phase A · Build 状态编辑端到端闭环

- 状态：已完成；
- 本轮目标：让声明式 `data-build` 在编辑画布、页面缩略图、历史、演示预览和独立 Slides 中保持一致；
- 实际修改文件：`src/core/builds.ts`、`src/core/types.ts`、`src/core/document-model.ts`、`src/canvas/renderer.ts`、`src/core/presentation.ts`、`src/ui/editor-app.ts`、`src/styles.css`、`examples/multi-page-deck.html`、`tests/document-model.test.ts`、`tests/presentation.test.ts`、`scripts/browser-smoke.mjs`；
- 数据模型或交互变化：新增从规范 DOM 派生的 `PageBuildSequence`；顶部 Build 控件按页记忆当前状态；Playback State 只在渲染克隆上添加显示状态；缩略图固定显示 Final 并标注 Build 数；播放器采用 Build-first 前进/后退状态机；
- 已运行验证：`npm run check`；`STUDIO_BASE_URL=http://127.0.0.1:4174 npm run test:browser`；
- 预期结果：示例稿每个状态可编辑，状态切换和历史恢复不丢内容，预览与导出一致，导入脚本不执行；
- 实际结果：4 个测试文件、34 个测试通过（包含无 deck 容器的单页 Build）；真实 HotCarbon 文件识别 23 页、14 个 Build 页面和 94 个 Build 元素，Build 2 文字编辑、状态往返、预览、导出并重新打开均通过；
- 是否一致：一致；
- 已确认假设：`data-build` 足以恢复示例稿的离散累计显示语义，不需要执行原始脚本；
- 被推翻或修正的假设：Build 观察上下文只保存 step 不够，History 当前快照还需同步页面、视图模式和选区，才能在 Undo/Redo 后回到合理编辑位置；
- 遗留风险：第三方文档若不用 `.revealed` 或使用自定义过渡，仅保证离散可见性，需 Phase C adapter；
- 下一步：Phase B 已在同一轮按阶段边界继续完成；
- Human Audit 点：可人工体验 HotCarbon 第一页 Initial → Build 1 → Build 2，以及上一页 Final 回退语义。

### 2026-07-11 · Phase B · Build 编排和顺序修改

- 状态：已完成；
- 本轮目标：提供类似动画窗格的 Build 分组、成员和顺序控制，并保持源码、画布、历史、预览和导出一致；
- 实际修改文件：`src/core/builds.ts`、`src/core/types.ts`、`src/core/document-model.ts`、`src/ui/editor-app.ts`、`src/styles.css`、`docs/COMMAND_API.md`、`README.md`、`tests/document-model.test.ts`、`scripts/browser-smoke.mjs`；
- 数据模型或交互变化：新增 Playback/Current Group/All Builds 三视图；编排面板支持设置/移除 Build、元素跨组拖动、组标题拖动排序、末尾新建、组间 drop zone、新建/拆分/合并；新增四类结构化命令并统一归一化顺序；
- 已运行验证：同 Phase A 的最终 `npm run check` 和完整真实浏览器测试；
- 预期结果：修改分组后 `data-build`、画布、预览、导出同步，Undo/Redo 完整恢复，不写入 `revealed` 或 overlay；
- 实际结果：单元测试验证非连续值、非法值、嵌套冲突、移动/拆分/合并/移除；浏览器验证元素跨组、组 DragEvent/DataTransfer 排序、All Builds、Build 2 编辑、Undo/Redo、源码无临时属性；
- 是否一致：一致；
- 已确认假设：零基 `targetPosition` 足以表达“拖到组间创建新组”，操作后连续编号能保持播放器和源码简单可读；
- 被推翻或修正的假设：让整个组卡片可拖会与内部可拖元素竞争命中，因此最终只把组标题作为明确拖拽手柄；
- 遗留风险：严重重叠页面仍主要依赖 Build 面板选择；高级 timing/trigger 不在 Phase B 范围；
- 下一步：仅在有真实 Reveal.js/fragment 样本和明确需求后进入 Phase C；
- Human Audit 点：确认右侧编排面板的信息密度、标签文案和 All Builds 的透明度是否符合日常编辑习惯。

## 19. 决策记录

### D-001：不执行导入演示稿脚本

- 状态：已接受；
- 决策：继续移除导入脚本，由编辑器接管静态页面和声明式 Build；
- 原因：保持安全边界和可预测的双向同步；
- 影响：无法自动复现任意自定义运行时行为；
- 验证：预览和导出只运行编辑器生成的固定运行时。

### D-002：规范 DOM 是 Build 定义的唯一真相

- 状态：已接受；
- 决策：`PageBuildSequence` 从 DOM 派生，不建立脱离源码的私有 Slide/Build 文档；
- 原因：符合项目 source-first 架构，避免双重状态；
- 影响：所有 Build 操作必须最终表达为可读 DOM 元数据。

### D-003：采用 Build 状态视图和 Build 编排视图

- 状态：已接受；
- 决策：状态视图负责真实编辑，编排视图负责全局顺序和分组；
- 原因：单一视图无法同时兼顾真实播放状态和全部隐藏元素的可见性；
- 影响：Renderer 和 UI 需要明确 viewMode。

### D-004：分阶段交付，不把顺序编辑塞入第一闭环

- 状态：已接受；
- 决策：Phase A 完成识别、状态编辑、预览和导出；Phase B 再完成组与顺序编辑；
- 原因：先建立端到端语义闭环，再增加编排操作，降低状态不一致风险；
- 影响：Phase A 是可用但不完整的 Build 支持，不应被描述为最终功能全部完成。

### D-005：第一版 Build 语义为累计点击组

- 状态：已接受；
- 决策：同一个 step 同时出现，step 按顺序累计显示；
- 原因：覆盖示例文件和大多数简单演示场景；
- 影响：高级 timing/trigger 需要未来单独建模。

### D-006：页面切换恢复该页最近观察的 Build

- 状态：已接受；
- 决策：当前会话内按稳定页面 ID 记忆 Build Step，页面往返恢复最近状态；新页从 Initial 开始；
- 原因：多页编排时保留编辑上下文，同时不把观察状态写入规范源码；
- 影响：观察状态进入 History 上下文，但不进入独立导出内容或项目规范 DOM。

### D-007：非法 Build 降级为 Always Visible 并告警

- 状态：已接受；
- 决策：仅正整数是有效 Build；非法值保留在源码中、按 Always Visible 处理，并在编排面板显示 warning；
- 原因：避免静默重写用户源码，也不因单个异常值阻断整页编辑；
- 影响：用户执行编排操作前可先根据 warning 决定如何修复。

### D-008：顺序编辑后连续归一化，拆分位置采用零基索引

- 状态：已接受；
- 决策：组排序、拆分、合并和成员归属编辑完成后将有效 Build 原子归一化为 `1…N`；结构化 `splitBuildGroup` 使用零基 `targetPosition`；
- 原因：位置索引能明确表达首部、组间和末尾插入，连续编号便于人读和播放器执行；
- 影响：首次编辑非连续 `10/20/30` 后会明确改写为连续编号，Undo 可恢复原编号。

### D-009：缩略图固定显示 Final，组选择由面板兜底

- 状态：已接受；
- 决策：所有页面缩略图显示 Final Build；活动页不改为当前状态；重叠元素优先通过 Build 面板选择；
- 原因：胶片栏稳定、易识别且不会因状态切换频繁重渲染成空白页；
- 影响：当前 Build 状态只在顶部控件和主画布表达。

### D-010：第一版不转换第三方 Build 属性、不提供组名

- 状态：已接受；
- 决策：Phase A/B 只原生读写 `data-build`，不自动转换 Reveal.js 等格式，也不增加持久化 Build 名称；
- 原因：当前真实样本只证明 `data-build` 需求，避免预建未经验证的兼容与命名模型；
- 影响：第三方格式和可编辑组名留给真实需求驱动的 Phase C。

## 20. 开放问题

Phase A/B 的原开放问题已经转化为 D-006 至 D-010：页面按会话恢复最近 Step；观察状态进入 History 上下文但不污染规范 DOM；非法值降级并告警；重叠选择由面板兜底；不转换第三方属性；第一版不提供组名；缩略图固定 Final；编排操作连续归一化。

Phase C 前仍需由真实样本回答：

1. Reveal.js / SlideV 等第三方声明式属性应原格式写回，还是显式转换为 `data-build`？
2. 兼容层是否需要可持久化 Build 名称、trigger 和 timing？
3. 严重重叠样本是否需要独立的循环选择快捷键，而不仅是面板选择和 Current Group 隔离？

## 21. 下一实施入口

Phase A 和 Phase B 已完成。下一入口是 Phase C，但只有在提供真实第三方样本和明确兼容需求后才进入。

进入 Phase C 前应先核对：

- 目标格式是否具有可静态理解、无需执行脚本的声明式 step 数据；
- adapter 是只读预览还是需要安全写回；
- 格式转换是否会改变用户源码语义；
- 新增 trigger/timing 是否确有验收样本，而不是扩展成完整动画引擎；
- 兼容性报告如何暴露无法复现的过渡、自定义导航和运行时行为。

## 22. 变更日志

### 2026-07-11

- 一次性完成 Phase A 和 Phase B，并以阶段边界分别验证；
- 新增 Build 派生模型、三种画布视图、按页观察状态、Final Build 缩略图和 Build-first 安全播放器；
- 新增 Build 编排面板、结构化命令、元素跨组、组排序、新建、拆分、合并和完整 Undo/Redo；
- 扩充后的 34 项单元测试总集及真实 HotCarbon 23 页/14 Build 页/94 Build 元素端到端验收全部通过；
- 确认规范源码和独立导出不含编辑器临时 `revealed`/overlay，导入脚本继续被移除；
- 创建本文档；
- 写入当前问题、示例证据、根因和第一性原理分析；
- 比较五种候选方向；
- 确立“原生 Build 模型 + 状态视图 + 编排视图”为推荐主线；
- 定义 Phase A–D、验收矩阵、风险和非目标；
- 声明本文档为后续实现阶段必须持续维护的共同文档；
- 初始阶段状态设为 Design Baseline 已完成，其余实现阶段未开始。
