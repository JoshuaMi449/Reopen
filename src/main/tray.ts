// 托盘模块：右上角菜单栏图标 + 点击弹出小面板（PRD 3.7）
import { app, BrowserWindow, Menu, nativeImage, Tray, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync } from 'fs'
import { extname, join } from 'path'
import { getSettings } from './store'
import { stopAllRuntimes } from './projectManager'
import { openSettingsWindow } from './settingsWindow'
import { markQuitConfirmed, showMainWindow } from './window'
import { loadGifFrames, type GifFrame } from './gifFrames'
import trayIconAsset from '../../resources/tray-icon.png?asset'

let tray: Tray | null = null
let panel: BrowserWindow | null = null
/** 动图轮播定时器（切到静态图标时清掉） */
let frameTimer: ReturnType<typeof setTimeout> | null = null
/** 正在轮播的帧序列（作为轮播循环的身份标识，防止换图后旧循环还活着） */
let activeFrames: GifFrame[] | null = null

/** 静态托盘图标：黑白=内置剪影转模板（系统自动随深浅色反转）；
 *  自定义=用户选的图片（复制在 userData，不反转；GIF 由轮播接管，这里只兜底第一帧）；统一缩放到 18px */
function staticTrayIcon(): Electron.NativeImage {
  const { trayIcon, trayIconPath, trayIconSize } = getSettings()
  const size = trayIconSize ?? 18
  let img: Electron.NativeImage
  if (trayIcon === 'custom' && trayIconPath && existsSync(trayIconPath)) {
    img = nativeImage.createFromPath(trayIconPath)
  } else {
    img = nativeImage.createFromPath(trayIconAsset)
  }
  const sized = img.resize({ width: size, height: size })
  if (trayIcon === 'mono') sized.setTemplateImage(true)
  return sized
}

function stopTrayAnimation(): void {
  if (frameTimer) clearTimeout(frameTimer)
  frameTimer = null
  activeFrames = null
}

/** 自定义图是 GIF → 解码成帧按各自时长循环换图（模拟动图）；否则挂静态图 */
function applyTrayIcon(): void {
  if (!tray) return
  const { trayIcon, trayIconPath, trayIconSpeed, trayIconSize } = getSettings()
  const isGif =
    trayIcon === 'custom' && !!trayIconPath && extname(trayIconPath).toLowerCase() === '.gif'
  if (isGif) {
    const frames = loadGifFrames(trayIconPath as string, trayIconSize ?? 18)
    if (frames) {
      stopTrayAnimation()
      activeFrames = frames
      const speed = trayIconSpeed ?? 1
      const step = (i: number): void => {
        if (activeFrames !== frames || !tray) return // 期间换图/关托盘了，旧循环作废
        tray.setImage(frames[i].image)
        // 速度倍率：delay / speed；下限 40ms 防倍速刷爆
        const d = Math.max(40, Math.round(frames[i].delay / speed))
        frameTimer = setTimeout(() => step((i + 1) % frames.length), d)
      }
      step(0)
      return
    }
  }
  stopTrayAnimation()
  tray.setImage(staticTrayIcon())
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

/** 右键菜单：打开主窗口 / 偏好设置 / 退出（验收整改） */
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
  const { trayEnabled } = getSettings()
  if (!trayEnabled) {
    tray?.destroy()
    tray = null
    panel?.destroy()
    panel = null
    return
  }
  if (!tray) {
    tray = new Tray(staticTrayIcon())
    tray.on('click', togglePanel)
    tray.on('right-click', showContextMenu)
  }
  applyTrayIcon()
}

/** 应用启动时创建托盘 */
export function initTray(): void {
  refreshTray()
}

/** 退出前清理 */
export function destroyTray(): void {
  stopTrayAnimation()
  tray?.destroy()
  tray = null
  panel?.destroy()
  panel = null
}

export function appQuit(): void {
  // 托盘右键「退出」是明确意图：跳过确认框直接退（⌘Q 才弹确认）；
  // 项目进程同样按「退出后项目继续运行」设置处理
  if (!getSettings().keepProjectsOnQuit) {
    stopAllRuntimes()
  }
  markQuitConfirmed()
  app.quit()
}
