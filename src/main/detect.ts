// 拖拽识别模块：判断拖进来的是什么、猜表单预填（PRD 3.2 全自动猜）
// 识别增强（docs/03）：S1 下钻找项目根 / S2 多项目容器 / S4 框架端口匹配脚本内容 /
// S5 Python / S6 bun·deno / S7 启动脚本 / S9 隐藏根不跳过
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { basename, extname, join, resolve } from 'path'
import { pinyin } from 'pinyin-pro'
import type {
  DetectOutcome,
  DetectSuccess,
  LaunchMode,
  PortSource,
  ProjectType
} from '../shared/types'
import { listProjects } from './store'

// 服务启动命令猜的优先级：常见开发脚本名
const SCRIPT_CANDIDATES = ['dev', 'start', 'serve', 'dev:app', 'dev:server', 'web']
/** 下钻/扫描时跳过的目录名（S1：构建产物和依赖，不是项目） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next'])
/** 启动脚本文件名（S6 提取执行行 / S7 兜底执行） */
const LAUNCH_SCRIPTS = ['启动.command', 'launch.sh', 'start.sh']

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** 查重：该路径已经登记过？是则返回 duplicate 结果，否则原样返回成功结果 */
function successOrDuplicate(p: string, result: DetectSuccess): DetectOutcome {
  const normalized = resolve(p)
  const dup = listProjects().find((proj) => resolve(proj.path) === normalized)
  return dup ? { ok: false, kind: 'duplicate', name: dup.name } : result
}

/** 读 html 文件的 <title>（弹窗里显示，用户一眼认出是哪个网站） */
function readTitle(file: string): string | undefined {
  try {
    const m = readFileSync(file, 'utf-8').match(/<title>([^<]*)<\/title>/i)
    return m?.[1]?.trim() || undefined
  } catch {
    return undefined
  }
}

/** 递归统计目录文件数（成品"大小"判断用；上限 5000 防异常目录） */
function countFiles(dir: string): number {
  let count = 0
  const walk = (d: string): void => {
    if (count > 5000) return
    try {
      for (const name of readdirSync(d)) {
        const full = join(d, name)
        if (name === 'node_modules') continue
        if (isDir(full)) walk(full)
        else count++
      }
    } catch {
      // 读不了就算了
    }
  }
  walk(dir)
  return count
}

/** 浅层找 html 文件（最多下钻 3 层，跳过隐藏目录和 SKIP_DIRS） */
function findHtml(dir: string, depth = 0): string | null {
  if (depth > 3) return null
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const ext = extname(name).toLowerCase()
      if (ext === '.html' || ext === '.htm') return full
      if (isDir(full) && !name.startsWith('.') && !SKIP_DIRS.has(name)) {
        const hit = findHtml(full, depth + 1)
        if (hit) return hit
      }
    }
  } catch {
    // 无权限/无法读取的目录忽略
  }
  return null
}

/** 收集文件夹里的全部网页入口（多入口清单，登记后都能打开；
 *  最多下钻 3 层，跳隐藏目录和 SKIP_DIRS；按文件大小从大到小排——最大的最可能是主页，排第一当主入口） */
function findHtmlEntries(dir: string): string[] {
  const out: { rel: string; size: number }[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 3) return
    try {
      for (const name of readdirSync(d)) {
        const full = join(d, name)
        if (isDir(full)) {
          if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
          walk(full, depth + 1)
        } else if (/\.html?$/i.test(name)) {
          let size = 0
          try {
            size = statSync(full).size
          } catch {
            // 读不了大小按 0 排后面
          }
          out.push({ rel: toEntryPath(dir, full), size })
        }
      }
    } catch {
      // 读不了的目录忽略
    }
  }
  walk(dir, 0)
  // 根层 index.html 优先当主入口（首页不能被体积更大的内页挤掉，否则打开会跳过首页；
  // 其余仍按大小排）
  out.sort((a, b) => {
    const ai = a.rel === '/index.html' ? 1 : 0
    const bi = b.rel === '/index.html' ? 1 : 0
    if (ai !== bi) return bi - ai
    return b.size - a.size
  })
  return out.map((x) => x.rel)
}

/** 绝对路径 → 相对文件夹的入口路径（如 /case-home.html；S3 entryPath） */
function toEntryPath(dir: string, full: string): string {
  return full.slice(dir.length)
}

/** S1：找项目根。
 *  根有 package.json → [根] + 直接子目录里也含 package.json 的（前后端分离场景，案例8 mediastory）；
 *  根没有 → 递归下钻最多 4 层，收集所有含 package.json 的目录（案例2/3 的嵌套项目、案例4 的多项目容器） */
