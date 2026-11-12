// GitHub Releases 的 Atom 订阅源解析（检查更新用）。
// 为什么不打 api.github.com：未登录请求按出口 IP 限 60 次/小时，共享 IP 上很容易被别处
// 提前打光，检查更新就一路 403 还提示成"网络问题"（2026-11-12 用户遇到）。releases.atom
// 是给订阅器用的公开源，不受这个额度限制。
// 纯函数、零依赖：tests/release-feed.cjs 直接转译单测。

export interface ReleaseEntry {
  /** tag 去掉 v 前缀，如 1.4.1 */
  version: string
  /** 发布页链接 */
  htmlUrl: string
  /** Release 正文（HTML 已转成 markdown，渲染层 ReactMarkdown 直接用） */
  body?: string
}

const NAMED: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/** 解 HTML 实体（feed 里的正文是转义过的 HTML，先还原成真标签再转 markdown） */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      return String.fromCodePoint(code)
    }
    return NAMED[body.toLowerCase()] ?? match
  })
}

/** 行内标签 → markdown 记号，剩下的标签直接丢 */
function inline(html: string): string {
  return html
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
}

/** Release 正文 HTML → markdown。GitHub 只产出有限几种标签，逐个替换就够 */
export function htmlToMarkdown(html: string): string {
  const blocks: string[] = []
  let s = html.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    const code = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+$/, '')
    blocks.push('```\n' + code + '\n```')
    return `\n\n@@BLOCK${blocks.length - 1}@@\n\n`
  })
  s = s.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_m, level: string, text: string) =>
      `\n\n${'#'.repeat(Number(level))} ${inline(text).trim()}\n\n`
  )
  // 列表整块处理：逐条 <li> 替换会把源里的换行带进来，条目之间冒出空行
  s = s.replace(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag: string, inner: string) => {
    const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(
      (m) => `- ${inline(m[1]).trim()}`
    )
    return `\n\n${items.join('\n')}\n\n`
  })
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, text: string) => `\n\n${inline(text).trim()}\n\n`)
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
  s = inline(s)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return s.replace(/@@BLOCK(\d+)@@/g, (_m, i: string) => blocks[Number(i)] ?? '')
}

/** 解析 feed，取第一条（最新发布）；解析不出来返回 null */
export function parseReleaseFeed(xml: string): ReleaseEntry | null {
  const block = xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1]
  if (!block) return null
  const htmlUrl =
    block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i)?.[1] ??
    block.match(/<id>([\s\S]*?)<\/id>/i)?.[1] ??
    ''
  const version = (htmlUrl.split('/').pop() ?? '').replace(/^v/, '').trim()
  if (!/^\d+(\.\d+)*$/.test(version)) return null
  const raw = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ?? ''
  const body = htmlToMarkdown(decodeEntities(raw)).trim()
  return {
    version,
    htmlUrl: htmlUrl || `https://github.com/JoshuaMi449/Reopen/releases/tag/v${version}`,
    body: body || undefined
  }
}
