// 快捷键模块：全局唤起窗口 + 项目快捷启动（PRD 3.6 快捷键组）
import { globalShortcut } from 'electron'
import { startProject } from './projectManager'
import { getSettings } from './store'
import { toggleMainWindow } from './window'

/** 注册全部快捷键（应用启动时 + 设置变化时调用） */
export function refreshShortcuts(): void {
  globalShortcut.unregisterAll()
  const s = getSettings()
  // 全局唤起窗口（默认 ⌥+R）
  try {
    globalShortcut.register(s.hotkey, () => toggleMainWindow())
  } catch {
    // 注册失败（被其他软件占用）就静默跳过
  }
  // 项目快捷启动（用户自定义绑定）
  for (const [id, acc] of Object.entries(s.quickLaunch)) {
    try {
      globalShortcut.register(acc, () => {
        startProject(id)
      })
    } catch {
      // 同上
    }
  }
}
