# Visual Fragments

Visual Fragment 是 Last Mile Studio `0.4.0` 的可移植局部视觉格式。它不替代标准 HTML/SVG/PNG/JPEG，也不引入脱离源码的组件树：定义保存在用户拥有的 `.vfrag` 文件中，导入后的实例仍是真实 DOM/SVG/图片节点。

## 包格式

`.vfrag` 是 ZIP，格式版本与组件版本分开管理：

```text
fragment.vfrag
├── manifest.json
├── content.html | content.svg | content.png | content.jpg
├── styles.css
├── tokens.json
├── preview.svg
└── assets/
```

`manifest.json` 使用 [JSON Schema](../schemas/visual-fragment-manifest.schema.json) 验证。关键身份字段：

- `formatVersion`：包协议版本，当前固定为 `1.0`；
- `fragmentId`：组件定义 ID；
- `version`：用户定义的语义版本；
- `data-vfrag-instance-id`：导入页面后生成的实例 ID；
- `data-editor-id`：编辑器和 Codex 定位实际 DOM/SVG 节点的 ID。

这三类 ID 不能混为一谈。定义升级保留实例 ID，节点 ID 仍按目标文档唯一性规则生成。

## 保存模式

### Source-preserving

- 保留选中节点的 DOM/SVG 结构、class、普通 ID、稳定编辑器 ID 和语义属性；
- 只抽取实际匹配选区节点的样式声明；
- 将声明映射到稳定 `data-vfrag-node-key`，避免把原 class 选择器泄漏到目标页面；
- 补充继承型计算样式，减少失去祖先上下文后的差异。

### Self-contained

在 Source-preserving 基础上，按节点保存布局、排版、外观、SVG paint 等计算样式。该模式跨项目一致性更高，但 CSS 更详细。两种模式都保留源节点，不会栅格化为截图。

## 提取流程

1. 去除被另一个选中祖先包含的重复选择；
2. 合并真实浏览器边界，记录原页面位置；
3. 为 HTML 建立局部坐标容器，为 SVG 建立局部 `viewBox` 和平移分组；
4. 保留每个内部节点的稳定 `data-vfrag-node-key`；
5. 提取匹配 CSS、继承/计算样式和 CSS 自定义属性；
6. 收集属性、inline style 和外部 CSS 中的本地资源；
7. 递归收集选区外被 `href` / `url(#id)` 引用的 SVG defs；
8. 生成不执行脚本的 `preview.svg`；
9. 写入 manifest 并在打包前再次通过同一 Schema 验证。

无法读取的跨域 CSS、外部字体和缺失资源不会伪装成已打包内容，而是进入 warnings 和 permissions。

## 导入规划与冲突报告

导入分为 `plan` 和 `apply`。规划阶段不修改文档，检查：

- HTML/SVG 方向兼容性；
- 父节点存在、命名空间和锁定状态；
- 普通 `id` 与 `data-editor-id`；
- CSS class、keyframes 和 token 名称；
- 字体、已打包资产、外部或缺失资源；
- manifest、内容根、脚本/网络声明一致性。

规划同时生成普通 ID 和编辑器 ID 映射，并重写：

- `href="#id"`、`xlink:href`；
- `url(#id)`；
- ARIA IDREF、`for`、`headers`、`list`；
- CSS `#id` 和 `[data-editor-id="..."]`；
- 包内资源路径。

用户确认报告后，`apply` 才一次性插入样式、节点和资源。支持方向为 HTML → HTML、SVG → SVG、SVG → inline HTML；HTML → SVG 会被阻止。

## 组件属性

属性绑定到 `data-vfrag-node-key`，不会依赖导入后变化的编辑器 ID。

```json
{
  "name": "title",
  "label": "Title",
  "type": "text",
  "target": "title-001",
  "binding": { "kind": "text" },
  "defaultValue": "Adaptive Sampling"
}
```

绑定支持 `text`、`attribute`、`style` 和 `css-variable`。类型支持文本、数字、颜色、图片、图标、布尔、枚举、尺寸与 URL。URL 仍经过危险协议检查。

页面中的属性修改走共享命令：

```json
{
  "action": "updateComponentProperties",
  "elementId": "contribution-card-instance",
  "properties": {
    "title": "Adaptive Sampling",
    "accentColor": "#315EFB"
  }
}
```

