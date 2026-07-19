# JSON command API

命令可以在浏览器内部共享，也可以保存为 JSON 后由 CLI 批量执行。所有目标元素通过 `data-editor-id` 定位。

## CLI

```bash
npm run cli -- list <input>
npm run cli -- get <input> <element-id>
npm run cli -- summary <input> [--output structure.json]
npm run cli -- validate <input>
npm run cli -- prepare <input> --output <prepared-output>
npm run cli -- apply <input> --commands <commands.json> (--output <output> | --in-place)
npm run cli -- fragments <input>
npm run cli -- fragment-inspect <fragment.vfrag>
npm run cli -- fragment-validate <fragment.vfrag>
npm run cli -- fragment-create <input> --elements <id,id> --name <name> --output <fragment.vfrag>
npm run cli -- fragment-pack <input.svg|input.png|input.jpg> --output <fragment.vfrag>
npm run cli -- fragment-insert <input> --fragment <fragment.vfrag> --parent <element-id> --output <output>
```

`input` 可以是 HTML、SVG 或 `.visual-project.json`。CLI 默认拒绝隐式覆盖源文件。

`fragment-create` 支持 `--type`、`--mode`、`--fragment-id`、`--version`、`--category`、`--tags` 和 `--schema`；Schema 文件为 `{ "properties": [...], "slots": [...] }`。更新已有定义时同时传原 `--fragment-id` 和新语义版本。`fragment-insert` 支持 `--placement center|original|x,y`、`--linked` 和显式 `--in-place`。导入前会输出与 UI 相同的兼容性报告。

`fragment-pack` 把原始 SVG、PNG、JPG/JPEG 封装为经过验证的 `.vfrag`。SVG 保留结构；PNG/JPEG 生成格式 1.1 Raster element。可选参数为 `--name`、`--description`、`--category` 和 `--tags`。

## 通用更新

```json
{
  "action": "updateElement",
  "elementId": "title-001",
  "changes": {
    "x": 40,
    "y": 20,
    "width": 640,
    "height": 120,
    "rotation": 3,
    "fontSize": 48,
    "color": "#172033",
    "backgroundColor": "#f4f7ff",
    "opacity": 0.95,
    "name": "Main title",
    "locked": false,
    "visible": true
  }
}
```

支持的 `changes`：

- 几何：`x`、`y`、`width`、`height`、`rotation`、`scaleX`、`scaleY`；
- 文本：`text`、`fontFamily`、`fontSize`、`fontWeight`、`lineHeight`、`letterSpacing`、`textAlign`、`color`；
- 外观：`backgroundColor`、`fill`、`stroke`、`strokeWidth`、`opacity`、`borderRadius`、`boxShadow`、`filter`；
- 结构与资源：`className`、`style`、`src`、`objectFit`、`name`、`visible`、`locked`。

`x` / `y` 是编辑器组合变换的绝对平移值。若要在现有位置基础上移动，优先用 `moveElementBy`。

## 文本

```json
{
  "action": "replaceText",
  "elementId": "title-001",
  "text": "New Slide Title"
}
```

该命令设置 `textContent`。对包含富文本子标签的容器，它会替换内部结构；应定位到叶子文本节点对应的元素。

## 移动、缩放和旋转

```json
{ "action": "moveElement", "elementId": "image-003", "x": 100, "y": 40 }
```

```json
{ "action": "moveElementBy", "elementId": "image-003", "dx": 100, "dy": 0 }
```

```json
{ "action": "resizeElement", "elementId": "image-003", "width": 640, "height": 360 }
```

```json
{ "action": "rotateElement", "elementId": "image-003", "angle": 12 }
```

SVG `rect`、`image`、`circle` 和 `ellipse` 使用原生几何属性；其他 SVG 节点的通用尺寸可能保存为编辑器尺寸元数据，并由可视交互使用缩放变换。

## 样式

```json
{
  "action": "updateStyle",
  "elementId": "accent-block-001",
  "style": {
    "backgroundColor": "#244a86",
    "border-radius": "30px",
    "box-shadow": "0 18px 50px rgba(20, 40, 90, .25)"
  }
}
```

键可以使用 camelCase 或 CSS kebab-case。值为 `null` 或空字符串时删除该 inline property。

## 添加与删除

