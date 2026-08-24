// 托盘模块：右上角菜单栏图标 + 点击弹出小面板（PRD 3.7）
import { app, BrowserWindow, Menu, nativeImage, Tray, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import { getSettings } from './store'
import { openSettingsWindow } from './settingsWindow'
import { showMainWindow } from './window'
import trayIconAsset from '../../resources/tray-icon.png?asset'

let tray: Tray | null = null
let panel: BrowserWindow | null = null

/** 托盘图标：2026-08-24 用户提供的正式菜单栏图标（纯白剪影，mono 模板模式自动适配深浅色顶栏） */
function trayIconImage(mono: boolean): Electron.NativeImage {
  const img = nativeImage.createFromPath(trayIconAsset).resize({ width: 18, height: 18 })
  if (mono) img.setTemplateImage(true)
  return img
}

function createPanel(): BrowserWindow {
  panel = new BrowserWindow({
    width: 300,
    height: 400,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  panel.on('blur', () => panel?.hide())
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    panel.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/tray.html`)
  } else {
    panel.loadFile(join(__dirname, '../renderer/tray.html'))
  }
  return panel
}

function togglePanel(): void {
  if (!panel || panel.isDestroyed()) createPanel()
  const p = panel
  if (!p) return
  if (p.isVisible()) {
    p.hide()
    return
  }
  // 面板定位在托盘图标下方
  const bounds = tray?.getBounds()
  const winBounds = p.getBounds()
  const display = screen.getDisplayNearestPoint(
    bounds ? { x: bounds.x, y: bounds.y } : screen.getCursorScreenPoint()
  )
  const { workArea } = display
  let x = bounds
    ? Math.round(bounds.x + bounds.width / 2 - winBounds.width / 2)
    : workArea.x + workArea.width - winBounds.width - 8
  let y = bounds ? bounds.y + bounds.height + 6 : 30
  x = Math.min(Math.max(x, workArea.x + 4), workArea.x + workArea.width - winBounds.width - 4)
  if (y + winBounds.height > workArea.y + workArea.height) {
    y = (bounds ? bounds.y : workArea.y + workArea.height) - winBounds.height - 6
  }
  p.setPosition(x, y)
  p.show()
}

/** 右键菜单：打开主窗口 / 偏好设置 / 退出（2026-08-20 验收整改） */
function showContextMenu(): void {
  const menu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => showMainWindow() },
    { label: '偏好设置…', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: '退出 Reopen', click: () => appQuit() }
  ])
  tray?.popUpContextMenu(menu)
}

/** 按设置刷新托盘（启用开关/图标样式变化时调用） */
export function refreshTray(): void {
  const { trayEnabled, trayIcon } = getSettings()
  if (!trayEnabled) {
    tray?.destroy()
    tray = null
    panel?.destroy()
    panel = null
    return
  }
  if (!tray) {
    tray = new Tray(trayIconImage(trayIcon === 'mono'))
    tray.on('click', togglePanel)
    tray.on('right-click', showContextMenu)
  } else {
    tray.setImage(trayIconImage(trayIcon === 'mono'))
  }
}

/** 应用启动时创建托盘 */
export function initTray(): void {
  refreshTray()
}

/** 退出前清理 */
export function destroyTray(): void {
  tray?.destroy()
  tray = null
  panel?.destroy()
  panel = null
}

export function appQuit(): void {
  app.quit()
}