function findProjectRoots(dir: string, depth = 0): string[] {
  const hasPkg = existsSync(join(dir, 'package.json'))
  if (hasPkg) {
    const roots = [dir]
    try {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (!isDir(full) || name.startsWith('.') || SKIP_DIRS.has(name)) continue
        if (existsSync(join(full, 'package.json'))) roots.push(full)
      }
    } catch {
      // 读不了目录就算了
    }
    return roots
  }
  if (depth > 4) return []
  const out: string[] = []
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (!isDir(full) || name.startsWith('.') || SKIP_DIRS.has(name)) continue
      if (existsSync(join(full, 'package.json'))) out.push(full)
      else out.push(...findProjectRoots(full, depth + 1))
    }
  } catch {
    // 无权限/无法读取的目录忽略
  }
  return out
}

/** 在 package.json scripts 里猜启动命令（S4：同时返回脚本内容，框架默认端口要匹配它） */
function guessCommand(dir: string): { command: string; script: string } | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
    const scripts: Record<string, string> = pkg.scripts ?? {}
    for (const name of SCRIPT_CANDIDATES) {
      if (scripts[name]) return { command: `npm run ${name}`, script: scripts[name] }
    }
    const first = Object.keys(scripts)[0]
    if (first) return { command: `npm run ${first}`, script: scripts[first] }
  } catch {
    // package.json 解析失败就猜不出
  }
  return undefined
}

/** 第 1 层：入口源码写死的端口（listen(3459) / PORT || 3459），最确定。
 *  返回来源片段：改端口时直接替换源文件里这段数字 */