```json
{
  "action": "addElement",
  "parentId": "slide-001",
  "element": {
    "id": "annotation-001",
    "type": "text",
    "text": "New annotation",
    "x": 120,
    "y": 650,
    "width": 300,
    "height": 60,
    "fontSize": 28,
    "color": "#172033"
  }
}
```

`type` 支持 `text`、`image`、`rect`、`circle`、`group`、`container`。可选 `tag` 可以指定实际 HTML / SVG 标签。

```json
{ "action": "deleteElement", "elementId": "icon-004" }
```

文档根节点不能删除。

## 显隐、锁定与图层顺序

```json
{ "action": "setVisibility", "elementId": "note-001", "visible": false }
```

```json
{ "action": "setLocked", "elementId": "background-001", "locked": true }
```

```json
{ "action": "reorderElement", "elementId": "icon-001", "direction": "front" }
```

`direction` 支持 `up`、`down`、`front`、`back`，只改变同一父节点内的兄弟顺序。

锁定元素拒绝除 `setLocked` 之外的命令，以避免 Codex 和用户界面绕过同一保护语义。

## HTML Slides Build

Build 命令修改规范 DOM 中的人类可读 `data-build`，与编辑器 Build 编排面板共用同一个 `SourceDocument.apply()` 路径。无 `data-build` 表示 Always Visible，正整数表示累计显示组，相同整数同时出现。

设置元素所属 Build，或移除 Build：

```json
{ "action": "setElementBuild", "elementIds": ["request-card", "request-arrow"], "step": 1 }
```

```json
{ "action": "setElementBuild", "elementIds": ["persistent-title"], "step": null }
```

移动整个组到另一个组的位置；操作后当前页所有有效 Build 会原子归一化为连续的 `1…N`：

```json
{ "action": "moveBuildGroup", "pageId": "slide-s2", "fromStep": 3, "toStep": 1 }
```

合并两个组：

```json
{ "action": "mergeBuildGroups", "pageId": "slide-s2", "sourceStep": 3, "targetStep": 2 }
```

将元素拆成一个新组。`targetPosition` 是零基组插入位置，`0` 表示最前，当前组数表示末尾：

```json
{
  "action": "splitBuildGroup",
  "pageId": "slide-s2",
  "elementIds": ["decision-card"],
  "targetPosition": 2
}
```

这些命令只改变 Build 定义，不写入 `revealed`、`aria-hidden` 或编辑器 overlay。页面 ID 和元素 ID 都必须是稳定 `data-editor-id`；锁定元素仍拒绝 Build 归属修改。

## 组件属性

组件属性以定义暴露的属性名为契约，不要求 Codex 直接理解内部 DOM：

```json
{
  "action": "updateComponentProperties",
  "elementId": "contribution-card-instance",
  "properties": {
    "title": "Adaptive Sampling",
    "accentColor": "#315EFB",
    "showBadge": true
  }
}
```

命令会检查属性是否存在、枚举值、数字/布尔类型和 URL 安全性，再更新 `text`、attribute、style 或 CSS variable 绑定。修改记录在实例根节点的 `data-vfrag-property-overrides`，定义同步后仍会重新应用。

## 组件插槽

```json
{
  "action": "insertIntoComponentSlot",
  "elementId": "contribution-card-instance",
  "slot": "content",
  "element": {
    "type": "text",
    "id": "new-evidence",
    "text": "New evidence",
    "x": 20,
    "y": 40
  }
}
```

插槽命令检查允许元素类型、单值/多值约束和最大尺寸，再复用普通 `addElement` 创建真实节点。单值插槽已有用户内容时不会静默覆盖。

解除关联但保留当前 DOM：

```json
{ "action": "unlinkComponentInstance", "elementId": "contribution-card-instance" }
```

`summary` 的 `fragments` 字段以及 `npm run cli -- fragments <input>` 会返回定义 ID、实例 ID、版本、关联状态及暴露的属性/插槽名。

## 批处理与失败语义

命令文件可以是数组：

```json
[
  { "action": "replaceText", "elementId": "title-001", "text": "Revised title" },
  { "action": "moveElementBy", "elementId": "hero-image-001", "dx": 100, "dy": 0 },
  { "action": "deleteElement", "elementId": "icon-001" }
]
```

当前 CLI 在内存中按顺序执行；任一命令失败时不会写出输出文件。若未来需要部分成功语义，应增加显式事务选项，而不是静默跳过错误。
