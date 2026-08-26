// 托盘模块：右上角菜单栏图标 + 点击弹出小面板（PRD 3.7）
import { app, BrowserWindow, Menu, nativeImage, Tray, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync } from 'fs'
import { extname, join } from 'path'
import { getSettings, saveSettings } from './store'
import { stopAllRuntimes } from './projectManager'
import { openSettingsWindow } from './settingsWindow'
import { markQuitConfirmed, showMainWindow } from './window'
import { loadGifFrames, invalidateGifCache, type GifFrame } from './gifFrames'
import { listCharacters, type TrayCharacter } from './trayCharacters'
import { getCpuUsage } from './cpuSampler'
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

/** 自定义图是 GIF → 解码成帧按各自时长循环换图（模拟动图）；否则挂静态图。
 *  变速两档：基准倍率（设置滑杆）× CPU 因子（cpuFollow 开时 CPU 忙跑得快、空闲跑得慢，不只因同款） */
function applyTrayIcon(): void {
  if (!tray) return
  const {
    trayIcon,
    trayIconPath,
    trayIconSpeed,
    trayIconSize,
    cpuFollow,
    trayAutoReverse,
    trayMonoGif
  } = getSettings()
  const isGif =
    trayIcon === 'custom' && !!trayIconPath && extname(trayIconPath).toLowerCase() === '.gif'
  if (isGif) {
    const frames = loadGifFrames(trayIconPath as string, trayIconSize ?? 18, {
      mirror: trayAutoReverse,
      mono: trayMonoGif
    })
    if (frames) {
      stopTrayAnimation()
      activeFrames = frames
      const speed = trayIconSpeed ?? 1
      const step = (i: number): void => {
        if (activeFrames !== frames || !tray) return // 期间换图/关托盘了，旧循环作废
        tray.setImage(frames[i].image)
        // CPU 因子：空闲 0.5×（放慢）→ 满载 2.5×（加速）；采样有 2s 缓存，每帧调不费电
        const cpuFactor = cpuFollow ? 0.5 + getCpuUsage() * 2 : 1
        const d = Math.max(40, Math.round(frames[i].delay / (speed * cpuFactor)))
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

/** 角色菜单缩略图：GIF 取第一帧缩到 16px（菜单里只是认个脸，不用整段解码） */
function characterMenuIcon(path: string): Electron.NativeImage | undefined {
  try {
    return nativeImage.createFromPath(path).resize({ width: 16, height: 16 })
  } catch {
    return undefined
  }
}

/** 点选一个角色：清旧帧缓存 → 记入设置（样式切到自定义）→ 立即换图标 */
function selectCharacter(c: TrayCharacter): void {
  invalidateGifCache()
  saveSettings({ trayIcon: 'custom', trayIconPath: c.path })
  refreshTray()
}

/** 左键点击托盘：弹出角色下拉菜单（不只因同款——角色平铺可选，下面跟常用功能） */
function showCharacterMenu(): void {
  const { trayIconPath } = getSettings()
  const items: Electron.MenuItemConstructorOptions[] = listCharacters().map((c) => ({
    label: c.label,
    type: 'checkbox' as const,
    checked: trayIconPath === c.path,
    icon: characterMenuIcon(c.path),
    click: () => selectCharacter(c)
  }))
  const menu = Menu.buildFromTemplate([
    ...items,
    { type: 'separator' },
    { label: '项目面板…', click: () => togglePanel() },
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
    tray.on('click', showCharacterMenu)
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
