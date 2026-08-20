// 托盘模块：右上角菜单栏图标 + 点击弹出小面板（PRD 3.7）
import { app, BrowserWindow, nativeImage, Tray, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import { getSettings } from './store'

let tray: Tray | null = null
let panel: BrowserWindow | null = null

/** 托盘图标：lucide Zap 的 SVG 转模板图（黑白自动适配深色顶栏）或彩色 */
function trayIconImage(mono: boolean): Electron.NativeImage {
  const color = mono ? '#000000' : '#c9a89e'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>`
  const img = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  )
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
