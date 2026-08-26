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
import { listCharacters } from './trayCharacters'
import { getCpuUsage } from './cpuSampler'
import trayIconAsset from '../../resources/tray-icon.png?asset'

/** 黑白（主题）图标大小：菜单栏标准高度 */
const MONO_SIZE = 18
/** 自定义角色图标大小 */
const CUSTOM_SIZE = 22
/** CPU 低于此值视为空闲：动画休息静止（忙起来才跑） */
const REST_THRESHOLD = 0.05
/** 休息时的醒来检查间隔 */
const WAKE_CHECK_MS = 1000
/** 帧间隔下限（防刷爆菜单栏） */
const MIN_INTERVAL = 40

let tray: Tray | null = null
let panel: BrowserWindow | null = null
/** 动图轮播定时器（切到静态图标时清掉） */
let frameTimer: ReturnType<typeof setTimeout> | null = null
/** 正在轮播的帧序列（作为轮播循环的身份标识，防止换图后旧循环还活着） */
let activeFrames: GifFrame[] | null = null
/** 轮播方向（1=正向；-1=倒播，自动反转播放的乒乓用） */
let activeDir = 1

/** 静态托盘图标：主题=内置剪影转模板（系统自动随深浅色反转）；
 *  自定义=用户选的图片/动图第一帧（复制在 userData，不反转；GIF 由轮播接管，这里只兜底） */
function staticTrayIcon(): Electron.NativeImage {
  const { trayIcon, trayIconPath } = getSettings()
  let img: Electron.NativeImage
  let size: number
  if (trayIcon === 'custom' && trayIconPath && existsSync(trayIconPath)) {
    img = nativeImage.createFromPath(trayIconPath)
    size = CUSTOM_SIZE
  } else {
    img = nativeImage.createFromPath(trayIconAsset)
    size = MONO_SIZE
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

/** 自定义图是 GIF → 解码成帧循环换图（模拟动图）；否则挂静态图。
 *  帧间隔照抄参考实现的公式：开 CPU 变速=(1-CPU)/5×(1.1-只因速)，关=CPU/5×(1.1-只因速)，下限 40ms；
 *  自动反转播放=乒乓（播到末帧倒播回来）；cpuFollow 开且 CPU 空闲时休息静止，每秒醒来检查 */
function applyTrayIcon(): void {
  if (!tray) return
  const { trayIcon, trayIconPath, trayIconSpeed, cpuFollow, trayAutoReverse } = getSettings()
  const isGif =
    trayIcon === 'custom' && !!trayIconPath && extname(trayIconPath).toLowerCase() === '.gif'
  if (isGif) {
    // 模板素材角色（随菜单栏深浅自动变色）按角色属性转模板图
    const mono = listCharacters().find((c) => c.path === trayIconPath)?.mono
    const frames = loadGifFrames(trayIconPath as string, CUSTOM_SIZE, { mono })
    if (frames) {
      stopTrayAnimation()
      activeFrames = frames
      activeDir = 1
      const speed = trayIconSpeed ?? 0.5
      const step = (i: number): void => {
        if (activeFrames !== frames || !tray) return // 期间换图/关托盘了，旧循环作废
        tray.setImage(frames[i].image)
        const usage = getCpuUsage()
        if (cpuFollow && usage < REST_THRESHOLD) {
          // 空闲休息：停在当前帧，每秒检查是否忙起来
          frameTimer = setTimeout(() => wakeCheck(frames, i), WAKE_CHECK_MS)
          return
        }
        // 帧间隔（秒）：开=(1-CPU)/5×(1.1-只因速)；关=CPU/5×(1.1-只因速)
        const base = (cpuFollow ? 1.0001 - usage : usage) / 5
        const d = Math.max(MIN_INTERVAL, Math.round(base * (1.1 - speed) * 1000))
        // 乒乓反转：正向到头往回播、倒播到首帧再正向；关=单向循环
        let next = i + activeDir
        const last = frames.length - 1
        if (next > last) {
          if (trayAutoReverse && last > 0) {
            activeDir = -1
            next = last - 1
          } else {
            next = 0
          }
        } else if (next < 0) {
          activeDir = 1
          next = 1
        }
        frameTimer = setTimeout(() => step(next), d)
      }
      const wakeCheck = (frames: GifFrame[], i: number): void => {
        if (activeFrames !== frames || !tray) return
        if (cpuFollow && getCpuUsage() < REST_THRESHOLD) {
          frameTimer = setTimeout(() => wakeCheck(frames, i), WAKE_CHECK_MS)
        } else {
          step(i) // 忙起来了，从当前帧继续跑
        }
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
