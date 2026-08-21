# Reopen 识别增强 —— 痛点诊断与修复方案

> 生成日期：2026-08-21。诊断基于本机 10 个真实案例实测。配套会话 json：`~/.claude/projects/-Users-mac/66dda8da-fc21-419e-94da-26175f90d22f.jsonl`

## 一、痛点总结（一句话版）

1. **识别不出**：`package.json` 只查拖入目录的第一层，嵌套项目（1~3 层深）全部 no-match
2. **Not Found 实锤**：文件夹命中 web 类型时，`findHtml` 找到的 html 文件路径被**丢弃**，启动时永远打开目录根 `/`，没有 `index.html` 就 404
3. **端口永远猜不出**：框架默认端口匹配的是 `npm run dev` 这个命令字符串（不含框架名），而 vite/next 的端口规则写在 scripts 的**脚本内容**里 → 端口留空 → 不打开浏览器
4. **类型覆盖缺口**：Python（Flask）、bun/deno 静态服务、`.command` 启动脚本三类完全不支持，被误判成 web
5. **多项目容器**：一个文件夹里多个独立项目（supOS-Free网页构建。）无法表达
6. **端口漂移**：vite 端口被占自动 +1 时，健康检查仍等旧端口，超时失败

## 二、现状代码定位

| 文件 | 关键函数 | 现状行为 |
|---|---|---|
| `src/main/detect.ts` | `detectPath()` | 文件夹：根目录有 package.json → service；否则 findHtml（下钻2层、跳过隐藏目录/node_modules）→ web；否则 no-match |
| `src/main/detect.ts` | `guessCommand()` | 只读**根目录** package.json，按 `SCRIPT_CANDIDATES = ['dev','start','serve','dev:app','dev:server','web']` 猜 `npm run xxx` |
| `src/main/detect.ts` | `readPort()` | 四层：源码 listen() → .env PORT → vite/webpack config → **框架默认**（匹配 `command.toLowerCase()`，即 `npm run dev` 字符串） |
| `src/main/detect.ts` | `findHtml()` | 返回 html 的绝对路径，但 detect 结果里**只用 basename 做名字，路径丢弃** |
| `src/shared/types.ts` | `DetectSuccess` | `suggested: { name, command?, port? }` —— 没有 entryPath 字段 |
| `src/main/webServer.ts` | `startWebServer(path, port?)` | 文件夹时 `/` → 找 `index.html`，找不到 → **404 Not Found** |
| `src/main/projectManager.ts` | `startWeb()` | 打开 `http://localhost:port/`（无入口文件路径） |
| `src/main/projectManager.ts` | `startService()` | 端口健康检查 30s/500ms 轮询已做得不错；但检查目标端口固定是登记值 |

## 三、案例诊断表（为什么会失败）

| # | 案例路径 | 项目类型 | Reopen 现状 | 根因编号 |
|---|---|---|---|---|
| 1 | `Downloads/杂/杂杂/原网盘/杂/SCADA对接网页` | Vite 落地页（dev: `vite`，无 start） | 识别为 service 但 **port=undefined** → 不打开浏览器 | P3 |
| 2 | `.../open suposs com` | Next.js 官网（package.json 在 `my-app/` 深度1） | **no-match 识别不出** | P1 |
| 3 | `.../my-app` | Next.js 官网（package.json 在 `my-app/my-app/my-app/` 深度3） | **no-match 识别不出** | P1 |
| 4 | `.../supOS-Free网页构建。` | 多项目容器（supos-free-site + app + workshop-twin 三个 Vite 项目 + 2 个散装 html） | 误判 web → 打开 `/` → **Not Found 实锤** | P2+P5 |
| 5 | `~/.lanzhuo-skills/lanzhuo-md` | Node 服务（dev: `node src/server/index.js`，端口 3459） | ✅ 正常（回归基准） | — |
| 6 | `~/wechat-mp-dashboard` | Python Flask（`requirements.txt` + `server/app.py`，`app.run(port=5000)`） | 误判 web → 打开 `/` → 无 index.html → **Not Found**；正确方式应为 python 服务 | P2+P4 |
| 7 | `~/texpeed-local` | bun 静态服务（`启动.command` 里 `bun run serve.ts`，端口 3470，无 package.json） | 误判 web → 静态打开（MIME/资源可能不符） | P4 |
| 8 | `~/mediastory` | 前后端分离：根 Vite（dev: `vite`）+ `server/` Express+Socket.IO（dev: `tsx watch`） | 根目录 port=undefined；`server/` 不被发现 | P1+P3 |
| 9 | `~/Reopen` 自身 | Electron+Vite | 拖入可识别（回归基准） | — |
| 10 | 单 html 文件 | 静态网页 | ✅ 正常（但 entryPath 修复后需回归） | — |

