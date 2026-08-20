// 主窗口管理：创建、显示、关闭时最小化到托盘（PRD 3.6 通用设置）
import { BrowserWindow, screen, shell } from 'electron'
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
  // 默认尺寸按主屏工作区 55% 宽、16:10 比例（2026-08-20 拍板：默认再宽一点，比例=电脑屏幕比例）
  const { workArea } = screen.getPrimaryDisplay()
  const winWidth = Math.min(Math.max(Math.round(workArea.width * 0.55), 1200), 2000)
  const winHeight = Math.round(winWidth * 0.625)

  mainWindow = new BrowserWindow({
    // 三栏布局默认宽度（2026-08-20 拍板：左 190 + 右 380 固定，中间弹性；窗口可调）
    width: winWidth,
    height: winHeight,
    // 最小宽度动态调整：卡片一排 3 个（无右栏 940）；打开日志右栏再加 400（渲染层按需调，2026-08-20 拍板）
    minWidth: 940,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    // macOS 隐藏标题栏：红黄绿按钮浮在内容上，没有深色黑边（2026-08-20 用户反馈）
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
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

/** 动态最小宽度：右栏（日志）开合时渲染层调用（2026-08-20 拍板：保证卡片一排 3 个） */
export function setMinWidth(width: number): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setMinimumSize(width, 620)
  }
}

/** 全局快捷键：窗口可见且聚焦 → 隐藏；否则唤起（PRD 3.6 全局唤起窗口） */
export function toggleMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
    return
  }
  showMainWindow()
}
