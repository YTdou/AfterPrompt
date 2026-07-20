# Third-party notices

AfterPrompt is licensed under the Apache License 2.0. The project also uses
third-party software and font files that remain under their own licenses.
The AfterPrompt license does not replace or narrow those terms.

## Runtime dependencies

Versions below are resolved by `package-lock.json` for the current 0.4.0
development tree.

| Package | Resolved version | License |
| --- | --- | --- |
| `@codemirror/lang-html` | 6.4.11 | MIT |
| `@codemirror/search` | 6.7.1 | MIT |
| `@codemirror/state` | 6.7.1 | MIT |
| `@codemirror/view` | 6.43.6 | MIT |
| `codemirror` | 6.0.2 | MIT |
| `jsdom` | 26.1.0 | MIT |
| `jszip` | 3.10.1 | MIT OR GPL-3.0-or-later; AfterPrompt uses the MIT option |
| `moveable` | 0.53.0 | MIT |
| `prettier` | 3.9.5 | MIT |

Development dependencies include software under MIT, Apache-2.0, BSD,
ISC, 0BSD, MIT-0, MPL-2.0, and Zlib-compatible terms. The authoritative
package and version inventory is `package-lock.json`. Release archives built
by `scripts/build-release.sh` include the upstream license files installed in
`node_modules` so that binary distributions carry the applicable texts.

## Bundled fonts

| Font | Copyright or upstream | License file |
| --- | --- | --- |
| Inter | Copyright 2016 The Inter Project Authors | `src/assets/fonts/Inter-OFL-1.1.txt` |
| Liberation Serif | Copyright 2010 Google Corporation and 2012 Red Hat, Inc. | `src/assets/fonts/catalog/LICENSE-Liberation.txt` |
| Source Han Sans/Serif | Copyright 2014-2025 Adobe | `src/assets/fonts/catalog/LICENSE-SourceHan.txt` |
| LXGW WenKai Lite | Copyright 2021-2026 LXGW and 2020 The Klee Project Authors | `src/assets/fonts/catalog/LICENSE-LXGWWenKai.txt` |

These fonts are licensed under the SIL Open Font License 1.1, including any
reserved-font-name or additional-permission terms stated in their respective
license files. Times New Roman, Microsoft YaHei, SimSun, and KaiTi are not
redistributed by AfterPrompt.

## Reference material and user content

The ignored local `reference/` directory is not part of the tracked project or
its release archives. Any separately obtained reference project remains under
its own license.

Content imported into, edited by, or exported from AfterPrompt is not
automatically licensed under the AfterPrompt project license. Users remain
responsible for having the rights required for their content and embedded
assets.

