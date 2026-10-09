const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')

const source = fs.readFileSync('src/renderer/src/components/TrayPanel.tsx', 'utf8')
const start = source.indexOf('function appendSavedHistory(')
const end = source.indexOf('interface HistoryBucket<T>', start)
assert(start > 0 && end > start, 'history merge helpers found in source')
const context = {}
vm.createContext(context)
vm.runInContext(
  ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText,
  context
)
const { appendSavedHistory, historyTimeline } = context
// vm 里造出来的数组原型属于另一个 realm，deepStrictEqual 会比原型——JSON 往返拉回本 realm。
const times = (list) => JSON.parse(JSON.stringify(list.map((s) => s.time)))

const base = 1800000000000
const at = (time) => ({ time })

// 存档是 30 秒分辨率，实时窗口是 1 秒分辨率；实时窗口与存档尾部重叠。
const saved = [at(base - 60000), at(base - 30000)]
const live = [at(base - 30000), at(base - 1000), at(base)]

assert.deepEqual(
  times(historyTimeline(saved, live)),
  [base - 60000, base - 30000, base - 1000, base],
  'live samples overlapping the archive are dropped'
)
assert.deepEqual(
  times(historyTimeline(saved, undefined)),
  [base - 60000, base - 30000],
  'no live window still yields the archive'
)

// 增量并入：新样本追加，重复送达不产生重复项。
const grown = appendSavedHistory(saved, [at(base + 30000)])
assert.deepEqual(times(grown), [base - 60000, base - 30000, base + 30000])
assert.equal(appendSavedHistory(grown, [at(base + 30000)]), grown, 'resending a known sample is a no-op')
assert.equal(appendSavedHistory(grown, []), grown, 'empty tail keeps the same array')
assert.equal(appendSavedHistory(grown, undefined), grown, 'absent tail keeps the same array')
assert.deepEqual(
  times(appendSavedHistory(saved, [at(base - 30000), at(base + 30000), at(base + 60000)])),
  [base - 60000, base - 30000, base + 30000, base + 60000],
  'mixed known/new tail only appends the new ones'
)

// 增量补进来之后，实时窗口里那一段不能再重复出现。
const afterGrow = appendSavedHistory(saved, [at(base + 30000)])
assert.deepEqual(
  times(historyTimeline(afterGrow, [at(base - 1000), at(base), at(base + 45000)])),
  [base - 60000, base - 30000, base + 30000, base + 45000],
  'samples now covered by the archive are dropped from the live tail'
)

// 空存档（首次运行）：时间线就是实时窗口本身。
assert.deepEqual(times(historyTimeline([], live)), times(live))
assert.equal(appendSavedHistory([], undefined).length, 0)

console.log('PASS: history archive merges incrementally without duplicates or gaps')

// 防回归：每秒推送的那条路径绝不能带上整段存档（曾导致渲染进程主线程 50% 时间卡死）。
const tray = fs.readFileSync('src/main/tray.ts', 'utf8')
const streamStart = tray.indexOf('function systemInfoStream(')
const feedStart = tray.indexOf('function startSystemInfoFeed(', streamStart)
assert(streamStart > 0 && feedStart > streamStart, 'tray feed functions found in source')
const stream = tray.slice(streamStart, feedStart)
const feed = tray.slice(feedStart, tray.indexOf('\n}', feedStart))
assert(!/systemHistory\s*:/.test(stream), 'the per-second payload must not carry the 30-day archive')
assert(/liveHistory/.test(stream) && /savedTail/.test(stream), 'the per-second payload carries live window + archive delta')
assert(/systemInfoStream\(\)/.test(feed), 'the periodic feed uses the incremental payload')
console.log('PASS: the per-second tray payload stays incremental')
