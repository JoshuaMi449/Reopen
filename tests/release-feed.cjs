// 检查更新改用 releases.atom 后的解析规则。
// 存在的意义：atom 里正文是「转义过的 HTML」，渲染层要的是 markdown；解析错了会
// 让更新弹窗里出现一堆 <h2> 原始标签。api.github.com 按 IP 限 60 次/小时，共享出口
// 上会被打光（2026-11-12 用户遇到 403），所以这条链路不能再回退到 API。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-release-feed-'))
fs.writeFileSync(
  path.join(temp, 'mod.cjs'),
  ts.transpileModule(fs.readFileSync('src/shared/releaseFeed.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
)
const { parseReleaseFeed, decodeEntities, htmlToMarkdown } = require(path.join(temp, 'mod.cjs'))

// 取自真实 feed 的结构：两条 entry，新的在前
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release notes from Reopen</title>
  <entry>
    <id>tag:github.com,2008:Repository/1339272970/v1.4.1</id>
    <link rel="alternate" type="text/html" href="https://github.com/JoshuaMi449/Reopen/releases/tag/v1.4.1"/>
    <title>Reopen v1.4.1</title>
    <content type="html">&lt;h2&gt;拖入时的同名提醒&lt;/h2&gt;
&lt;p&gt;旧版只比对&lt;strong&gt;绝对路径&lt;/strong&gt;，查不出来。&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;单项目拖入 → 弹窗顶部显示同名项目&lt;/li&gt;
&lt;li&gt;勾选 &lt;code&gt;index.html&lt;/code&gt; 默认全不勾&lt;/li&gt;
&lt;/ul&gt;</content>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1339272970/v1.4.0</id>
    <link rel="alternate" type="text/html" href="https://github.com/JoshuaMi449/Reopen/releases/tag/v1.4.0"/>
    <title>Reopen v1.4.0</title>
    <content type="html">&lt;p&gt;旧版本&lt;/p&gt;</content>
  </entry>
</feed>`

// 1) 取最新一条（第一条），tag 去 v
const entry = parseReleaseFeed(FEED)
assert.equal(entry.version, '1.4.1')
assert.equal(entry.htmlUrl, 'https://github.com/JoshuaMi449/Reopen/releases/tag/v1.4.1')

// 2) 正文从转义 HTML 转成 markdown：标题/加粗/列表/行内代码都要对
assert.equal(
  entry.body,
  [
    '## 拖入时的同名提醒',
    '',
    '旧版只比对**绝对路径**，查不出来。',
    '',
    '- 单项目拖入 → 弹窗顶部显示同名项目',
    '- 勾选 `index.html` 默认全不勾'
  ].join('\n')
)

// 3) 实体解码：命名 + 十进制 + 十六进制
assert.equal(decodeEntities('a &lt; b &amp;&amp; c &gt; d'), 'a < b && c > d')
assert.equal(decodeEntities('&#39;q&#39; &#x27;w&#x27;'), "'q' 'w'")
assert.equal(decodeEntities('&unknown;'), '&unknown;')

// 4) 代码块保留缩进、不参与行内替换
assert.equal(
  htmlToMarkdown('<pre><code>npm run build\n  --mac</code></pre>'),
  '```\nnpm run build\n  --mac\n```'
)

// 5) 链接转 markdown
assert.equal(
  htmlToMarkdown('<p>见<a href="https://example.com/x">发布页</a></p>'),
  '见[发布页](https://example.com/x)'
)

// 6) 空正文 → body 为 undefined（弹窗显示「暂无发布说明」）
assert.equal(parseReleaseFeed('<feed><entry><link rel="alternate" href="https://x/tag/v9.9.9"/><content type="html"></content></entry></feed>').body, undefined)

// 7) 解析不出来返回 null：没有 entry / tag 不是版本号
assert.equal(parseReleaseFeed('<feed></feed>'), null)
assert.equal(
  parseReleaseFeed('<feed><entry><link rel="alternate" href="https://x/tag/nightly"/></entry></feed>'),
  null
)

console.log('PASS: releases.atom 解析（最新取首条 / HTML 转 markdown / 实体解码 / 异常兜底）')
