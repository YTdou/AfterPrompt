# Managed editor fonts

These files are vendored only as deterministic fallbacks for the editor's font catalog.

| File | Upstream | Purpose | License |
| --- | --- | --- | --- |
| `LiberationSerif-Regular.ttf` | liberation-fonts 2.1.5 | Times New Roman fallback | SIL OFL 1.1 |
| `SourceHanSansSC-VF.woff2` | adobe-fonts/source-han-sans `release` | Microsoft YaHei fallback | SIL OFL 1.1 |
| `SourceHanSerifSC-VF.woff2` | adobe-fonts/source-han-serif `release` | SimSun fallback | SIL OFL 1.1 |
| `LXGWWenKaiLite-Regular.ttf` | lxgw/LxgwWenKai-Lite `main` | KaiTi fallback | SIL OFL 1.1 |

The corresponding license texts are stored beside the binaries. Times New Roman, Microsoft YaHei, SimSun, and KaiTi are not included: the catalog may use a locally installed copy through CSS `local(...)`, but the application does not redistribute those proprietary system font files.
