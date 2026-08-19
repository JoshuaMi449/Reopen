// 拖拽识别模块：判断拖进来的是什么、猜表单预填（PRD 3.2 全自动猜）
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import type { DetectOutcome } from '../shared/types'

// 服务启动命令猜的优先级：常见开发脚本名
const SCRIPT_CANDIDATES = ['dev', 'start', 'serve', 'dev:app', 'dev:server', 'web']

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
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

/** 根据启动命令猜端口（猜错用户可在表单改，健康检查基于此端口） */
function guessPort(command: string | undefined): number | undefined {
  if (!command) return undefined
  const c = command.toLowerCase()
  if (c.includes('vite')) return 5173
  if (c.includes('next')) return 3000
  if (c.includes('astro')) return 4321
  if (c.includes('umi')) return 8000
  return 3000
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
      return {
        ok: true,
        type: 'service',
        path: p,
        suggested: { name: basename(p), command, port: guessPort(command) }
      }
    }
    if (findHtml(p)) {
      return { ok: true, type: 'web', path: p, suggested: { name: basename(p) } }
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
    return { ok: true, type: 'web', path: p, suggested: { name: basename(p, ext) } }
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
      return {
        ok: true,
        type: 'service',
        path: root,
        suggested: { name, command, port: guessPort(command) }
      }
    }
    if (findHtml(root)) {
      return { ok: true, type: 'web', path: root, suggested: { name } }
    }
  }
  return {
    ok: false,
    kind: 'no-match',
    reason: '在这个应用包里没找到能解析的代码（package.json 或 html 文件）'
  }
}