实例覆盖以可读 JSON 写入根节点 `data-vfrag-property-overrides`，同步定义时重新应用。

## 内容插槽

插槽记录目标节点、允许类型、必填/多值、默认内容和尺寸上限。共享命令示例：

```json
{
  "action": "insertIntoComponentSlot",
  "elementId": "contribution-card-instance",
  "slot": "content",
  "element": {
    "type": "text",
    "text": "New evidence",
    "x": 20,
    "y": 40
  }
}
```

单值插槽第一次写入会替换默认内容，再次写入会明确失败；不会静默覆盖已有用户内容。

## 实例与版本

- 独立副本保存定义来源和版本，但 `data-vfrag-linked="false"`；
- 关联实例使用 `data-vfrag-linked="true"`；
- 解除关联只改变关联状态，不删除节点；
- 更新定义是在本地库写入同一 `fragmentId` 的新语义版本；
- “同步实例”只更新当前文档中的关联实例，保留位置、实例 ID、属性覆盖和已经填充的插槽内容；
- 样式按 `fragmentId@version#instanceId` 隔离；这允许同一片段的多个实例各自修复 SVG/CSS ID 引用，也允许新旧版本并存。

没有后台自动更新，也没有跨项目或云端隐式迁移。

## Local-first 本地库

用户选择的目录是首选事实源，每个版本保存为独立 `.vfrag` 文件。目录不依赖中央内容索引；重新连接后应用扫描包并从 manifest 重建库。可选 `.last-mile-library.json` 只保存收藏、使用次数和最近使用等设备侧 UI 状态，删除它不会影响片段内容或库重建。浏览器不支持目录 API 或用户拒绝授权时，仍可通过下载/导入 `.vfrag` 工作。

IndexedDB 数据库 `last-mile-studio-visual-fragments` 是“临时片段剪贴板”：非文字编辑状态下，`Ctrl/Cmd+C` 将当前画布选区写入其中，`Ctrl/Cmd+V` 取最新记录并作为独立副本插入；连续粘贴在原位置上逐次偏移。输入框和代码编辑器仍使用系统原生剪贴板。临时记录可能被浏览器清理，也不是用户文件的替代品；连接目录后可以把它们复制过去，迁移不会删除源记录。保存对话框不提供 IndexedDB 目标，未连接目录时默认下载 `.vfrag`。项目 JSON 不复制整个库；页面实例所需的 DOM、样式和资源仍随项目保存。

## Raster 1.1

格式 1.0 继续用于 HTML/SVG。格式 1.1 专用于 Raster element，入口为 `content.png` 或 `content.jpg`。导入器检查真实 PNG/JPEG 签名、编码中的尺寸、manifest 尺寸、字节上限和 100 MP 像素上限；`.jpeg` 输入规范化为 `content.jpg`。

Raster 插入 HTML 时物化为单个 `<img>`，插入 SVG 时物化为单个 `<image>`。图像字节进入项目资源，因此删除或移动原始本地文件不会破坏已有页面。Raster 不声明组件属性、插槽或关联实例，也不假装拥有内部图层。

## ZIP 安全边界

导入器拒绝：

- 绝对路径、Windows 盘符、反斜杠、空段、`.` 和 `..`；
- 超过 256 个文件；
- 超过 24 MiB 的单文件；
- 超过 64 MiB 的压缩包或解压总量；
- 超过 100,000,000 像素的片段画布；PNG 预览还会限制到 4096 px 单边和 16 MP；
- CRC 错误、重复路径、必需文件/资源缺失；
- 未通过 JSON Schema 的 manifest；
- manifest 与入口类型、网络声明或内容根不一致。

`permissions.scripts` 在 1.0/1.1 中必须为 `false`。片段导入不会恢复被净化的脚本、事件属性、iframe 或 SVG 动画。

## 验收

单元测试覆盖 1.0/1.1 包往返、PNG/JPEG 签名与尺寸、原始 SVG、HTML/SVG Raster 插入、目录重建与非破坏迁移。真实浏览器继续覆盖组件生命周期，并验证目录文件、原始 SVG 图层树和 PNG/JPEG 单图层语义。