**类型分布**（发布 git 前建议全测一遍）：Vite / Next.js / Node 原生 / Python Flask / bun 静态 / 多项目容器 / 三层套娃 / 前后端分离 —— 覆盖了识别规则需要的全部类型。

## 四、修复设计（P 痛点 → S 方案）

### S1. 项目根下钻（修 P1：案例2、3、8）

`detectPath` 对文件夹新增 `findProjectRoots(dir, maxDepth=4)`：
- 根目录有 package.json → `[dir]`
- 否则递归下钻，收集所有含 package.json 的目录（跳过 node_modules、`.git`、dist、build、`.next`）
- 1 个 → 直接以该目录为项目根走现有 service 流程
- ≥2 个 → 走 S2 多项目容器
- 0 个 → 继续 html 分支

注意 `guessCommand`/`readPort` 全部改用找到的项目根，而非拖入路径。

### S2. 多项目容器（修 P5：案例4、8）

- `DetectOutcome` 新增 `{ ok: true, kind: 'multi', projects: DetectSuccess[] }`
- 容器内每个项目根复用同一套 detect 逻辑生成子结果；容器内散装 html 也列为一个候选（案例4 的 `supos-case-anjia.html`）
- UI：拖拽后弹窗列出全部候选，勾选一个或多个分别登记

### S3. entryPath 贯穿（修 P2：案例4、6 的 Not Found 直接根因）

- `DetectSuccess.suggested` 增加 `entryPath?: string`（相对文件夹的路径，如 `/supos-case-anjia.html`，findHtml 命中的文件）
- `Project` 类型增加 `entryPath?` 并持久化（`store.ts`）
- `startWebServer(path, port, entryPath?)`：请求 `/` 时优先返回 entryPath 指向的文件
- `startWeb`/`openProjectBrowser` 打开 `http://localhost:port + entryPath`，不再永远 `/`

### S4. 框架默认端口改匹配脚本内容（修 P3：案例1、8 的 port=undefined）

`readPort` 第 4 层（框架默认端口）目前匹配 `command`（=`npm run dev`，永远不含框架名）。改为匹配 **scripts 里被选中脚本的内容**：

| 脚本内容含 | 默认端口 |
|---|---|
| `vite`（无 `next`） | 5173 |
| `next dev` | 3000 |
| `astro` | 4321 |
| `umi` | 8000 |
| `flask` / `app.run` | 5000 |
| `uvicorn` | 8000 |
| `Bun.serve` | 读源码 port |

实现：`guessCommand` 同时返回命中的脚本内容（如 `{ command: 'npm run dev', script: 'vite' }`），`readPort` 用 `script` 匹配。

### S5. Python 类型（修 P4：案例6）

- 检测：目录含 `requirements.txt` 且存在 `app.py`/`manage.py`/`main.py`（可下钻 2 层，案例6 的 `app.py` 在 `server/` 子目录）
- 命令优先级：`.venv/bin/python <入口>`（存在 .venv 时）→ `python3 <入口>`；cwd 用项目根
- 端口：读入口源码 `app.run(...port=N)` / `uvicorn.run(...port=N)`；读不到用上表默认（Flask 5000 / uvicorn 8000）

### S6. bun/deno 类型（修 P4：案例7）

- 检测：无 package.json 但存在 `serve.ts`/`serve.js`，且（存在 `启动.command`/`launch.sh` **或** 源码含 `Bun.serve`/`Deno.serve`）
- 命令：优先从 `.command`/`launch.sh` 提取执行行（案例7：`bun run serve.ts`）；否则 `bun serve.ts` / `deno run --allow-net serve.ts`
- 端口：源码 `Bun.serve({ port: N })`；或脚本里 `open http://localhost:N` / `localhost:N` 字样

### S7. 启动脚本类型（补 P4）

存在 `*.command`/`launch.sh`/`start.sh` 且无法归类为上面任何类型时：command = `bash "<脚本路径>"`（`cd` 到脚本所在目录执行，脚本内一般已 cd）。

### S8. 端口漂移日志解析（修 P6：vite 端口被占自动 +1 场景）

`startService` 健康检查期间，从 `pipeLog` 的日志流解析 `http://localhost:(\d+)` 首次出现的新端口：
- 新端口 ≠ 登记端口时，切换健康检查目标为该端口，就绪后 `touchLastPort` 并打开**实际端口**
- 日志解析失败保持现状（超时报错），不破坏现有逻辑

### S9. 隐藏目录（补 P1 边界）

