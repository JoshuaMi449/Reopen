// 拖拽识别模块：判断拖进来的是什么、猜表单预填（PRD 3.2 全自动猜）
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { basename, extname, join, resolve } from 'path'
import type { DetectOutcome, DetectSuccess } from '../shared/types'
import { listProjects } from './store'

// 服务启动命令猜的优先级：常见开发脚本名
const SCRIPT_CANDIDATES = ['dev', 'start', 'serve', 'dev:app', 'dev:server', 'web']

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

/** 浅层找 html 文件（最多下钻 2 层，跳过 node_modules 和隐藏目录） */
function findHtml(dir: string, depth = 0): string | null {
  if (depth > 2) return null
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const ext = extname(name).toLowerCase()
      if (ext === '.html' || ext === '.htm') return full
      if (isDir(full) && !name.startsWith('.') && name !== 'node_modules') {
        const hit = findHtml(full, depth + 1)
        if (hit) return hit
      }
    }
  } catch {
    // 无权限/无法读取的目录忽略
  }
  return null
}

/** 在 package.json scripts 里猜启动命令 */
function guessCommand(dir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
    const scripts: Record<string, string> = pkg.scripts ?? {}
    for (const name of SCRIPT_CANDIDATES) {
      if (scripts[name]) return `npm run ${name}`
    }
    const first = Object.keys(scripts)[0]
    if (first) return `npm run ${first}`
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
        /(?:node|tsx|ts-node|bun)\s+(?:--[A-Za-z0-9-]+\s+)*([\w./-]+\.(?:js|ts|mjs|cjs))/
      )
      const entry = m?.[1]
      if (!entry) continue
      const src = readFileSync(join(dir, entry), 'utf-8')
      const lm = src.match(/listen\(\s*(\d{2,5})/) ?? src.match(/listen\(\s*\n\s*(\d{2,5})/)
      if (lm) return Number(lm[1])
      const em = src.match(/process\.env\.PORT\s*\|\|\s*(\d{2,5})/)
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

/** 从项目读端口：按确定性从高到低；四层都读不到返回 undefined（表单留空请用户填，不瞎猜） */
function readPort(dir: string, command: string | undefined): number | undefined {
  if (!command) return undefined
  // 1. 源码写死
  const srcPort = readSourcePort(dir)
  if (srcPort) return srcPort
  // 2. 环境变量文件
  const envPort = readEnvPort(dir)
  if (envPort) return envPort
  // 3. 框架配置文件
  const cfgPort = readConfigPort(dir)
  if (cfgPort) return cfgPort
  // 4. 框架默认端口
  const c = command.toLowerCase()
  if (c.includes('vite')) return 5173
  if (c.includes('next')) return 3000
  if (c.includes('astro')) return 4321
  if (c.includes('umi')) return 8000
  return undefined
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
    // 文件夹：含 package.json → 本地服务；含 html 文件 → 网页文件
    if (existsSync(join(p, 'package.json'))) {
      const command = guessCommand(p)
      return successOrDuplicate(p, {
        ok: true,
        type: 'service',
        path: p,
        suggested: { name: basename(p), command, port: readPort(p, command) }
      })
    }
    if (findHtml(p)) {
      return successOrDuplicate(p, {
        ok: true,
        type: 'web',
        path: p,
        suggested: { name: basename(p) }
      })
    }
    return {
      ok: false,
      kind: 'no-match',
      reason: '文件夹里没有 package.json 也没有 html 文件'
    }
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
      const command = guessCommand(root)
      return successOrDuplicate(root, {
        ok: true,
        type: 'service',
        path: root,
        suggested: { name, command, port: readPort(root, command) }
      })
    }
    if (findHtml(root)) {
      return successOrDuplicate(root, { ok: true, type: 'web', path: root, suggested: { name } })
    }
  }
  return {
    ok: false,
    kind: 'no-match',
    reason: '在这个应用包里没找到能解析的代码（package.json 或 html 文件）'
  }
}
