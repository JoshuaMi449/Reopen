// 快捷键注册的回滚。
// 存在的意义：现在「先 unregisterAll 再注册」的写法，新键被占用时用户连旧键也一起丢了，且无感知。
// 这份测试保证：只要有一个键注册失败，整体就回到 previous。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-shortcut-plan-'))
fs.writeFileSync(
  path.join(temp, 'mod.cjs'),
  ts.transpileModule(fs.readFileSync('src/shared/shortcutPlan.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
)
const { registerWithRollback } = require(path.join(temp, 'mod.cjs'))

/** 假注册器：failOn 里的组合返回 false（模拟被别的软件占用） */
function makeRegistry(failOn = []) {
  let registered = []
  return {
    get registered() {
      return registered
    },
    register(acc) {
      if (failOn.includes(acc)) return false
      registered.push(acc)
      return true
    },
    unregisterAll() {
      registered = []
    }
  }
}

try {
  // 全部成功 → 生效，没有失败项
  const ok = makeRegistry()
  assert.deepEqual(registerWithRollback(['Alt+R', 'Alt+1'], [], ok), [])
  assert.deepEqual(ok.registered, ['Alt+R', 'Alt+1'])

  // 有一个失败 → 整体回滚到 previous（旧键必须还在）
  const clash = makeRegistry(['Alt+1'])
  assert.deepEqual(registerWithRollback(['Alt+R', 'Alt+1'], ['Alt+R'], clash), ['Alt+1'])
  assert.deepEqual(clash.registered, ['Alt+R'])

  // 重复组合只注册一次（主快捷键和项目快捷启动撞车时不能误报失败）
  const dup = makeRegistry()
  assert.deepEqual(registerWithRollback(['Alt+R', 'Alt+R'], [], dup), [])
  assert.deepEqual(dup.registered, ['Alt+R'])

  // 空组合跳过，不占用配额
  const empty = makeRegistry()
  assert.deepEqual(registerWithRollback(['', 'Alt+R'], [], empty), [])
  assert.deepEqual(empty.registered, ['Alt+R'])
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}

console.log('PASS: shortcut registration rolls back to previous bindings on any clash')
