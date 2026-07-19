# Security model

## 威胁模型

导入文件可能由 AI 生成、来自本地下载或包含意外的活动内容。本 MVP 的安全目标是：静态视觉编辑不应顺带执行导入文档中的 JavaScript、事件处理器或本地命令。

它不是面向匿名多租户的完整浏览器沙箱，也不保证对所有浏览器解析漏洞提供防护。

## 导入净化

挂载预览前会：

- 删除 HTML `script`、`iframe`、`object`、`embed`、`base` 和 `portal`；
- 删除 SVG `script`、`foreignObject`、`animate*` 和 `set`；
- 删除所有 `on*` 属性和 `srcdoc`；
- 删除 `javascript:`、`vbscript:` 和非图片 `data:` URL；
- 删除 CSS `@import`、`expression()`、`-moz-binding` 和 JavaScript URL；
- 对外部 HTTP(S) 资源显示警告；
- 不载入外部 CSS 到 Shadow DOM。

净化同时作用于规范文档，因此标准导出不会重新带回已删除的活动内容。

## 预览隔离

HTML 正文被克隆到 Shadow DOM。它隔离导入 CSS 对编辑器界面的影响，并允许 Moveable 绑定真实节点。由于 Shadow DOM 不是安全 origin：

- 绝不把导入 `script` 或事件属性挂载进去；
- 不支持“允许脚本”开关；
- 外部图片仍可能产生网络请求，用户会看到外部资源警告；
- 如果部署为网络服务，应进一步使用 sandboxed iframe、独立 origin、CSP 和服务端 sanitizer。

## 演示预览与保真导出

导入的完整 HTML 由 `DOMParser` 解析为不会自行执行脚本的规范源码。画布和演示预览始终从规范源码创建一次性净化克隆：删除脚本、事件属性和危险节点后才挂载到 Shadow DOM 或预览 iframe，因此源运行时不会在编辑器环境执行。

“导出 HTML”直接序列化修改后的完整规范源码，保留源文件脚本、事件处理器和原生 Presentation controls。导出文件离开编辑器安全边界后，用户在浏览器中打开它会执行源文件自带代码；因此导入来源仍应被视为代码来源。旧版 Last Mile Studio Slides 兼容路径只解析固定数据声明，不执行旧文件脚本。

确定性字体是普通静态 WOFF2 数据，不引入脚本执行能力。只有文档显式设置 `data-lms-deterministic-font="inter"` 时才覆盖根字体继承；编辑器不会把任意系统字体文件读出或静默嵌入导出。随项目分发的 Inter 字体遵循 SIL Open Font License 1.1。

目录导入中的本地 CSS、图片、SVG 和字体在保真导出时转换为 data URL。无法解析的本地路径会保留并显示警告；外部 HTTP(S) 资源不会被下载或伪装成本地资源，因此导出文件在存在外部依赖时不保证完全离线。

## 本地资源

目录导入通过浏览器 `File` API 读取用户明确选择的文件。资源只保存在内存，预览使用临时 Blob URL；应用没有任意文件系统遍历能力。

CLI 只读取命令行显式提供的路径。默认要求 `--output`，不会隐式覆盖输入；`--in-place` 是明确的破坏性意图标记。

片段目录也必须由用户通过浏览器目录选择器明确授权。应用只扫描该目录第一层的 `.vfrag` 文件；不会遍历任意文件系统位置。目录中的无效包保持原样并从可用库中排除；删除操作先按包内 `fragmentId@version` 精确解析目标，不使用模糊文件名或递归删除。

## Visual Fragment 包

`.vfrag` 被视为不可信 ZIP 和不可信静态 HTML/SVG：

- manifest 必须通过公开 JSON Schema，脚本权限固定为 `false`；
- 拒绝绝对路径、盘符、反斜杠、`.` / `..`、重复路径和 CRC 错误；
- 限制压缩包、解压总量、单文件大小和文件数量；
- 必需入口、styles、tokens、preview 和 manifest 资源必须存在且相互一致；
- 内容在解包、规划和应用时都会重新解析、净化，不信任 preview 或 manifest 对安全性的自述；
- 网络和未打包资源进入兼容性报告，导入器不下载它们；
- ID、IDREF、SVG URL 和 CSS ID 引用在插入前统一映射，避免把冲突留给浏览器静默解析；
- HTML → SVG 被拒绝，SVG → HTML 只作为经过净化的 inline SVG。
- Raster 1.1 只允许 `content.png` 或 `content.jpg`，并验证真实签名、编码尺寸、manifest 尺寸、文件大小和像素面积；Raster 不能声明组件属性、插槽或关联实例。

用户确认兼容性报告表示允许保留报告中列出的外部静态资源引用，不表示允许脚本、事件处理器或本地命令。

## Codex 命令

JSON 命令只操作文档节点，不暴露 shell、动态 JavaScript、网络请求或数据库接口。命令仍可写入普通 HTML URL 和 CSS，因此命令来源应和源文件一样被视为用户授权输入。

## 已知缺口

- CSS 规范和 SVG URL 引用非常广，当前 sanitizer 不是 DOMPurify 的替代品；
- 外部图片、字体和 SVG `<use>` 可能泄露访问元数据；
- `data:image/svg+xml` 作为图片的浏览器行为依赖具体环境；
- 没有 Content Security Policy，因为 Vite 本地开发与 inline preview style 需要额外设计；
- `preview.svg` 的 HTML 缩略图使用 `foreignObject`；它只来自已经净化的片段内容，但不应被当作通用 SVG 恶意内容隔离器；
- 没有服务端上传、共享或身份边界。

在加入云协作之前，应重新进行专门的安全设计和攻击面测试。
