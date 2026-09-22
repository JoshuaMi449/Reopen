const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const source = fs.readFileSync('src/renderer/src/components/TrayPanel.tsx', 'utf8')
const start = source.indexOf('function bucketHistory<')
const end = source.indexOf('/** System monitors', start)
const context = {}
vm.createContext(context)
vm.runInContext(ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
const base = 1800000000000
const history = Array.from({ length: 620 }, (_, i) => ({ time: base - 610000 + i * 1000, value: i % 17 }))
const average = items => ({ time: items[0].time, value: items.reduce((n, s) => n + s.value, 0) / items.length })
const draw = (end, minutes, count) => JSON.parse(JSON.stringify(context.bucketHistory(history, end, minutes, count, average)))
for (const [minutes, count, step] of [[10, 120, 5000], [0.5, 30, 1000]]) {
 const first = draw(base, minutes, count)
 assert.deepEqual(draw(base + step - 1, minutes, count), first, 'no changes before the next time boundary')
 const next = draw(base + step, minutes, count)
 assert.deepEqual(next.slice(0, -1), first.slice(1), 'completed columns shift exactly one slot without changing values')
 assert.equal(next.at(-1).time - first.at(-1).time, step)
}
console.log('PASS: five-second detail and one-second compact buckets stay fixed and advance one column')

const sparse = [{ time: base - 5 * 3600000, value: 10 }, { time: base - 1000, value: 20 }]
for (const minutes of [60, 360]) {
 const result = context.bucketHistory(sparse, base, minutes, 120, average)
 const empty = result.filter(b => b.time >= base - 50 * 60000 && b.time < base - 10 * 60000)
 assert(empty.length > 0)
 assert(empty.every(b => !b.value), 'missing observations stay missing across ranges')
}
console.log('PASS: one-hour and six-hour ranges preserve the same recording gap')

const bridgeStart = source.indexOf('function batteryBuckets(')
const bridgeEnd = source.indexOf('function averageSystem(', bridgeStart)
const bridgeContext = {}
vm.createContext(bridgeContext)
vm.runInContext(ts.transpileModule(source.slice(bridgeStart, bridgeEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, bridgeContext)
const battery = {time:base-3600000,percent:.8,plugged:true,charging:true}
const bridged = bridgeContext.batteryBuckets([
 {time:base-3600000,value:battery},
 {time:base-2700000},
 {time:base-1800000},
 {time:base-900000,value:{...battery,time:base-900000,percent:.9}}
])
assert(bridged.every(b=>b.value), 'battery state stays continuous through an internal recording gap')
assert.equal(bridged[1].value.percent,.8)
console.log('PASS: battery power state bridges internal recording gaps')