function readSourcePort(dir: string): { port: number; source: PortSource } | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
    const scripts: Record<string, string> = pkg.scripts ?? {}
    for (const name of SCRIPT_CANDIDATES) {
      const script = scripts[name]
      if (!script) continue
      const m = script.match(
        /(?:node|tsx|ts-node|bun)\s+(?:(?:--[A-Za-z0-9-]+|watch)\s+)*([\w./-]+\.(?:js|ts|mjs|cjs))/
      )
      const entry = m?.[1]
      if (!entry) continue
      const src = readFileSync(join(dir, entry), 'utf-8')
      const lm = src.match(/listen\(\s*(\d{2,5})/) ?? src.match(/listen\(\s*\n\s*(\d{2,5})/)
      if (lm && lm.index !== undefined) {
        return {
          port: Number(lm[1]),
          source: { file: entry, find: lm[0], portAt: lm[0].indexOf(lm[1]), portLen: lm[1].length }
        }
      }
      // 端口常带引号（process.env.PORT || '3001'），加可选引号匹配
      const em = src.match(/process\.env\.PORT\s*\|\|\s*['"]?(\d{2,5})/)
      if (em && em.index !== undefined) {
        return {
          port: Number(em[1]),
          source: { file: entry, find: em[0], portAt: em[0].indexOf(em[1]), portLen: em[1].length }
        }
      }
    }
  } catch {
    // 读不到就算了
  }
  return undefined
}

/** 第 2 层：环境变量文件里的 PORT=3459 */
function readEnvPort(dir: string): { port: number; source: PortSource } | undefined {
  for (const f of ['.env', '.env.local', '.env.development', '.env.dev', '.env.production']) {
    try {
      const content = readFileSync(join(dir, f), 'utf-8')
      const m = content.match(/^PORT\s*=\s*(\d{2,5})/m)
      if (m && m.index !== undefined) {
        return {
          port: Number(m[1]),
          source: { file: f, find: m[0], portAt: m[0].indexOf(m[1]), portLen: m[1].length }
        }
      }
    } catch {
      // 没有这个文件就算了
    }
  }
  return undefined
}

/** 第 3 层：框架配置文件（vite.config / webpack.config 里的 server.port、devServer.port） */
function readConfigPort(dir: string): { port: number; source: PortSource } | undefined {
  try {
    for (const name of readdirSync(dir)) {
      if (!/^(vite|webpack)\.config\.(js|ts|mjs|cjs)$/.test(name)) continue
      const content = readFileSync(join(dir, name), 'utf-8')
      const m =
        content.match(/(?:server|devServer)\s*:\s*\{[^}]*?port\s*:\s*(\d{2,5})/) ??
        content.match(/port\s*:\s*(\d{2,5})/)
      if (m && m.index !== undefined) {
        return {
          port: Number(m[1]),
          source: { file: name, find: m[0], portAt: m[0].indexOf(m[1]), portLen: m[1].length }
        }
      }
    }
  } catch {
    // 读不到就算了
  }
  return undefined
}

/** 第 4 层：按脚本内容猜框架默认端口（S4：匹配 scripts 里选中脚本的内容，不再是命令名） */
function defaultPortFromScript(script: string): number | undefined {
  const s = script.toLowerCase()
  if (s.includes('next')) return 3000
  if (s.includes('vite')) return 5173
  if (s.includes('astro')) return 4321
  if (s.includes('umi')) return 8000
  if (s.includes('flask') || s.includes('app.run')) return 5000
  if (s.includes('uvicorn')) return 8000
  return undefined
}

/** 从项目读端口：按确定性从高到低；四层都读不到返回 undefined（表单留空请用户填，不瞎猜）。
 *  带来源片段：改端口时直接改写源文件；第 4 层默认端口只有 vite --port 可写（package.json） */
function readPort(
  dir: string,
  guessed: { command: string; script: string } | undefined
): { port: number; source?: PortSource } | undefined {
  if (!guessed) return undefined
  // 1. 源码写死
  const srcPort = readSourcePort(dir)
  if (srcPort) return srcPort
  // 2. 环境变量文件
  const envPort = readEnvPort(dir)
  if (envPort) return envPort
  // 3. 框架配置文件
  const cfgPort = readConfigPort(dir)
  if (cfgPort) return cfgPort
  // 4. 框架默认端口（按脚本内容）；vite 的 --port 参数可以改（含缺值补写），其它框架默认没有可写的来源
  const scriptSrc = readScriptPortSource(guessed.script)
  if (scriptSrc) return scriptSrc
  const def = defaultPortFromScript(guessed.script)
  return def ? { port: def } : undefined
}

/** 第 4 层辅助：package.json 脚本里的 --port 参数（`vite --host --port 5173` 或缺值 `--port`） */
function readScriptPortSource(script: string): { port: number; source: PortSource } | undefined {
  const m = script.match(/--port[=\s]+(\d{2,5})/)
  if (m && m.index !== undefined) {
    return {
      port: Number(m[1]),
      source: { file: 'package.json', find: m[0], portAt: m[0].indexOf(m[1]), portLen: m[1].length }
    }
  }
  // --port 缺值（vite --host --port）：改写时把数字补在参数后面
  const m2 = script.match(/--port\b(?![=\s]*\d)/)
  if (m2 && m2.index !== undefined) {
    return {
      port: defaultPortFromScript(script) ?? 5173,
      source: { file: 'package.json', find: m2[0], portAt: m2[0].length, portLen: 0 }
    }
  }
  return undefined
}

/** S5：Python 入口文件（app.py/manage.py/main.py，可下钻 2 层，案例6 的在 server/ 里） */
function findPythonEntry(dir: string, depth: number): string | null {
  if (depth > 2) return null
  try {
    for (const name of readdirSync(dir)) {
      if (/^(app|manage|main)\.py$/.test(name)) return join(dir, name)
    }
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (isDir(full) && !name.startsWith('.') && !SKIP_DIRS.has(name)) {
        const hit = findPythonEntry(full, depth + 1)
        if (hit) return hit
      }
    }
  } catch {
    // 读不了就算了
  }
  return null
}

/** 探测函数的轻量返回（只供 buildLaunchModes 取 command/port，不再是完整候选） */
interface DetectHint {
  ok: true
  type: ProjectType
  path: string
  suggested: { name: string; command?: string; port?: number; portSource?: PortSource }
}

/** S5：Python 项目（requirements.txt + 入口 py）。端口读源码 app.run/uvicorn.run 的 port，读不到按框架默认 */
function detectPython(dir: string): DetectHint | null {
  if (!existsSync(join(dir, 'requirements.txt'))) return null
  const entry = findPythonEntry(dir, 0)
  if (!entry) return null
  const rel = entry.slice(dir.length + 1)
  let src = ''
  try {
    src = readFileSync(entry, 'utf-8')
  } catch {
    // 读不到源码就读不了端口，命令照给
  }
  const venv = existsSync(join(dir, '.venv/bin/python'))
  const command = `${venv ? '.venv/bin/python' : 'python3'} "${rel}"`
  const port =
    src.match(/app\.run\([^)]*port\s*=\s*(\d{2,5})/) ??
    src.match(/uvicorn\.run\([^)]*port\s*=\s*(\d{2,5})/)
  const defaultPort = port
    ? Number(port[1])
    : src.includes('uvicorn')
      ? 8000
      : src.includes('flask') || src.includes('app.run')
        ? 5000
        : undefined
  // 源码写死端口（app.run(port=5001)）记下来源：改端口时直接改写源码
  const portSource: PortSource | undefined =
    port && port.index !== undefined
      ? { file: rel, find: port[0], portAt: port[0].indexOf(port[1]), portLen: port[1].length }
      : undefined
  return {
    ok: true,
    type: 'service',
    path: dir,
    suggested: { name: basename(dir), command, port: defaultPort, portSource }
  }
}

/** 从启动脚本提取执行行（S6：案例7 的 启动.command 里是 bun run serve.ts；行尾后台符 & 去掉） */
function extractLaunchCommand(file: string): string | undefined {
  try {
    const content = readFileSync(file, 'utf-8')
    for (const line of content.split('\n')) {
      const t = line.trim().replace(/\s*&+\s*$/, '')
      if (/\b(bun|deno)\s+(run\s+)?/.test(t)) return t
    }
  } catch {
    // 读不到就算了
  }
  return undefined
}

/** 从启动脚本里找端口（open http://localhost:N 或 localhost:N 字样，S6） */
function readScriptPort(file: string): number | undefined {
  try {
    const m = readFileSync(file, 'utf-8').match(/localhost:(\d{2,5})/)
    if (m) return Number(m[1])
  } catch {
    // 读不到就算了
  }
  return undefined
}

/** S6：bun/deno 静态服务（serve.ts/js + 启动脚本或源码 Bun.serve/Deno.serve 标记） */
function detectBunDeno(dir: string): DetectHint | null {
  const serve = ['serve.ts', 'serve.js'].find((f) => existsSync(join(dir, f)))
  if (!serve) return null
  const src = readFileSync(join(dir, serve), 'utf-8')
  const isBunSrv = src.includes('Bun.serve')
  const isDenoSrv = src.includes('Deno.serve')
  const launch = LAUNCH_SCRIPTS.find((f) => existsSync(join(dir, f)))
  if (!isBunSrv && !isDenoSrv && !launch) return null
  // 命令：优先从启动脚本提取执行行（原样执行），否则按标记猜
  const command =
    (launch ? extractLaunchCommand(join(dir, launch)) : undefined) ??
    (isDenoSrv ? `deno run --allow-net ${serve}` : `bun ${serve}`)
  // 端口：源码 Bun.serve/Deno.serve 写死优先，其次启动脚本里的 localhost:N
  const srcPort = src.match(/(?:Bun|Deno)\.serve\s*\(\s*\{\s*port\s*:\s*(\d{2,5})/)?.[1]
  const port = srcPort ? Number(srcPort) : launch ? readScriptPort(join(dir, launch)) : undefined
  return {
    ok: true,
    type: 'service',
    path: dir,
    suggested: { name: basename(dir), command, port }
  }
}

/** S7：只有启动脚本（没有 package.json/serve 源码）→ bash 执行脚本 */
function detectLaunchScript(dir: string): DetectHint | null {
  const launch = LAUNCH_SCRIPTS.find((f) => existsSync(join(dir, f)))
  if (!launch) return null
  return {
    ok: true,
    type: 'service',
    path: dir,
    suggested: {
      name: basename(dir),
      command: `bash "${launch}"`,
      port: readScriptPort(join(dir, launch))
    }
  }
}

/** （一个项目的全部启动方式清单。
 *  「成品预览」排最前为默认（用户心智：先看成品）；随后按确定性排列开发类方式 */
function buildLaunchModes(dir: string): LaunchMode[] {
  const modes: LaunchMode[] = []
  const distIndex = join(dir, 'dist', 'index.html')
  if (existsSync(distIndex)) {
    modes.push({ id: 'preview', kind: 'preview', label: '成品预览', staticRoot: join(dir, 'dist') })
  }
  if (existsSync(join(dir, 'package.json'))) {
    const guessed = guessCommand(dir)
    const rp = readPort(dir, guessed)
    modes.push({
      id: 'dev',
      kind: 'dev',
      label: '开发服务器',
      command: guessed?.command,
      port: rp?.port,
      portSource: rp?.source
    })
  }
  const python = detectPython(dir)
  if (python) {
    modes.push({
      id: 'python-dev',
      kind: 'dev',
      label: 'Python 后端',
      command: python.suggested.command,
      port: python.suggested.port,
      portSource: python.suggested.portSource
    })
  }
  const bunDeno = detectBunDeno(dir)
  if (bunDeno) {
    modes.push({
      id: 'bun',
      kind: 'dev',
      label: 'bun/deno 服务',
      command: bunDeno.suggested.command,
      port: bunDeno.suggested.port
    })
  }
  const launch = detectLaunchScript(dir)
  if (launch) {
    modes.push({
      id: 'launch',
      kind: 'dev',
      label: '启动脚本',
      command: launch.suggested.command,
      port: launch.suggested.port
    })
  }
  if (existsSync(join(dir, 'docker-compose.yml'))) {
    modes.push({ id: 'docker', kind: 'docker', label: 'Docker', command: 'docker compose up' })
  }
  // 有成品时附赠「真实 python 静态服务器」方式（内置为主+可切换真实命令，Windows 零依赖靠内置）
  // 必须带上 preview 的 staticRoot——不带则 python 去服务项目根（源码目录），打开「有动效没图片」（实测破案）
  const preview = modes.find((m) => m.kind === 'preview')
  if (preview) {
    modes.push({
      id: 'python-static',
      kind: 'python-static',
      label: 'python http.server',
      command: 'python3 -m http.server',
      staticRoot: preview.staticRoot
    })
  }
  // 什么都没有但能找到 html：兜底成单文件成品预览（老行为的 html 分支）
  if (modes.length === 0) {
    const entries = findHtmlEntries(dir).filter((rel) => {
      try {
        // 大文件不可能是模板壳，跳过读；壳（未构建的 Vite index.html）当入口必白屏，排除
        if (statSync(join(dir, rel)).size > 256 * 1024) return true
        return !isViteShell(readFileSync(join(dir, rel), 'utf-8'))
      } catch {
        return true
      }
    })
    if (entries.length > 0) {
      modes.push({
        id: 'preview',
        kind: 'preview',
        label: '成品预览',
        staticRoot: dir,
        entryPath: entries[0]
      })
    }
  }
  return modes
}

/** 一个目录的完整检测（S1 找到项目根后复用）：生成启动方式清单，preview 为默认类型。
 *  takenSlugs：本批已生成的 slug（多项目容器互查重） */
function detectDirAsProject(dir: string, takenSlugs?: Set<string>): DetectSuccess | null {
  const modes = buildLaunchModes(dir)
  if (modes.length === 0) return null
  const primary = modes[0]
  const isWeb = primary.kind === 'preview'
  // 标题/文件数从 preview 静态根读（弹窗显示标题+默认勾最大成品）
  const preview = modes.find((m) => m.kind === 'preview')
  const indexFile = preview?.staticRoot ? join(preview.staticRoot, 'index.html') : null
  // 全部网页入口清单（多页面项目登记时展示、登记后都能打开）
  const entries = preview?.staticRoot ? findHtmlEntries(preview.staticRoot) : []
  // 统一入口路由名：已登记项目的 slug + 本批已生成的，全部避让
  const slugSet = takenSlugs ?? new Set<string>()
  for (const p of listProjects()) if (p.lanSlug) slugSet.add(p.lanSlug)
  const name = basename(dir)
  const lanSlug = makeLanSlug(name, slugSet)
  slugSet.add(lanSlug)
  return {
    ok: true,
    type: isWeb ? 'web' : 'service',
    path: dir,
    suggested: {
      name,
      command: primary.command,
      port: primary.port,
      portSource: modes.find((m) => m.portSource)?.portSource,
      entryPath: primary.entryPath ?? entries[0],
      entryPaths: entries.length > 1 ? entries : undefined,
      title: indexFile && existsSync(indexFile) ? readTitle(indexFile) : undefined,
      fileCount: preview?.staticRoot ? countFiles(preview.staticRoot) : undefined,
      launchModes: modes,
      activeMode: primary.id,
      lanSlug,
      lanSuspicious: scanJsRootPaths(dir)
    }
  }
}

/** S2：多项目容器——每个项目根走完整检测（合并成一条+多启动方式）+ 根层散装 html 候选，过滤掉已登记的 */
function detectMulti(dir: string, roots: string[]): DetectOutcome {
  const slugSet = new Set<string>()
  for (const p of listProjects()) if (p.lanSlug) slugSet.add(p.lanSlug)
  const projects = roots
    .map((r) => detectDirAsProject(r, slugSet))
    .filter((x): x is DetectSuccess => x !== null)
  // 根层散装 html（不进子目录——子目录可能属于上面的项目）
  try {
    for (const name of readdirSync(dir)) {
      const ext = extname(name).toLowerCase()
      if (ext !== '.html' && ext !== '.htm') continue
      const full = join(dir, name)
      const projName = basename(name, ext)
      const lanSlug = makeLanSlug(projName, slugSet)
      slugSet.add(lanSlug)
      projects.push({
        ok: true,
        type: 'web',
        path: full,
        suggested: {
          name: projName,
          entryPath: `/${name}`,
          title: readTitle(full),
          fileCount: 1,
          launchModes: [
            {
              id: 'preview',
              kind: 'preview',
              label: '成品预览',
              staticRoot: dir,
              entryPath: `/${name}`
            }
          ],
          activeMode: 'preview',
          lanSlug,
          lanSuspicious: safeScanFile(full)
        }
      })
    }
  } catch {
    // 读不了就算了
  }
  // 排序：含成品预览的在前，内部按 fileCount 降序（最大的成品排第一行，默认勾选它）
  projects.sort((a, b) => {
    const ap = a.suggested.launchModes.some((m) => m.kind === 'preview')
    const bp = b.suggested.launchModes.some((m) => m.kind === 'preview')
    if (ap !== bp) return ap ? -1 : 1
    return (b.suggested.fileCount ?? 0) - (a.suggested.fileCount ?? 0)
  })
  const registered = new Set(listProjects().map((proj) => resolve(proj.path)))
  // 已登记的候选不静默过滤：标记出来让弹窗显示「已存在」并禁勾（2026-09-01 用户拍板，
  // 之前静默消失让用户以为识别漏了文件）
  for (const pr of projects) {
    if (registered.has(resolve(pr.path))) pr.alreadyRegistered = true
  }
  if (projects.every((pr) => pr.alreadyRegistered)) {
    return { ok: false, kind: 'duplicate', name: basename(dir) }
  }
  return { ok: true, kind: 'multi', path: dir, projects }
}

/** 统一入口路由名（方案一 IP+路径）：中文转全拼、保留英文数字、其余清掉、重名加后缀。
 *  稳定优先：一次生成后持久化，改名不改 slug（访客书签不失效） */
export function makeLanSlug(name: string, taken: Set<string>): string {
  let base = name
    .trim()
    .toLowerCase()
    .replace(/[一-龥]+/g, (c) => pinyin(c, { toneType: 'none', type: 'array' }).join(' '))
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
  if (!base) base = 'app'
  let slug = base
  let i = 2
  while (taken.has(slug)) slug = `${base}-${i++}`
  return slug
}

/** 扫描文本里的 JS 根路径特征（location 跳转 / fetch API / WebSocket 写死根）。
 *  命中 = 挂子路径必断的暗病；误报代价只是少统一入口便利，宁可错杀 */
const ROOT_PATH_PATTERNS = [
  /(?:location\.(?:href|assign|replace)\s*=|window\.location\s*=)\s*['"`]\//,
  /window\.open\s*\(\s*['"`]\//,
  /fetch\(\s*['"`]\//,
  /axios\s*\.\s*(?:get|post|put|patch|delete|request)\s*\(\s*['"`]\//,
  /\.open\(\s*['"`](?:GET|POST|PUT|DELETE)['"`]\s*,\s*['"`]\//,
  /new\s+WebSocket\s*\(\s*['"`](?:ws|\/)/,
  // EventSource 独立模式：URL 是 /api/... 开头，不能和 WebSocket 共用 ws 前缀模式
  /new\s+EventSource\s*\(\s*['"`]\//,
  /new\s+Worker\s*\(\s*['"`]\//,
  /(?:navigator\.)?serviceWorker\s*\.\s*register\s*\(\s*['"`]\//,
  // 动态导入根路径：import('/assets/chunk.js') 懒加载子页面——重写器救不了 JS 内部，子路径下必 404
  /import\s*\(\s*['"`]\//,
  // origin 拼接根路径：location.origin + '/x'——统一入口下 origin 是网关地址，拼出来必落回根 404
  /\.origin\s*\+\s*['"`]\//,
  // SPA history 路由：子路径下 pathname 匹配不到路由 → 整页空白（HTTP 层一切正常，实测测不出；
  // pushState 是浏览器 API，压缩后保留；hash 路由不用它，不误伤）
  /(?:history\.)?(?:pushState|replaceState)\s*\(/
]

/** 扫一段文本（JS 源码/html 内嵌 script）：逐行匹配，跳过纯注释行（压缩 dist 无注释行，照常命中） */
export function scanText(text: string): boolean {
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('//')) continue
    if (ROOT_PATH_PATTERNS.some((re) => re.test(t))) return true
  }
  return false
}

/** 扫单个文件（html 内嵌 script 场景）：html 走 scanHtmlRoots（内联 script + importmap），
 *  其余按纯 JS 扫。读不到/读失败按不命中 */
function safeScanFile(file: string): boolean {
  try {
    const content = readFileSync(file, 'utf-8')
    return /\.html?$/i.test(file) ? scanHtmlRoots(content) : scanText(content)
  } catch {
    return false
  }
}

/** 扫 HTML 里的内联 <script>（服务端渲染盲区：挂载扫描只扫静态文件，后端渲染的 JS 藏在这里）
 *  + importmap：根路径说明符会让模块解析必断。命中 = 挂子路径必断 → direct */
export function scanHtmlRoots(html: string): boolean {
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? ''
    const body = m[2] ?? ''
    if (!body.trim()) continue
    if (/type\s*=\s*["']?importmap["']?/i.test(attrs)) {
      // importmap 是 JSON：键/值为根路径说明符（"/lib/x.js"）→ 模块解析必断
      if (/["']\/(?!\/)/.test(body)) return true
    } else if (scanText(body)) {
      return true
    }
  }
  return false
}

/** 收集目录里参与扫描的文件（JS 相关 + HTML）：上限 100 个，跳过 node_modules/.git。
 *  传单个文件（单 HTML 项目 path 就是文件）则直接收集该文件 */
function collectScanFiles(dir: string): string[] {
  const files: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 5 || files.length >= 100) return
    try {
      for (const name of readdirSync(d)) {
        const full = join(d, name)
        if (name === 'node_modules' || name === '.git') continue
        if (isDir(full)) {
          walk(full, depth + 1)
        } else if (/\.(js|ts|jsx|tsx|vue|mjs|cjs|html?)$/i.test(name)) {
          files.push(full)
        }
      }
    } catch {
      // 读不了的目录忽略
    }
  }
  try {
    if (isDir(dir)) walk(dir, 0)
    else if (/\.(js|ts|jsx|tsx|vue|mjs|cjs|html?)$/i.test(dir)) files.push(dir)
  } catch {
    // 读不了忽略
  }
  return files
}

/** 扫目录里的 JS 文件（拖入体检）：上限 100 个、单文件 2MB，跳过 node_modules/.git */
export function scanJsRootPaths(dir: string): boolean {
  for (const f of collectScanFiles(dir)) {
    try {
      if (statSync(f).size > 2 * 1024 * 1024) continue
      // js 按纯 JS 扫；html 走 scanHtmlRoots（内联 script + importmap 一起查）
      if (safeScanFile(f)) return true
    } catch {
      // 读不了跳过
    }
  }
  return false
}

/** 扫目录里写死本机 host:port 的链接（挂载预判 route-rewrite 用）：这类页面必须靠响应改写，
 *  访客点开才不会跳到自己电脑的端口。任意端口都算——挂载时其他项目可能还没登记。
 *  尾斜杠可省（裸写 http://127.0.0.1:5001 也算）；(?!\d) 防止端口数字被截断误配 */
export function scanLocalHostRefs(dir: string): boolean {
  const re = /http:\/\/(?:localhost|127\.0\.0\.1):\d+(?!\d)/g
  for (const f of collectScanFiles(dir)) {
    try {
      if (statSync(f).size > 2 * 1024 * 1024) continue
      if (re.test(readFileSync(f, 'utf-8'))) return true
    } catch {
      // 读不了跳过
    }
  }
  return false
}

/** 目录根层 ≥2 个 HTML 且没有含 HTML 的子目录 → 独立作品堆（根层平铺多个独立作品）。
 *  有子目录结构的（如 factory/integrator/cases 分区）是多页网站，不算 */
function isHtmlWorkspace(dir: string): boolean {
  let rootHtml = 0
  let subDirHtml = false
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (isDir(full)) {
        if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
        if (findHtml(full, 0) !== null) subDirHtml = true
      } else if (/\.html?$/i.test(name)) {
        rootHtml++
      }
    }
  } catch {
    return false
  }
  return rootHtml >= 2 && !subDirHtml
}

/** 目录里有没有 PHP 入口（下钻 2 层）——只为给出准确的「不支持」提示（需要 PHP 环境，非本产品范围） */
function hasPhpEntry(dir: string, depth = 0): boolean {
  if (depth > 2) return false
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (isDir(full)) {
        if (!name.startsWith('.') && !SKIP_DIRS.has(name) && hasPhpEntry(full, depth + 1))
          return true
      } else if (extname(name).toLowerCase() === '.php') {
        return true
      }
    }
  } catch {
    // 读不了按没有
  }
  return false
}

/** Vite/React 开发模板壳：body 只有挂载点、module 脚本指向 /src/ 的 index.html——
 *  未构建时直接预览必白屏。单文件拖入给提示；静态站兜底时排除它当入口 */
function isViteShell(content: string): boolean {
  return (
    content.includes('@vite/client') ||
    (/<div\s+id\s*=\s*["']root["']\s*><\/div>/i.test(content) &&
      /<script[^>]*type\s*=\s*["']module["'][^>]*src\s*=\s*["'][^"']*\/src\//i.test(content))
  )
}

/** 拖拽识别入口（PRD 3.2 的识别规则） */
export function detectPath(rawPath: string): DetectOutcome {
  const p = rawPath.trim()
  if (!existsSync(p)) {
    return { ok: false, kind: 'no-match', reason: '路径不存在' }
  }
  // .app：第一版不支持应用类型，先询问是否解析（PRD 3.2 兜底）
  if (p.endsWith('.app')) {
    return { ok: false, kind: 'unsupported-app', path: p }
  }
  if (isDir(p)) {
    const roots = findProjectRoots(p)
    // 多个项目根 → 多项目容器（S2）；1 个 → 以项目根登记（路径是项目根而非拖入文件夹，S1）
    if (roots.length >= 2) {
      return detectMulti(p, roots)
    }
    // 纯 HTML 独立作品堆（根层 ≥2 个 HTML、无含 HTML 的子目录）→ 组（2026-09-01 用户拍板；
    // detectMulti 的根层散装 html 收集正好把每个 HTML 收成子项目）
    if (roots.length === 0 && isHtmlWorkspace(p)) {
      return detectMulti(p, [])
    }
    const root = roots[0] ?? p
    const result = detectDirAsProject(root)
    if (!result) {
      return {
        ok: false,
        kind: 'no-match',
        reason: hasPhpEntry(root)
          ? 'PHP 项目暂不支持（需要 PHP 环境）'
          : '文件夹里没有 package.json 也没有 html 文件'
      }
    }
    return successOrDuplicate(root, result)
  }
  // 单个文件：html → 网页文件
  const ext = extname(p).toLowerCase()
  if (ext === '.php') {
    return { ok: false, kind: 'no-match', reason: 'PHP 项目暂不支持（需要 PHP 环境）' }
  }
  if (ext === '.html' || ext === '.htm') {
    const projName = basename(p, ext)
    // Vite 模板壳（未构建的 index.html）预览必白屏：提示拖整个项目文件夹
    try {
      if (isViteShell(readFileSync(p, 'utf-8'))) {
        return { ok: false, kind: 'no-match', reason: '这是 Vite 开发模板页，请拖入整个项目文件夹' }
      }
    } catch {
      // 读不了按不是壳
    }
    const slugSet = new Set<string>()
    for (const proj of listProjects()) if (proj.lanSlug) slugSet.add(proj.lanSlug)
    return successOrDuplicate(p, {
      ok: true,
      type: 'web',
      path: p,
      suggested: {
        name: projName,
        // 网站标题小字（单 html 拖入英文文件名难认，读 <title> 帮辨认）
        title: readTitle(p),
        launchModes: [{ id: 'preview', kind: 'preview', label: '成品预览' }],
        activeMode: 'preview',
        lanSlug: makeLanSlug(projName, slugSet),
        lanSuspicious: safeScanFile(p)
      }
    })
  }
  return { ok: false, kind: 'no-match', reason: '不认识的文件类型（只支持文件夹和 html 文件）' }
}

/** .app 解析：在应用包里找代码（PRD 3.2：是服务/网页包装器则转成对应类型） */
export function parseApp(appPath: string): DetectOutcome {
  const name = basename(appPath, '.app')
  const roots = [join(appPath, 'Contents/Resources/app'), join(appPath, 'Contents/Resources')]
  const slugSet = new Set<string>()
  for (const proj of listProjects()) if (proj.lanSlug) slugSet.add(proj.lanSlug)
  for (const root of roots) {
    if (!existsSync(root)) continue
    if (existsSync(join(root, 'package.json'))) {
      const guessed = guessCommand(root)
      const rp = readPort(root, guessed)
      const lanSlug = makeLanSlug(name, slugSet)
      slugSet.add(lanSlug)
      return successOrDuplicate(root, {
        ok: true,
        type: 'service',
        path: root,
        suggested: {
          name,
          command: guessed?.command,
          port: rp?.port,
          portSource: rp?.source,
          launchModes: [
            {
              id: 'dev',
              kind: 'dev',
              label: '开发服务器',
              command: guessed?.command,
              port: rp?.port,
              portSource: rp?.source
            }
          ],
          activeMode: 'dev',
          lanSlug,
          lanSuspicious: scanJsRootPaths(root)
        }
      })
    }
    const html = findHtml(root)
    if (html) {
      const lanSlug = makeLanSlug(name, slugSet)
      slugSet.add(lanSlug)
      return successOrDuplicate(root, {
        ok: true,
        type: 'web',
        path: root,
        suggested: {
          name,
          entryPath: toEntryPath(root, html),
          launchModes: [
            {
              id: 'preview',
              kind: 'preview',
              label: '成品预览',
              staticRoot: root,
              entryPath: toEntryPath(root, html)
            }
          ],
          activeMode: 'preview',
          lanSlug,
          lanSuspicious: scanJsRootPaths(root)
        }
      })
    }
  }
  return {
    ok: false,
    kind: 'no-match',
    reason: '在这个应用包里没找到能解析的代码（package.json 或 html 文件）'
  }
}
