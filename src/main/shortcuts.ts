// 快捷键模块：全局唤起窗口 + 项目快捷启动（PRD 3.6 快捷键组）
// 注册策略：要么全部生效，要么整体回滚到上一次的绑定 —— 新键被别的软件占用时，
// 用户至少还留着旧键可用，并且设置页会收到失败清单。
import { globalShortcut } from 'electron'
import { startProject } from './projectManager'
import { getSettings } from './store'
import { toggleMainWindow } from './window'
import { registerWithRollback } from '../shared/shortcutPlan'

/** 上次成功注册的组合（失败时回滚到这一组） */
let applied: string[] = []
/** 上次注册失败的组合（设置页保存后查询） */
let failures: string[] = []

export function getShortcutFailures(): string[] {
  return failures
}

/** 注册全部快捷键（应用启动时 + 设置变化时调用）；返回失败的组合 */
export function refreshShortcuts(): string[] {
  const s = getSettings()
  const actions = new Map<string, () => void>()
  if (s.hotkey) actions.set(s.hotkey, () => toggleMainWindow())
  for (const [id, acc] of Object.entries(s.quickLaunch)) {
    // 和唤起窗口撞车时以唤起窗口为准（唤起是常驻刚需，快捷启动是可选）
    if (!acc || actions.has(acc)) continue
    actions.set(acc, () => {
      void startProject(id)
    })
  }
  const desired = [...actions.keys()]
  failures = registerWithRollback(desired, applied, {
    register: (acc) => {
      const run = actions.get(acc)
      return run ? globalShortcut.register(acc, run) : false
    },
    unregisterAll: () => globalShortcut.unregisterAll()
  })
  if (failures.length === 0) applied = desired
  return failures
}
