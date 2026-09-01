// 统一入口实测状态机：启动实测 + 周期回测 + 漏网信号重测，自动判定 route / route-rewrite / direct
// 关键：验证必须走网关、解析"重写后"的正文——重写器只改 body，HEAD 拿不到 body，只能 GET→解析→HEAD 闭环
import type { LanMode } from '../shared/types'
import { gatewayFetch, gatewayHead, updateRouteMode } from './gateway'
import { scanHtmlRoots } from './detect'
import { getLanIp } from './lan'

/** 被测目标（项目运行中才有） */
export interface ProbeTarget {
  id: string
  name: string
  slug: string
  port: number
}

/** direct 项目的回测周期（升回 route 用；项目改配置/Reopen 更新规则后自动捞回） */
const RECHECK_INTERVAL_MS = 10 * 60 * 1000
/** 漏网信号防抖：30 秒内最多重测一轮 */
const LEAK_DEBOUNCE_MS = 30 * 1000
/** 内链爬取上限：超过只验首页（多页项目兜底，不穷举） */
const MAX_PAGES = 10
/** 每页资源验证上限 */
const MAX_ASSETS = 60

interface ProbeState {
  target: ProbeTarget
  probing: boolean
  timer: NodeJS.Timeout | null
}

const states = new Map<string, ProbeState>()
let leakTimer: NodeJS.Timeout | null = null
/** 漏网信号/回测触发的重测回调（projectManager 注入：找到项目 → probeNow） */
let recheckAll: (() => void) | null = null

export function setRecheckAll(fn: (() => void) | null): void {
  recheckAll = fn
}

function getState(id: string): ProbeState | undefined {
  return states.get(id)
}

/** 从 HTML 提取本地资源根路径（/ 开头、非 //、非 http(s)、非 data:；去 query/去重） */
function extractAssetPaths(html: string): string[] {
  const out = new Set<string>()
  const push = (p: string): void => {
    if (!p.startsWith('/') || p.startsWith('//')) return
    const clean = p.split('?')[0].split('#')[0]
    if (clean && clean !== '/') out.add(clean)
  }
  for (const m of html.matchAll(/(?:src|href|poster|data-src)=["']([^"']+)["']/g)) push(m[1])
  for (const m of html.matchAll(/srcset=["']([^"']+)["']/g)) {
    for (const token of m[1].split(',')) push(token.trim().split(/\s+/)[0])
  }
  for (const m of html.matchAll(/url\(\s*["']?([^)"']+)/g)) push(m[1])
  return [...out]
}

/** 从 HTML 提取同项目内链（相对路径或带 /rp/slug/ 前缀；排除外链/锚点） */
function extractInnerLinks(html: string, slug: string): string[] {
  const prefix = `/rp/${slug}`
  const out = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/g)) {
    const h = m[1].split('#')[0]
    if (!h || h.startsWith('http') || h.startsWith('//') || h.startsWith('mailto:')) continue
    if (h.startsWith('/')) {
      // 根路径内链（会被重写器加前缀）或已带前缀的
      if (h.startsWith(prefix)) out.add(h)
      else if (!h.startsWith('/rp/')) out.add(prefix + h)
      continue
    }
    out.add(`${prefix}/${h}`)
  }
  return [...out].slice(0, MAX_PAGES)
}

/** HTML 里写死本机主机+「已登记项目端口」的绝对 URL：route 模式下不重写，访客点开会跳到自己电脑的端口。
 *  端口范围=本项目 + 全部运行中项目（跨项目互链，重写器会映射到目标项目访客地址）；
 *  未知端口不触发（救不了，别白开重写器）。
 *  route 轮 body 原样 → 命中判失败 → 换 route-rewrite（重写器映射）；重写轮 body 已改写 → 不命中自然通过 */
function hasLocalHostUrl(html: string, selfPort: number): boolean {
  const ip = getLanIp()
  const hosts = ['localhost', '127\\.0\\.0\\.1']
  if (ip) hosts.push(ip.replace(/\./g, '\\.'))
  const knownPorts = new Set<number>([selfPort])
  for (const st of states.values()) knownPorts.add(st.target.port)
  const re = new RegExp(`http://(?:${hosts.join('|')}):(\\d+)/`, 'g')
  for (const m of html.matchAll(re)) {
    if (knownPorts.has(Number(m[1]))) return true
  }
  return false
}

/** 验一个页面：GET 走网关 → 解析实际返回 body 的资源 → HEAD 逐个验。全通返回 true。
 *  响应 HTML 的内联 script/importmap 有根路径 = 重写器救不了的 JS 内部盲区 → 直接判失败（宁降 direct） */
async function verifyPage(path: string, port: number): Promise<boolean> {
  const res = await gatewayFetch(path)
  if (!res || res.status >= 400 || !res.contentType.includes('text/html')) return false
  if (scanHtmlRoots(res.body)) return false
  if (hasLocalHostUrl(res.body, port)) return false
  const assets = extractAssetPaths(res.body).slice(0, MAX_ASSETS)
  if (assets.length === 0) return true
  for (const a of assets) {
    if (!(await gatewayHead(a))) return false
  }
  return true
}

/** 完整实测一轮：先按 route 验（无重写），失败开 route-rewrite 再验，还失败降 direct。
 *  验首页 + 爬内链（每页都过资源验证，堵"首页绿内页白"） */
async function probeOnce(target: ProbeTarget): Promise<'route' | 'route-rewrite' | 'direct'> {
  const base = `/rp/${target.slug}/`
  for (const mode of ['route', 'route-rewrite'] as const) {
    updateRouteMode(target.slug, mode)
    const homeOk = await verifyPage(base, target.port)
    if (homeOk) {
      const res = await gatewayFetch(base)
      if (res && res.status < 400) {
        const pages = extractInnerLinks(res.body, target.slug)
        let allOk = true
        for (const p of pages) {
          if (!(await verifyPage(p, target.port))) {
            allOk = false
            break
          }
        }
        if (allOk) return mode
      }
    }
  }
  return 'direct'
}

/** 实测一个项目并回调结果（重入保护：探测中再触发直接忽略） */
export async function probeNow(id: string, onChange: (mode: LanMode) => void): Promise<void> {
  const st = getState(id)
  if (!st || st.probing) return
  st.probing = true
  try {
    const mode = await probeOnce(st.target)
    updateRouteMode(st.target.slug, mode)
    onChange(mode)
    // direct 的项目排上周期回测（项目中途改好配置能自动升回）
    if (st.timer) clearInterval(st.timer)
    st.timer =
      mode === 'direct' ? setInterval(() => void probeNow(id, onChange), RECHECK_INTERVAL_MS) : null
  } finally {
    st.probing = false
  }
}

/** 登记被测目标（项目 running 且网关开着时调用；已存在则更新 port） */
export function registerTarget(target: ProbeTarget): void {
  const st = states.get(target.id)
  if (st) {
    st.target = target
    return
  }
  states.set(target.id, { target, probing: false, timer: null })
}

/** 摘除目标（项目停止）：清周期回测 */
export function unregisterTarget(id: string): void {
  const st = states.get(id)
  if (st?.timer) clearInterval(st.timer)
  states.delete(id)
}

/** 漏网信号（网关收到不属于任何项目的根路径请求）→ 防抖后重测全部挂载项目 */
export function scheduleLeakRecheck(): void {
  if (leakTimer) return
  leakTimer = setTimeout(() => {
    leakTimer = null
    recheckAll?.()
  }, LEAK_DEBOUNCE_MS)
}
