// 偏好设置窗口：独立窗口（Proma 式，2026-08-20 用户拍板），单例
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
    width: 760,
    height: 560,
    show: false,
    title: '偏好设置',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
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
