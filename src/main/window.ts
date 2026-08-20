// 主窗口管理：创建、显示、关闭时最小化到托盘（PRD 3.6 通用设置）
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { getSettings } from './store'

let mainWindow: BrowserWindow | null = null
let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 700,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 关闭窗口 = 最小化到托盘（默认开，2026-08-20 拍板；⌘Q 走 before-quit 不拦截）
  mainWindow.on('close', (e) => {
    if (!quitting && getSettings().closeToTray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 显示主窗口（托盘面板"打开主窗口"、⌥+R 等调用；可附带菜单动作） */
export function showMainWindow(action?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  mainWindow?.show()
  mainWindow?.focus()
  if (action) {
    mainWindow?.webContents.send('app:menu-action', action)
  }
}
