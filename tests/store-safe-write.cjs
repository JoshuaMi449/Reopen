// 资料库落盘的安全性：原子写 + 按天备份 + 保留份数。
// 存在的意义：原实现是 writeFileSync 直接覆盖，写一半崩溃就是整份清单归零，且没有历史版本。
// 这份测试保证：写不会留半截文件；备份每天最多一份、只留最近 keep 份。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-safe-write-'))
fs.writeFileSync(
  path.join(temp, 'safeWrite.cjs'),
  ts.transpileModule(fs.readFileSync('src/main/safeWrite.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
)
const { writeJsonAtomic, backupDaily } = require(path.join(temp, 'safeWrite.cjs'))

const file = path.join(temp, 'projects.json')
const backups = path.join(temp, 'backups')

try {
  // 原子写：内容可读，临时文件不残留
  writeJsonAtomic(file, [{ id: 'a' }])
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [{ id: 'a' }])
  assert(!fs.existsSync(`${file}.tmp`), 'temporary file must not survive the rename')

  // 源文件不存在时不做备份
  backupDaily(path.join(temp, 'missing.json'), backups)
  assert(!fs.existsSync(backups))

  // 首次备份：留下当天一份，内容是备份那一刻的旧内容
  writeJsonAtomic(file, [{ id: 'b' }])
  backupDaily(file, backups, 10, new Date('2026-10-26T10:00:00Z'))
  const day1 = path.join(backups, 'projects-2026-10-26.json')
  assert.deepEqual(JSON.parse(fs.readFileSync(day1, 'utf8')), [{ id: 'b' }])

  // 同一天再写：不覆盖当天已有的备份
  writeJsonAtomic(file, [{ id: 'c' }])
  backupDaily(file, backups, 10, new Date('2026-10-26T18:00:00Z'))
  assert.deepEqual(JSON.parse(fs.readFileSync(day1, 'utf8')), [{ id: 'b' }])

  // 跨 12 天：连同已有的 10-26 共 13 份，keep=10 → 只留最近的 10 份
  for (let d = 1; d <= 12; d++) {
    const day = String(d).padStart(2, '0')
    backupDaily(file, backups, 10, new Date(`2026-09-${day}T10:00:00Z`))
  }
  const kept = fs.readdirSync(backups).sort()
  assert.equal(kept.length, 10)
  assert.equal(kept[0], 'projects-2026-09-04.json')
  assert.equal(kept.at(-1), 'projects-2026-10-26.json')
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}

console.log('PASS: atomic write and daily backups keep the library recoverable')
