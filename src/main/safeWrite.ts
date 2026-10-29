// 安全落盘：原子写 + 按天备份。
// 原实现是 writeFileSync 直接覆盖 —— 写到一半崩溃/断电就是整份清单归零，且没有任何历史版本可回退。
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'

/** 原子写：先写 .tmp 再改名，进程中途退出不会留下半个 JSON */
export function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, file)
}

const backedUpOn = new Map<string, string>()

/** 按天备份：同一份文件每天最多留一份，超出 keep 份删最旧的。
 *  按天而不是按次，是因为启动项目会频繁写 projects.json，按次存会把「最近 10 份」在一次开机里挤光。 */
export function backupDaily(
  file: string,
  backupDir: string,
  keep = 10,
  today = new Date()
): void {
  if (!existsSync(file)) return
  const stamp = today.toISOString().slice(0, 10)
  if (backedUpOn.get(file) === stamp) return
  mkdirSync(backupDir, { recursive: true })
  const stem = basename(file).replace(/\.json$/, '')
  const dest = join(backupDir, `${stem}-${stamp}.json`)
  if (!existsSync(dest)) copyFileSync(file, dest)
  backedUpOn.set(file, stamp)
  // 文件名里带 YYYY-MM-DD，字典序就是时间序（不用 mtime：同一天内多份备份的 mtime 分辨不出先后）
  const all = readdirSync(backupDir)
    .filter((n) => n.startsWith(`${stem}-`) && n.endsWith('.json'))
    .sort()
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    rmSync(join(backupDir, old), { force: true })
  }
}