拖入路径**本身**是隐藏目录（如 `.lanzhuo-skills`）时，下钻跳过规则只应用于其**子目录扫描**，不跳过根目录本身。

### 回归底线（不能破坏的现状）

- 案例5（lanzhuo-md，源码 listen(3459) 读端口）必须保持 ✅
- 单 html 文件、`.app` 解析、duplicate 查重逻辑不动
- `SCRIPT_CANDIDATES` 顺序语义不变（dev 优先）

## 五、实施步骤（依赖顺序）

1. `src/shared/types.ts` — suggested 加 entryPath；DetectOutcome 加 kind:'multi'；Project 加 entryPath?
2. `src/main/detect.ts` — 核心重构：S1/S2/S4/S5/S6/S7/S9
3. `src/main/webServer.ts` — startWebServer 加 entryPath 参数（S3）
4. `src/main/projectManager.ts` — startWeb/openProjectBrowser 传 entryPath；S8 日志端口解析
5. `src/main/store.ts` — Project.entryPath 持久化（若 types 加了字段）
6. UI（拖拽面板 + `src/renderer/src/components/ProjectFormModal.tsx`）— multi 候选勾选弹窗；表单预填 entryPath
7. `npm run typecheck` / lint 通过
8. 按下表实测 10 案例后 git commit

## 六、验证清单（10 案例实测预期）

| 案例 | 预期识别 | 预期 command | 预期端口 | 浏览器预期 |
|---|---|---|---|---|
| SCADA对接网页 | service | `npm run dev` | 5173（脚本内容 vite） | 落地页正常 |
| open suposs com | service（下钻 my-app） | `npm run dev` | 3000（脚本内容 next dev） | 官网首页 |
| my-app 套娃 | service（下钻3层） | `npm run dev` | 3000 | 官网首页 |
| supOS-Free网页构建。 | **multi**（3项目+2html候选） | 勾选后各自正确 | 各 5173 | 官网/生成器/孪生/案例页 |
| lanzhuo-md | service（回归） | `npm run dev` | 3459 | 服务正常 |
| wechat-mp-dashboard | service（Python） | `.venv/bin/python server/app.py` 或 `python3 server/app.py` | 5000 | 看板有数据 |
| texpeed-local | service（bun） | `bun run serve.ts`（提取自 .command） | 3470 | 页面正常 |
| mediastory（拖根） | multi（根 Vite + server） | 两个候选 | 5173 / server 读源码 | 分别正常 |
| Reopen 自身 | service（回归） | `npm run dev` | — | 正常 |
| 单个 html 文件 | web（回归） | — | 自动分配 | 打开该文件（entryPath） |

## 七、修复后实测记录（2026-08-21 全跑通）

| 案例 | 实测识别 | 实测 command | 实测端口 | 备注 |
| --- | --- | --- | --- | --- |
| SCADA对接网页 | service | `npm run dev` | 5173 | 与预期一致 |
| open suposs com | service（下钻 my-app） | `npm run dev` | 3000 | 与预期一致 |
| my-app 套娃 | service（下钻3层） | `npm run dev` | 3000 | 与预期一致 |
| supOS-Free网页构建。 | multi：**6 候选** | 各 `npm run dev` | app/workshop-twin=3000、site/supos-free-site=5173、2 个 html 无端口 | 比预期多 2 个：feishu-base-replay/site 与 .scout（真实项目，诊断时漏看）；app/workshop-twin 的 3000 读自各自 vite.config.ts 实际配置，比假设的 5173 更准 |
| lanzhuo-md | service（回归） | `npm run dev` | 3459 | 与预期一致 |
| wechat-mp-dashboard | service（Python） | `.venv/bin/python "app.py"` | 5001 | 根目录也有 app.py（port=5001），就近优先命中；诊断预期 server/app.py 5000 为旧信息 |
| texpeed-local | service（bun） | `bun run serve.ts` | 3470 | 修掉提取行尾 ` &` 后台符 |
| mediastory（拖根） | multi：根 Vite + server + 根层 index.html | 各 `npm run dev` | 5173 / 3001 | server 端口需两处小修：入口正则支持 `tsx watch` 子命令、`process.env.PORT || '3001'` 的引号匹配 |
| Reopen 自身 | service（回归） | `npm run dev` | 5173 | 正常 |
| 单个 html 文件 | web（回归） | — | 自动分配 | 与预期一致 |

S8（vite 端口漂移日志解析）为运行时场景，当前无端口冲突环境，待真机场景验证；逻辑为启动日志出现 `localhost:<新端口>` 即切换健康检查目标并打开实际端口。
