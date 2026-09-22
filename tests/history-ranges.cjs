const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript')
const context = {exports:{}}
vm.createContext(context)
vm.runInContext(ts.transpileModule(fs.readFileSync('src/shared/historyRanges.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context)
const {HISTORY_COLUMNS,HISTORY_RANGES,historyColumns,normalizeHistoryRange,SYSTEM_HISTORY_DAYS}=context.exports
assert.equal(HISTORY_COLUMNS,120)
assert.equal(SYSTEM_HISTORY_DAYS,30)
const durations = [5000,30000,90000,180000,360000,720000,2160000,5040000,10080000,21600000]
for (const kind of ['cpu','network','memory']) {
 assert.deepEqual(Array.from(HISTORY_RANGES[kind],m=>m*60000/historyColumns(m)),[...durations.slice(0,5),900000,...durations.slice(6)])
 assert.equal(normalizeHistoryRange(kind,40320),43200)
}
assert.equal(historyColumns(1440),96)
assert.equal(1440*60000/historyColumns(1440),15*60000)
assert.equal(historyColumns(43200),120)
assert.deepEqual(Array.from(HISTORY_RANGES.battery,m=>m*60000/historyColumns(m)),[...durations.slice(1,5),900000,...durations.slice(6,8)])
assert.equal(normalizeHistoryRange('battery',40320),60)
console.log('PASS: one-day uses 96 quarter-hour columns; other ranges retain their fixed cadence')
