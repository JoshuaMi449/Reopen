// 拖拽识别模块：判断拖进来的是什么、猜表单预填（PRD 3.2 全自动猜）
// 2026-08-21 识别增强（docs/03）：S1 下钻找项目根 / S2 多项目容器 / S4 框架端口匹配脚本内容 /
// S5 Python / S6 bun·deno / S7 启动脚本 / S9 隐藏根不跳过
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { basename, extname, join, resolve } from 'path'
import type { DetectOutcome, DetectSuccess } from '../shared/types'
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

/** 浅层找 html 文件（最多下钻 2 层，跳过隐藏目录和 SKIP_DIRS） */
function findHtml(dir: string, depth = 0): string | null {
  if (depth > 2) return null
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

/** 绝对路径 → 相对文件夹的入口路径（如 /supos-case-anjia.html；S3 entryPath） */
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

/** 第 1 层：入口源码写死的端口（listen(3459) / PORT || 3459），最确定 */
function readSourcePort(dir: string): number | undefined {
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
      if (lm) return Number(lm[1])
      // 端口常带引号（process.env.PORT || '3001'），加可选引号匹配
      const em = src.match(/process\.env\.PORT\s*\|\|\s*['"]?(\d{2,5})/)
      if (em) return Number(em[1])
    }
  } catch {
    // 读不到就算了
  }
  return undefined
}

/** 第 2 层：环境变量文件里的 PORT=3459 */
function readEnvPort(dir: string): number | undefined {
  for (const f of ['.env', '.env.local', '.env.development', '.env.dev', '.env.production']) {
    try {
      const content = readFileSync(join(dir, f), 'utf-8')
      const m = content.match(/^PORT\s*=\s*(\d{2,5})/m)
      if (m) return Number(m[1])
    } catch {
      // 没有这个文件就算了
    }
  }
  return undefined
}

/** 第 3 层：框架配置文件（vite.config / webpack.config 里的 server.port、devServer.port） */
function readConfigPort(dir: string): number | undefined {
  try {
    for (const name of readdirSync(dir)) {
      if (!/^(vite|webpack)\.config\.(js|ts|mjs|cjs)$/.test(name)) continue
      const content = readFileSync(join(dir, name), 'utf-8')
      const m =
        content.match(/(?:server|devServer)\s*:\s*\{[^}]*?port\s*:\s*(\d{2,5})/) ??
        content.match(/port\s*:\s*(\d{2,5})/)
      if (m) return Number(m[1])
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

/** 从项目读端口：按确定性从高到低；四层都读不到返回 undefined（表单留空请用户填，不瞎猜） */
function readPort(
  dir: string,
  guessed: { command: string; script: string } | undefined
): number | undefined {
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
  // 4. 框架默认端口（按脚本内容）
  return defaultPortFromScript(guessed.script)
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

/** S5：Python 项目（requirements.txt + 入口 py）。端口读源码 app.run/uvicorn.run 的 port，读不到按框架默认 */
function detectPython(dir: string): DetectSuccess | null {
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
  return {
    ok: true,
    type: 'service',
    path: dir,
    suggested: { name: basename(dir), command, port: defaultPort }
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
function detectBunDeno(dir: string): DetectSuccess | null {
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
function detectLaunchScript(dir: string): DetectSuccess | null {
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

/** 一个目录的完整检测（S1 找到项目根后复用）：package.json → Python → bun/deno → 启动脚本 → html */
function detectDirAsProject(dir: string): DetectSuccess | null {
  if (existsSync(join(dir, 'package.json'))) {
    const guessed = guessCommand(dir)
    return {
      ok: true,
      type: 'service',
      path: dir,
      suggested: { name: basename(dir), command: guessed?.command, port: readPort(dir, guessed) }
    }
  }
  const python = detectPython(dir)
  if (python) return python
  const bunDeno = detectBunDeno(dir)
  if (bunDeno) return bunDeno
  const launch = detectLaunchScript(dir)
  if (launch) return launch
  const html = findHtml(dir)
  if (html) {
    return {
      ok: true,
      type: 'web',
      path: dir,
      suggested: { name: basename(dir), entryPath: toEntryPath(dir, html) }
    }
  }
  return null
}

/** S2：多项目容器——每个项目根走完整检测 + 根层散装 html 候选，过滤掉已登记的 */
function detectMulti(dir: string, roots: string[]): DetectOutcome {
  const projects = roots
    .map((r) => detectDirAsProject(r))
    .filter((x): x is DetectSuccess => x !== null)
  // 根层散装 html（不进子目录——子目录可能属于上面的项目）
  try {
    for (const name of readdirSync(dir)) {
      const ext = extname(name).toLowerCase()
      if (ext !== '.html' && ext !== '.htm') continue
      projects.push({
        ok: true,
        type: 'web',
        path: join(dir, name),
        suggested: { name: basename(name, ext), entryPath: `/${name}` }
      })
    }
  } catch {
    // 读不了就算了
  }
  const registered = new Set(listProjects().map((proj) => resolve(proj.path)))
  const fresh = projects.filter((pr) => !registered.has(resolve(pr.path)))
  if (fresh.length === 0) {
    return { ok: false, kind: 'duplicate', name: basename(dir) }
  }
  return { ok: true, kind: 'multi', path: dir, projects: fresh }
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
    const root = roots[0] ?? p
    const result = detectDirAsProject(root)
    if (!result) {
      return {
        ok: false,
        kind: 'no-match',
        reason: '文件夹里没有 package.json 也没有 html 文件'
      }
    }
    return successOrDuplicate(root, result)
  }
  // 单个文件：html → 网页文件
  const ext = extname(p).toLowerCase()
  if (ext === '.html' || ext === '.htm') {
    return successOrDuplicate(p, {
      ok: true,
      type: 'web',
      path: p,
      suggested: { name: basename(p, ext) }
    })
  }
  return { ok: false, kind: 'no-match', reason: '不认识的文件类型（只支持文件夹和 html 文件）' }
}

/** .app 解析：在应用包里找代码（PRD 3.2：是服务/网页包装器则转成对应类型） */
export function parseApp(appPath: string): DetectOutcome {
  const name = basename(appPath, '.app')
  const roots = [join(appPath, 'Contents/Resources/app'), join(appPath, 'Contents/Resources')]
  for (const root of roots) {
    if (!existsSync(root)) continue
    if (existsSync(join(root, 'package.json'))) {
      const guessed = guessCommand(root)
      return successOrDuplicate(root, {
        ok: true,
        type: 'service',
        path: root,
        suggested: { name, command: guessed?.command, port: readPort(root, guessed) }
      })
    }
    const html = findHtml(root)
    if (html) {
      return successOrDuplicate(root, {
        ok: true,
        type: 'web',
        path: root,
        suggested: { name, entryPath: toEntryPath(root, html) }
      })
    }
  }
  return {
    ok: false,
    kind: 'no-match',
    reason: '在这个应用包里没找到能解析的代码（package.json 或 html 文件）'
  }
}
