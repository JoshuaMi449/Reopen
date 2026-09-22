# Reopen Windows 版可行性评估

评估基于 Reopen 1.1.0 的代码结构。结论：主窗口和项目清单可复用，但无法直接把当前 macOS 安装包重新打成 Windows 包；托盘和系统采样需要重做，项目进程管理也要适配 Windows。

| 模块 | 可复用部分 | Windows 需要做的工作 / 可见差异 |
| --- | --- | --- |
| 主窗口、设置、分组、项目卡、日志、局域网网关 | Electron/React/TypeScript 与大部分 Node 网络代码 | 适配路径、权限、文件关联、快捷键和浏览器选择；窗口边框和系统字体会不同。 |
| 系统托盘 | 动画 GIF 解帧和 React 弹窗内容 | 现有 `native/addon.mm`、`tray_runner.swift`、`color_sampler.swift` 只能在 macOS 编译。Windows 可用 Electron `Tray` 或 Win32 通知区域 API 重建动态图标、点击事件、弹窗定位和关闭行为。通知区域图标可能被系统收进溢出菜单；无法保证像 macOS 菜单栏那样始终并排显示动图和独立温度文字。 |
| 系统数据与历史 | 历史数据结构、时间桶、图表组件 | 替换 Mach/IOKit/SMC 采集器。CPU、内存、网络、磁盘、电池可做 Windows 采样；CPU 温度受硬件传感器和驱动支持限制，不能保证每台电脑显示或与 iStat 数字一致。需要为“无可用传感器”设计状态。 |
| 视觉外观 | 页面组件与用户自定义图形配色 | 跟随 Windows 系统浅/深色可沿用 Electron `nativeTheme`；macOS Liquid Glass/Popover 材质不能原样移植，应采用 Windows 11 的 Mica/Acrylic 或稳定的 CSS 实心底色。 |
| 项目启动与接管 | 项目模型、启动方式和日志 UI | `lsof`、`ps`、`open -a`、负 PID Unix 进程组信号、`.venv/bin/python`、`python3` 和 `.command`/shell 脚本需 Windows 分支。用 Windows 端口/进程查询、进程树终止、浏览器打开和 `Scripts/python.exe` 等规则；逐项验证 Node、Python、Docker、Bun、Deno 的启动和停止。 |
| 安装与升级 | electron-builder 已有 NSIS 目标和 `icon.ico` | 目前配置仍把 macOS 原生 `.node` 和 Swift dylib 当作资源。需按平台拆分构建、在 Windows 实机/虚拟机测试，并处理签名与更新分发。 |

单人熟悉 Electron 与 Windows 原生接口、具备 Windows 测试机的粗略工期：**3–5 周**可做“主窗口 + 项目管理 + 基本托盘”的可用版；**8–12 周**可接近当前 macOS 1.1.0 的功能覆盖，包含历史图、独立温度、动画、取色、安装与多硬件测试。若要求所有机器上温度传感器可用、系统托盘位置及 Liquid Glass 视觉与 Mac 完全一致，技术上不能保证。以上是估算，不是实测完成时间。

数据不会因添加 Windows 版而自动从 Mac 删除。两端各有自己的 Electron `userData` 目录；Windows 首次安装会显示空项目，除非提供导入。`projects.json` 和 `settings.json` 可以作为迁移输入，但 Mac 的绝对路径、`.app`、启动命令、虚拟环境路径和所选浏览器不能直接照搬。迁移应先备份原文件，复制数据并逐项重新定位项目、选择可运行的启动方式，再验证端口、自动启动和局域网地址。Mac 菜单栏历史和硬件采样不可直接视为 Windows 当前状态。

参考资料：[Electron Tray](https://www.electronjs.org/docs/latest/api/tray)、[Electron nativeTheme](https://www.electronjs.org/docs/latest/api/native-theme)、[Windows 通知区域](https://learn.microsoft.com/en-us/windows/win32/shell/notification-area)、[Windows 11 系统背景材质](https://learn.microsoft.com/en-us/windows/apps/develop/ui/system-backdrops)。
