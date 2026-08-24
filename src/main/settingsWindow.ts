// 偏好设置窗口：独立窗口（Proma 式，2026-08-20 用户拍板），单例
// 2026-08-24 拍板：无红黄绿按钮（titleBarStyle hidden，右上角自定义 ✕）、始终置顶、点主窗口即关闭
import { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'

let settingsWin: BrowserWindow | null = null

export function openSettingsWindow(group?: string): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
    if (group) settingsWin.webContents.send('app:menu-action', `settings-group-${group}`)
    return
  }
  settingsWin = new BrowserWindow({
    width: 720,
    height: 540,
    show: false,
    title: '偏好设置',
    // 置顶：设置打开就一直显示在画面最上方（2026-08-24 拍板）
    alwaysOnTop: true,
    // 完全隐藏系统标题栏（无红黄绿），标题栏和右上角叉由页面自绘（2026-08-24 拍板，与 Proma 一致）
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  settingsWin.on('ready-to-show', () => settingsWin?.show())
  settingsWin.on('closed', () => {
    settingsWin = null
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings.html`)
  } else {
    settingsWin.loadFile(join(__dirname, '../renderer/settings.html'))
  }
}

/** 关闭设置窗口（页面右上角 ✕；点击主窗口时也走这里，2026-08-24 拍板） */
export function closeSettingsWindow(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.close()
    settingsWin = null
  }
}
