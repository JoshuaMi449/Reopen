# Reopen

你的本地项目陈列架——把网站和服务项目拖进菜单栏，常驻在线、一键启动、局域网分享。

> A local project shelf for macOS: drag in your web sites and services, keep them always-on, and share them over Wi-Fi.

## 功能一览

- **拖入即登记**：把项目文件夹或 HTML 文件拖进窗口，自动识别类型、预填名称/命令/端口
- **一个项目多种启动方式**：成品预览 / 开发服务器 / Python 后端 / bun·deno 服务 / Docker，条目内随时切换
- **统一入口 · localhost 链接跨项目自动打通**：所有已挂载项目共用一个访客地址 `http://<Mac IP>:8088/rp/<项目名>/`，页面里写死的 `localhost:端口` 链接自动改写为统一入口路由（详见下文）
- **局域网分享**：访客地址点击即复制，发给同一 Wi-Fi 的设备即可打开
- **项目组**：多项目容器自动成组（勾选收纳，支持「转移为新组」），分组 + 彩色标签管理
- **自启项**：把项目拖进自启面板，打开 Reopen 自动激活
- **菜单栏托盘**：常驻菜单栏的动态图标（内置角色动画 + 自定义 GIF 素材，速度随 CPU 波动），点击弹出面板查看系统信息与快捷操作
- **全局唤起**：默认 `⌥+R` 在任何软件里唤出主窗口（设置里可改）
- **环境体检**：Node.js / Python / Docker / Bun 有没有装一目了然，支持一键安装
- **失败自愈**：启动失败提示原因，一键装依赖、终止残留进程重启

## 支持的产品形态与识别场景

| 形态 | 拖入内容 | 识别结果 |
| --- | --- | --- |
| 单个网页文件 | `page.html` | 直接登记，显示网站标题小字 |
| 独立作品堆 | 根层平铺多个 HTML 的文件夹 | **自动成组**，每个 HTML 一个子项目（弹窗勾选收纳） |
| 多页静态网站 | 含子目录结构的站点文件夹 | 一个项目，全部页面入口可打开 |
| npm 前端项目 | 含 `package.json`（Vite/React 等） | 有 `dist` 给「成品预览」+「开发服务器」；没有则只给开发服务器 |
| Python 项目 | `requirements.txt` + `app.py`/`manage.py`/`main.py` | 自动识别 Flask/uvicorn 端口，改端口直接改写源码 |
| bun/deno 服务 | `serve.ts`/`serve.js` + `Bun.serve`/`Deno.serve` | 从启动脚本提取执行命令与端口 |
| 启动脚本 | `启动.command` / `launch.sh` / `start.sh` | 以 bash 执行脚本 |
| Docker Compose | `docker-compose.yml` | `docker compose up` 启动 |
| 多项目容器 | 含多个 `package.json` 的文件夹 | **自动成组**，每个项目根一个子项目 |
| .app 应用 | 应用包 | 询问是否解析（服务/网页包装器可转成对应类型） |

不支持的形态会给出明确提示（如 PHP 项目提示「需要 PHP 环境」；Vite 开发模板页提示拖入整个项目文件夹）。

## 统一入口与 localhost 链接自动打通

Reopen 的局域网分享不依赖每个项目自己的端口，而是走**统一入口**：

- 设置-通用里配置统一入口端口（默认 `8088`），已登记项目自动挂载为子路由 `http://<Mac IP>:8088/rp/<项目名>/`
- 访客只需要一个地址，不用记每个项目的端口号；端口占用时自动切换实际端口并回写

**三层判定**（拖入到挂载全自动）：

1. **拖入体检**：扫描项目 JS/HTML，若代码写死根路径跳转、`fetch('/api')`、`WebSocket('/')` 等（挂在子路径下必然断链的特征），该项目直接降级为独立端口访问，宁丢便利不丢正确
2. **挂载预判**：扫描到页面里写死 `localhost:端口` / `127.0.0.1:端口` 的链接（带不带尾斜杠都算）→ 进入**改写模式**：网关响应自动把这类链接翻译成统一入口路由，访客点开不会跳到自己的电脑上
3. **启动实测复核**：挂载后自动探测验证，日志第一行明牌「预判 + 实测确认/修正」的结果

**跨项目自动打通**：A 项目的页面里写着 `http://127.0.0.1:5001/` 的链接，而 5001 端口恰好是 B 项目的服务——改写模式下该链接被翻译成 B 项目在统一入口下的访客地址，访客从 A 点进去直接到达 B，两个项目自动串通，无需任何配置。

**根路径安全**：统一入口根路径（`http://<Mac IP>:8088/`）返回 404，不暴露任何文件列表——分享一个项目不会连带暴露其他项目。

## 安装

- 仅支持 **Apple Silicon Mac**（macOS 12+）
- 下载 dmg 拖入「应用程序」即可
- 首次打开若提示「无法验证开发者」：右键点击应用 →「打开」，或到 系统设置 → 隐私与安全性 里点「仍要打开」（应用为本地签名，未公证）
- 权限说明：
  - **文件夹访问**：从桌面/文稿/下载拖入项目时，系统按需弹一次授权询问（每目录一次，永久记住）；用「+」系统面板选择则无需任何授权
  - **通知**：可选，用于项目启动失败/断线提醒（引导页可开启）
  - **本地网络**（macOS 15+）：首次开启局域网分享时系统自动询问一次，允许即可

## 数据与隐私

- 项目清单保存在 `~/Library/Application Support/Reopen/projects.json`，全部数据本地存储
- 无账号、无上传、无遥测、无第三方分析

## 开发

```bash
npm install
npm run dev        # 开发模式（主进程改动需重启 dev 实例）
npm run build:mac  # 打包 dmg（arm64）
```

技术栈：Electron + React + TypeScript；菜单栏托盘为自建原生模块（Objective-C++ + SwiftUI 渲染管线，动态图标 + 全局点击监视）。

## License

[MIT](LICENSE) © 2026 JoshuaMi449

---

## Reopen (English)

A local project shelf for macOS. Drag your web sites and services in, and Reopen auto-detects their type (static site, npm/Python/bun·deno service, Docker, launch script…), keeps them running, and shares them on your LAN.

**Unified gateway**: every mounted project gets a guest URL like `http://<your-Mac-IP>:8088/rp/<slug>/`. Hard-coded `localhost:port` links inside pages are auto-rewritten to gateway routes — so visitors never bounce to their own machines, and cross-project links just work. A three-stage pipeline (static root-path scan on drop → localhost-ref prediction on mount → live probe verification) decides whether a project rides the gateway or falls back to its own port. The gateway root returns 404 — sharing one project never exposes the others.

**Requirements**: Apple Silicon Mac, macOS 12+. Download the dmg, drag to Applications, right-click → Open on first launch (locally signed, not notarized). All data stays local in `~/Library/Application Support/Reopen`.

**License**: [MIT](LICENSE) © 2026 JoshuaMi449
