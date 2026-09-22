# 第三方来源与素材说明

本文件区分实现参考、直接带入的文件和未核实的素材权利。Reopen 根目录的 MIT 许可证只覆盖作者有权授权的部分；不能把其他权利人的动画、角色形象或商标一并许可为 MIT。

## 不只因（BuZhiYin）

来源：[W-Mai/BuZhiYin](https://github.com/W-Mai/BuZhiYin)，仓库内 `LICENSE` 为 MIT，著作权声明为 `Copyright (c) 2023 Benign X`。Reopen 参考了其菜单栏动画实现。下列 18 张文件经 Git blob 哈希核对，与该仓库 `BuZhiYin/DefaultGIF/` 的对应文件完全一致：

`3body.gif`、`baby_circle.gif`、`big_mouse_frog.gif`、`cat.gif`、`cat2.gif`、`cat3.gif`、`color_worm.gif`、`everonecat0.gif`、`gojo_satoru.gif`、`hoshiguma.gif`、`jerry.gif`、`karby.gif`、`mongmong.gif`、`my0.gif`、`pink_cat.gif`、`xiaolan_turn.gif`，以及在 Reopen 中更名为 `jntm.gif` 的 `zhiyin.gif`、更名为 `jntm_basketball.gif` 的 `zhiyin_basketball.gif`。

上游 MIT 许可文本如下；该许可标记不保证上游对每个 GIF 所表现的第三方角色都拥有可转授权的权利。**在确认这些角色素材的来源和授权前，不应把它们当作可自由商用的 MIT 素材。**

```text
MIT License

Copyright (c) 2023 Benign X

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## RunCat / RunCat Neo

产品与开源代码：[runcat-dev/RunCatNeo](https://github.com/runcat-dev/RunCatNeo)，其仓库代码采用 [Apache-2.0](https://github.com/runcat-dev/RunCatNeo/blob/main/LICENSE)。Reopen 参考菜单栏动画与系统信息面板的设计行为；仍应逐文件核对是否有实质性移植的代码，若有则履行对应版本的许可证义务。Reopen 的提交记录注明 `resources/animations/dogeza.gif` 是从 RunCat 资源帧重制；本次尚未定位其原始文件和相应版本的素材授权，因此此文件需要继续核实或替换。不能仅凭 RunCat Neo 当前仓库的许可证推断该重制 GIF 已获授权。

## iStat Menus

产品：[Bjango iStat Menus](https://bjango.com/mac/istatmenus/)。Reopen 参考其系统信息和历史图交互；未在本仓库发现直接带入的 iStat Menus 程序或素材。iStat Menus 是专有软件，[许可协议](https://bjango.com/help/istatmenus7/licenseagreement/)保留其软件、文档及商标权利。Reopen 与 Bjango/iStat Menus 无关联，也不代表其官方版本。

## 再分发前的处理

要发布一个权利清晰的安装包，优先用原创或具有明确再分发许可的动画替换待核实素材，并在打包清单中逐项记录来源和许可。仅写署名或“仅供学习”不能代替权利人许可。既有 v1.1.0 安装包已经含有上述动画文件；本说明不会追溯改变它们的授权状态。
