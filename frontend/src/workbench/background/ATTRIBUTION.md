# 背景方案参考与署名（Attribution）

ReproCheck 一级工作台背景（`src/workbench/background/`）为原创实现，未逐字复制以下仓库源码；
其噪声模型、丝绸褶皱与性能工程模式在调研后参考了下列开源项目。许可证与版权声明按各仓库原始要求保留于此。

## 本轮实际参考（第二轮）

| 仓库 | 许可证 | 版权 | 参考内容 |
| --- | --- | --- | --- |
| [subhadeeproy3902/velvet](https://github.com/subhadeeproy3902/velvet) | MIT | Copyright (c) 2026 Subhadeep Roy | 旋转各向异性 fbm、ridge 脊线、fine fiber 细纤维与 sheen 的织物模型；重新实现为值噪声 + 4 层 fbm |
| [ABE1617/ShaderDrop](https://github.com/ABE1617/ShaderDrop) | MIT | Copyright (c) 2025 ShaderDrop | Silk Flow 的噪声混色与缓慢流动结构；只保留其色彩关系，未复制 GLSL 原文 |
| [godwire/react-aurora-background](https://github.com/godwire/react-aurora-background) | MIT | Copyright (c) 2026 godwire | domain warping 思路：把 fbm 反馈进采样坐标，形成被拉伸的绸带 |
| [paper-design/shaders](https://github.com/paper-design/shaders) | Apache-2.0 | Copyright paper-design contributors | 仅借鉴「颗粒作为最后一道质感层」的工程顺序；未复制 `grain-gradient.tsx` 代码 |
| [nonlineartom/gradient-backdrops](https://github.com/nonlineartom/gradient-backdrops) | MIT | Copyright (c) 2026 nonlineartom | CSS 静态降级与离线暂停思路 |
| [PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) | MIT | Copyright (c) 2017 Pavel Dobryakov | 流体方案评估；因成本与视觉方向不匹配，未在运行时采用 |

Apache-2.0 全文见 <https://www.apache.org/licenses/LICENSE-2.0>。

## 上一轮参考

| 仓库 | 许可证 | 版权 | 参考内容 |
| --- | --- | --- | --- |
| [TheNaubit/react-aurora-background](https://github.com/TheNaubit/react-aurora-background) | MIT | Copyright (c) 2022 Albert Adler \| Naucode | 加权高斯光斑着色模型、低离屏分辨率渲染、帧率上限、visibilitychange 暂停、渲染预算控制 |
| [LalithK90/background-lab](https://github.com/LalithK90/background-lab) | MIT | Copyright (c) 2026 Lalith K | CSS 极光、SVG goo 流体滤镜成本、Three.js WebGL 方案取舍调研 |
| [kmikeym/motion-backgrounds](https://github.com/kmikeym/motion-backgrounds) | CC0 1.0 Universal | 公有领域贡献 | 纯 CSS/SVG 网格光斑降级结构参考 |

## MIT 许可声明

Permission is hereby granted, free of charge, to any person obtaining a copy of the
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

## 未使用的素材

- 未引入任何付费组件、商业素材或来源不明的代码；
- 未复制各仓库的演示页面或静态壁纸；
- 未新增第三方运行时依赖（WebGL 为浏览器原生能力）。
