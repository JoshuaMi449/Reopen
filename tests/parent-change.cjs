// 项目进出文件夹时，置顶/手动排序/自启三份清单的一致性。
// 存在的意义：「移入文件夹」「移出文件夹」「批量移入」三个入口都走这一个函数，
// 以后新增入口不会各自漏掉某份清单。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

// 转译到临时目录再 require（同一 realm，assert.deepStrictEqual 才比得准）
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-parent-change-'))
fs.writeFileSync(
  path.join(temp, 'mod.cjs'),
  ts.transpileModule(fs.readFileSync('src/shared/parentChange.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
)
const { applyParentChange } = require(path.join(temp, 'mod.cjs'))

const base = {
  pinnedIds: ['a', 'b', 'c'],
  manualOrder: ['c', 'a', 'b'],
  autoStartIds: ['b']
}

try {
  // 移入文件夹：置顶与手动排序里的残留都清掉；自启项保留（自启和「显不显示在顶层」无关）
  assert.deepEqual(applyParentChange(['a', 'c'], 'g1', base), {
    pinnedIds: ['b'],
    manualOrder: ['b'],
    autoStartIds: ['b']
  })

  // 移出到顶层：三份清单都不动（进组时清掉的置顶不自动恢复，避免用户意外）
  assert.deepEqual(applyParentChange(['a'], undefined, base), base)

  // 空选择不产生改动
  assert.deepEqual(applyParentChange([], 'g1', base), base)

  // 只清指定 id，别的项目原样保留
  assert.deepEqual(
    applyParentChange(['y'], 'g1', {
      pinnedIds: ['x', 'y'],
      manualOrder: ['y', 'x'],
      autoStartIds: ['x', 'y']
    }),
    { pinnedIds: ['x'], manualOrder: ['x'], autoStartIds: ['x', 'y'] }
  )
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}

console.log('PASS: parent change keeps pinned/order/autostart lists consistent')
