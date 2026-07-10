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

## 本地资源

目录导入通过浏览器 `File` API 读取用户明确选择的文件。资源只保存在内存，预览使用临时 Blob URL；应用没有任意文件系统遍历能力。

CLI 只读取命令行显式提供的路径。默认要求 `--output`，不会隐式覆盖输入；`--in-place` 是明确的破坏性意图标记。

## Codex 命令

JSON 命令只操作文档节点，不暴露 shell、动态 JavaScript、网络请求或数据库接口。命令仍可写入普通 HTML URL 和 CSS，因此命令来源应和源文件一样被视为用户授权输入。

## 已知缺口

- CSS 规范和 SVG URL 引用非常广，当前 sanitizer 不是 DOMPurify 的替代品；
- 外部图片、字体和 SVG `<use>` 可能泄露访问元数据；
- `data:image/svg+xml` 作为图片的浏览器行为依赖具体环境；
- 没有 Content Security Policy，因为 Vite 本地开发与 inline preview style 需要额外设计；
- 没有服务端上传、共享或身份边界。

在加入云协作之前，应重新进行专门的安全设计和攻击面测试。
