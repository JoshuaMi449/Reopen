// 托盘模块：右上角菜单栏图标 + 点击弹出小面板（PRD 3.7）
// 动画=SwiftUI 视图 + Swift 内部 .common Timer 换帧（参照业界 SwiftUI 实现，三图标对比
// 实验定稿：只有 SwiftUI 管线能获得系统「非活跃屏冻结最后一帧」托管，NSImageView 换图/
// 图层动画/button.image 换图全都不行）。JS 只负责解码帧序列与 CPU 变速间隔。
import { app, BrowserWindow, Menu, nativeImage, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import type { BatteryHistorySample, SystemHistorySample, SystemInfo } from '../shared/types'
import type { MenubarColors } from '../shared/menubarTheme'
import { basename, extname, join } from 'path'
import { pathToFileURL } from 'url'
import { getSettings } from './store'
import { HISTORY_RANGES, SYSTEM_HISTORY_DAYS, type HistoryKind } from '../shared/historyRanges'
import { stopAllRuntimes } from './projectManager'
import { getMainWindow, hideMainWindow, markQuitConfirmed } from './window'
import { loadGifFrames } from './gifFrames'
import { invertOf, isBoxRole } from './trayCharacters'
import { getCpuUsage } from './cpuSampler'
import {
  nativeCreateStatusItem,
  nativeInitTrayRunner,
  nativeSetFrames,
  nativeSetInterval,
  nativeSetInvert,
  nativeSetFlip,
  nativeSetCpuTemperature,
  nativeGetCpuTemperature,
  nativeGetFrame,
  nativeSetPanelBehavior,
  nativeStartGlobalClickMonitor,
  nativeStopGlobalClickMonitor,
  nativeDestroyStatusItem,
  nativeGetSystemInfo
} from './nativeAddon'
import trayIconAsset from '../../resources/tray-icon.png?asset'

/** 黑白（主题）图标大小：菜单栏标准高度 */
const MONO_SIZE = 18
/** 角色图标默认高度 22pt（44px@2x）：素材按体系规格（历史 f6f8b32「固定22px」），宽度随原比例 */
const DEFAULT_CUSTOM_SIZE = 22
/** 个别角色特例：dogeza（日本人磕头）按 18pt 显示规格（素材高 36px 按 2x） */
const ROLE_SIZES: Record<string, number> = { dogeza: 18 }

/** 按角色拿显示高度（pt）：dogeza=18pt；其余=22pt */
function roleSize(path: string): number {
  const requested = getSettings().trayIconSize ?? DEFAULT_CUSTOM_SIZE
  const scale = Math.max(14, Math.min(30, requested)) / DEFAULT_CUSTOM_SIZE
  return (ROLE_SIZES[basename(path, extname(path))] ?? DEFAULT_CUSTOM_SIZE) * scale
}
/** 帧间隔下限（防刷爆菜单栏） */
const MIN_INTERVAL = 40

let panel: BrowserWindow | null = null
let nativeCreated = false
/** CPU 变速定时器（每 2s 采样一次，把换帧间隔传给 Swift 侧 Timer） */
let cpuTimer: ReturnType<typeof setTimeout> | null = null
/** 菜单栏 CPU 温度定时器（与动图 CPU 变速互不依赖） */
let cpuTemperatureTimer: ReturnType<typeof setTimeout> | null = null
/** 系统信息采样定时器（面板打开期间每 2s 推送一次；业界通行面板默认 5s，我们更实时） */
let sysTimer: ReturnType<typeof setInterval> | null = null

/** 等比缩放到高度=size、宽度随原比例（图标高度统一、宽度随素材；
 *  保留原比例——菜单栏图标不拉正方形，396×337 这类非正方形硬拉 1:1 会压扁变形） */
function fitHeight(img: Electron.NativeImage, size: number): Electron.NativeImage {
  const { width, height } = img.getSize()
  if (width <= 0 || height <= 0) return img
  const scale = size / height
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  if (w === width && h === height) return img
  return img.resize({ width: w, height: h })
}

/** 静态托盘图标（2x 像素 PNG + 模板标记）：主题=内置黑白剪影转模板（系统随每屏菜单栏
 *  外观着色）；自定义=用户选的图片/动图第一帧（原图直传，剪影角色的颜色反转由 Swift 侧
 *  colorInvert 处理，2026-08-28 定稿；GIF 走逐帧换图循环，不走这里） */
function staticTrayIconPng(): { png: Buffer; template: boolean } {
  const { trayIcon, trayIconPath } = getSettings()
  let img: Electron.NativeImage
  let size: number
  if (trayIcon === 'custom' && trayIconPath && existsSync(trayIconPath)) {
    img = nativeImage.createFromPath(trayIconPath)
    size = roleSize(trayIconPath)
  } else {
    img = nativeImage.createFromPath(trayIconAsset)
    size = MONO_SIZE
  }
  // 2x 像素（如 44px 高）：addon 端 NSImage 尺寸减半为 pt，Retina 不糊
  const sized = fitHeight(img, size * 2)
  if (trayIcon === 'mono') sized.setTemplateImage(true)
  return { png: sized.toPNG(), template: trayIcon === 'mono' }
}

/** 当前帧间隔（ms）：
 *   速度正比 CPU 开=（1-CPU）/5×(1.1-速度)（CPU 越高换帧越快）；
 *   关=自由速度，只由滑杆决定（0=400ms 慢速 → 1=40ms 快速，下限 40ms 防刷爆菜单栏）。
 *   换帧本身由 Swift 侧 .common Timer 驱动，JS 只周期性把间隔传给 Swift。 */
function frameInterval(): number {
  const { trayIconSpeed, cpuFollow } = getSettings()
  const speed = trayIconSpeed ?? 0.5
  if (!cpuFollow) {
    return Math.max(MIN_INTERVAL, Math.round((1 - speed) * 360 + 40))
  }
  const usage = getCpuUsage()
  return Math.max(MIN_INTERVAL, Math.round(((1.0001 - usage) / 5) * (1.1 - speed) * 1000))
}

/** CPU 变速：每 2s 采样（cpuSampler 内部缓存窗口同为 2s），把换帧间隔传给 Swift 侧 Timer */
function startCpuFollow(): void {
  stopCpuFollow()
  const tick = (): void => {
    nativeSetInterval(frameInterval())
    cpuTimer = setTimeout(tick, 2000)
  }
  tick()
}

function stopCpuFollow(): void {
  if (cpuTimer) clearTimeout(cpuTimer)
  cpuTimer = null
}

function stopCpuTemperature(): void {
  if (cpuTemperatureTimer) clearTimeout(cpuTemperatureTimer)
  cpuTemperatureTimer = null
}

/** CPU 温度每秒更新；关闭开关时立即收回菜单栏占用宽度。 */
function syncCpuTemperature(): void {
  stopCpuTemperature()
  if (!getSettings().trayCpuTemperature) {
    nativeSetCpuTemperature(0, false)
    return
  }
  const tick = (): void => {
    if (!nativeCreated || !getSettings().trayCpuTemperature) {
      nativeSetCpuTemperature(0, false)
      cpuTemperatureTimer = null
      return
    }
    nativeSetCpuTemperature(nativeGetCpuTemperature(), true)
    cpuTemperatureTimer = setTimeout(tick, 1000)
  }
  tick()
}

const BATTERY_WINDOW = 7 * 24 * 60 * 60 * 1000
const SYSTEM_HISTORY_WINDOW = SYSTEM_HISTORY_DAYS * 24 * 60 * 60 * 1000
let batteryHistory: BatteryHistorySample[] = []
let batteryTimer: ReturnType<typeof setInterval> | null = null
let systemHistory: SystemHistorySample[] = []
let liveSystemHistory: SystemHistorySample[] = []
let latestSystemInfo: SystemInfo | null = null
let lastSystemHistoryWrite = 0
const PANEL_COMPACT_WIDTH = 320
const HISTORY_PANEL_WIDTH = 392
const HISTORY_PANEL_HEIGHT = 196
const HISTORY_PANEL_GAP = 8
let historyPanel: BrowserWindow | null = null
let menubarColorsPreview: MenubarColors | null = null
let menubarPreviewActive = false
let menubarPreviewKind: HistoryKind | null = null

/** 拖动色板时更新现有图形窗口；新打开的面板会收到最后一次预览。 */
export function previewMenubarColors(colors: MenubarColors | null, requestedKind?: string | null): void {
  menubarColorsPreview = colors
  for (const win of [panel, historyPanel])
    if (win && !win.isDestroyed()) win.webContents.send('menubar:colors-preview', colors)
  if (!colors) {
    menubarPreviewActive = false
    menubarPreviewKind = null
    closeHistoryPanel(false)
    if (panel && !panel.isDestroyed() && panel.isVisible()) panel.hide()
    return
  }
  if (!getSettings().trayEnabled) return
  menubarPreviewActive = true
  const kind: HistoryKind | null =
    requestedKind === 'cpu' || requestedKind === 'memory' ||
    requestedKind === 'battery' || requestedKind === 'network' ? requestedKind : null
  if (!panel || panel.isDestroyed()) createPanel()
  const previewPanel = panel
  if (!previewPanel) return
  if (!previewPanel.isVisible()) {
    positionPanel(previewPanel)
    previewPanel.showInactive()
  }
  const needsHistory = kind !== menubarPreviewKind || (kind !== null && (!historyPanel || historyPanel.isDestroyed()))
  menubarPreviewKind = kind
  if (!kind) {
    closeHistoryPanel(false)
  } else if (needsHistory) {
    const openHistory = (): void => {
      if (menubarPreviewActive && menubarPreviewKind === kind &&
          panel === previewPanel && previewPanel.isVisible())
        setTrayHistoryExpanded(true, kind)
    }
    if (previewPanel.webContents.isLoadingMainFrame())
      previewPanel.webContents.once('did-finish-load', openHistory)
    else openHistory()
  }
}
let historyRangeMenuOpen = false
let historyHoverTimer: ReturnType<typeof setInterval> | null = null

function positionPanel(p: BrowserWindow): void {
  const f = nativeGetFrame()
  const bounds = p.getBounds()
  const display = screen.getDisplayNearestPoint(
    f.w > 0 ? { x: f.x, y: f.y } : screen.getCursorScreenPoint()
  )
  const { workArea } = display
  let x =
    f.w > 0
      ? Math.round(f.x + f.w / 2 - bounds.width / 2)
      : workArea.x + workArea.width - bounds.width - 8
  let y = f.w > 0 ? f.y + f.h + 6 : 30
  x = Math.min(Math.max(x, workArea.x + 4), workArea.x + workArea.width - bounds.width - 4)
  if (y + bounds.height > workArea.y + workArea.height)
    y = (f.w > 0 ? f.y : workArea.y + workArea.height) - bounds.height - 6
  p.setPosition(x, y)
}

function pointInside(bounds: Electron.Rectangle, point: Electron.Point): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  )
}

function closeHistoryPanel(notify = true): void {
  if (historyHoverTimer) clearInterval(historyHoverTimer)
  historyHoverTimer = null
  const old = historyPanel
  historyPanel = null
  if (old && !old.isDestroyed()) old.destroy()
  if (notify && panel && !panel.isDestroyed()) panel.webContents.send('tray:history-closed')
}

function positionHistoryPanel(history: BrowserWindow): void {
  if (!panel || panel.isDestroyed()) return
  const anchor = panel.getBounds()
  const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y })
  let x = anchor.x - history.getBounds().width - HISTORY_PANEL_GAP
  if (x < display.workArea.x + 4) x = anchor.x + anchor.width + HISTORY_PANEL_GAP
  const y = Math.max(
    display.workArea.y + 4,
    Math.min(anchor.y + 10, display.workArea.y + display.workArea.height - history.getBounds().height - 4)
  )
  history.setPosition(x, y)
}

/** Native range menu participates in the history interaction until it closes. */
export function showHistoryRangeMenu(kind: string, selected: number): Promise<number | null> {
  const window = historyPanel
  if (!window || window.isDestroyed() || historyRangeMenuOpen) return Promise.resolve(null)
  const ranges = HISTORY_RANGES[kind as HistoryKind] ?? HISTORY_RANGES.cpu
  historyRangeMenuOpen = true
  return new Promise((resolve) => {
    let result: number | null = null
    const menu = Menu.buildFromTemplate(ranges.map((minutes) => ({
      label: minutes < 60 ? `${minutes} 分钟` : minutes < 1440 ? `${minutes / 60} 小时` : `${minutes / 1440} 天`,
      type: 'radio' as const,
      checked: minutes === selected,
      click: () => { result = minutes }
    })))
    menu.popup({ window, x: window.getBounds().width - 88, y: 12, callback: () => {
      historyRangeMenuOpen = false
      if (historyPanel && !historyPanel.isDestroyed()) startHistoryHoverMonitor()
      resolve(result)
    } })
  })
}

function startHistoryHoverMonitor(): void {
  if (historyHoverTimer) clearInterval(historyHoverTimer)
  let outsideSince = 0
  historyHoverTimer = setInterval(() => {
    if (menubarPreviewActive) return
    if (!panel || panel.isDestroyed() || !historyPanel || historyPanel.isDestroyed()) {
      closeHistoryPanel()
      return
    }
    if (historyRangeMenuOpen) { outsideSince = 0; return }
    const point = screen.getCursorScreenPoint()
    const mainBounds = panel.getBounds()
    const historyBounds = historyPanel.getBounds()
    const bridge = {
      x: Math.min(mainBounds.x, historyBounds.x),
      y: Math.max(mainBounds.y, historyBounds.y),
      width:
        Math.max(mainBounds.x + mainBounds.width, historyBounds.x + historyBounds.width) -
        Math.min(mainBounds.x, historyBounds.x),
      height:
        Math.min(mainBounds.y + mainBounds.height, historyBounds.y + historyBounds.height) -
        Math.max(mainBounds.y, historyBounds.y)
    }
    if (
      pointInside(mainBounds, point) ||
      pointInside(historyBounds, point) ||
      (bridge.height > 0 && pointInside(bridge, point))
    ) {
      outsideSince = 0
      return
    }
    if (!outsideSince) outsideSince = Date.now()
    if (Date.now() - outsideSince >= 180) closeHistoryPanel()
  }, 80)
}

/** 创建一个只包住图表的独立浮窗；主菜单窗口尺寸始终保持不变。 */
export function setTrayHistoryExpanded(expanded: boolean, kind = 'cpu'): void {
  if (!expanded && menubarPreviewActive) return
  if (!expanded || !panel || panel.isDestroyed() || !panel.isVisible()) {
    closeHistoryPanel(false)
    return
  }
  closeHistoryPanel(false)
  const history = new BrowserWindow({
    width: (kind === 'cpu' || kind === 'network' || kind === 'memory') ? 392 : HISTORY_PANEL_WIDTH,
    height: (kind === 'cpu' || kind === 'network' || kind === 'memory') ? 216 : HISTORY_PANEL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    ...(process.platform === 'darwin'
      ? {
          vibrancy: 'popover' as const,
          visualEffectState: 'active' as const,
          transparent: true,
          roundedCorners: true,
          hasShadow: true
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  historyPanel = history
  if (mainMouseHandler) history.webContents.removeListener('before-mouse-event', mainMouseHandler)
  history.on('closed', () => {
    if (historyPanel !== history) return
    historyPanel = null
    if (historyHoverTimer) clearInterval(historyHoverTimer)
    historyHoverTimer = null
    if (panel && !panel.isDestroyed()) panel.webContents.send('tray:history-closed')
  })
  try {
    nativeSetPanelBehavior(history.getNativeWindowHandle())
  } catch {
    /* no-op */
  }
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void history.loadURL(
      `${process.env['ELECTRON_RENDERER_URL']}/tray.html?history=${encodeURIComponent(kind)}`
    )
  } else {
    // Build the file URL ourselves.  `loadFile(..., { query })` has intermittently
    // resolved the ASAR root as the document in packaged builds, which makes the
    // popup render raw archive bytes as mojibake.  A complete file URL keeps the
    // renderer entry and its query unambiguous.
    const url = pathToFileURL(join(__dirname, '../renderer/tray.html'))
    url.searchParams.set('history', kind)
    void history.loadURL(url.toString())
  }
  history.webContents.once('did-finish-load', () => {
    if (history.isDestroyed()) return
    if (menubarColorsPreview) history.webContents.send('menubar:colors-preview', menubarColorsPreview)
    const payload = systemInfoPayload()
    if (payload) history.webContents.send('tray:system-info', payload)
  })
  // Do not expose a half-loaded native surface.  This also removes the one-frame
  // flash of the previous/blank layout when a history popup is opened.
  history.once('ready-to-show', () => {
    if (history.isDestroyed() || historyPanel !== history) return
    positionHistoryPanel(history)
    history.showInactive()
    startHistoryHoverMonitor()
  })
}

function recordBattery(info: SystemInfo): void {
  if (!info.battery.installed || !Number.isFinite(info.battery.percent)) return
  const now = Date.now()
  const plugged = !!info.battery.adapterName || info.battery.charging
  if (now - (batteryHistory.at(-1)?.time ?? 0) < 55_000) return
  batteryHistory = batteryHistory.filter((sample) => sample.time >= now - BATTERY_WINDOW)
  batteryHistory.push({
    time: now,
    percent: info.battery.percent,
    plugged,
    charging: info.battery.charging
  })
  try {
    const file = join(app.getPath('userData'), 'battery-history.json')
    writeFileSync(file + '.tmp', JSON.stringify(batteryHistory))
    renameSync(file + '.tmp', file)
  } catch (error) {
    console.warn('保存电池历史失败', error)
  }
}

function recordSystemHistory(): void {
  const now = Date.now()
  const boundary = Math.floor(now / 30_000) * 30_000
  if ((systemHistory.at(-1)?.time ?? 0) >= boundary - 1) return
  const samples = liveSystemHistory.filter((sample) => sample.time >= boundary - 30_000 && sample.time < boundary)
  if (!samples.length) return
  const mean = (read: (sample: SystemHistorySample) => number): number =>
    samples.reduce((total, sample) => total + read(sample), 0) / samples.length
  const memorySamples = samples.filter((sample) => sample.memory)
  const memoryMean = (key: 'percent' | 'pressure' | 'appBytes' | 'wiredBytes' | 'compressedBytes' | 'availableBytes'): number =>
    memorySamples.reduce((sum, sample) => sum + (sample.memory![key] ?? 0), 0) / memorySamples.length
  systemHistory = systemHistory.filter((sample) => sample.time >= now - SYSTEM_HISTORY_WINDOW)
  systemHistory.push({
    time: boundary - 1,
    cpu: { percent: mean(s => s.cpu.percent), user: mean(s => s.cpu.user), system: mean(s => s.cpu.system), idle: mean(s => s.cpu.idle) },
    network: { uploadBps: mean(s => s.network.uploadBps), downloadBps: mean(s => s.network.downloadBps) },
    memory: memorySamples.length ? { percent: memoryMean('percent'), pressure: memoryMean('pressure'), availableBytes: memoryMean('availableBytes'), appBytes: memoryMean('appBytes'), wiredBytes: memoryMean('wiredBytes'), compressedBytes: memoryMean('compressedBytes') } : undefined
  })
  if (now - lastSystemHistoryWrite < 60_000) return
  lastSystemHistoryWrite = now
  try {
    const file = join(app.getPath('userData'), 'system-history.json')
    writeFileSync(file + '.tmp', JSON.stringify([...systemHistory.filter((s) => s.time < (liveSystemHistory[0]?.time ?? Infinity)), ...liveSystemHistory]))
    renameSync(file + '.tmp', file)
  } catch (error) {
    console.warn('保存系统历史失败', error)
  }
}

function startBatteryHistory(): void {
  if (batteryTimer) return
  try {
    const saved: unknown = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'battery-history.json'), 'utf8')
    )
    if (Array.isArray(saved))
      batteryHistory = saved.filter(
        (s) =>
          s &&
          Number.isFinite(s.time) &&
          s.time <= Date.now() &&
          s.time >= Date.now() - BATTERY_WINDOW &&
          Number.isFinite(s.percent) &&
          s.percent >= 0 &&
          s.percent <= 1 &&
          typeof s.plugged === 'boolean' &&
          typeof s.charging === 'boolean'
      )
  } catch {
    /* 首次运行尚无历史 */
  }
  try {
    const saved: unknown = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'system-history.json'), 'utf8')
    )
    if (Array.isArray(saved)) {
      systemHistory = saved.filter(
        (s) =>
          s &&
          Number.isFinite(s.time) &&
          s.time <= Date.now() &&
          s.time >= Date.now() - SYSTEM_HISTORY_WINDOW &&
          s.cpu &&
          s.network &&
          Number.isFinite(s.cpu.percent) &&
          Number.isFinite(s.network.uploadBps) &&
          Number.isFinite(s.network.downloadBps)
      )
    }
  } catch {
    /* 首次运行尚无历史 */
  }
  liveSystemHistory = systemHistory.filter((s) => s.time >= Date.now() - 600_000)
  const sample = (): void => {
    const info = nativeGetSystemInfo()
    latestSystemInfo = info
    if (info) {
      const now = Date.now()
      liveSystemHistory = [...liveSystemHistory.filter((s) => s.time > now - 600_000),
        { time: now, cpu: info.cpu, memory: info.memory, network: info.network }]
    }
    if (info) {
      recordBattery(info)
      recordSystemHistory()
    }
  }
  sample()
  batteryTimer = setInterval(sample, 1000)
}

/** 系统信息推送（面板打开期间）：立即推一帧 + 每 2s 采样（native getSystemInfo，
 *  业界通行口径）。第一帧 CPU/网速是差值可能为 0，第二帧起正常。 */
function systemInfoPayload(): SystemInfo | null {
  if (!latestSystemInfo) return null
  const recentStart = liveSystemHistory[0]?.time ?? Infinity
  return { ...latestSystemInfo, batteryHistory,
    systemHistory: [...systemHistory.filter((s) => s.time < recentStart), ...liveSystemHistory] }
}

function startSystemInfoFeed(): void {
  stopSystemInfoFeed()
  const push = (): void => {
    const payload = systemInfoPayload()
    if (payload && panel && !panel.isDestroyed()) {
      panel.webContents.send('tray:system-info', payload)
      if (historyPanel && !historyPanel.isDestroyed())
        historyPanel.webContents.send('tray:system-info', payload)
    }
  }
  push()
  sysTimer = setInterval(push, 1000)
}

function stopSystemInfoFeed(): void {
  if (sysTimer) clearInterval(sysTimer)
  sysTimer = null
}

/** 自定义图是 GIF → 解码成帧序列交给 SwiftUI 换帧模型（Swift 内部
 *  .common Timer 换帧，系统托管非活跃屏冻结最后一帧）；否则挂静态图（=1 帧）。
 *  原图直传（2026-08-28 定稿）：帧保持素材原样 RGB+alpha，剪影角色的颜色反转由
 *  Swift 侧 RunnerView 按菜单栏外观做 colorInvert——
 *  活跃时=GIF 原图、非活跃屏=系统自动线条化，
 *  自动反转播放=乒乓（拼正向+反向帧序列，边界帧不重复 */
function applyTrayIcon(): void {
  const { trayIcon, trayIconPath, trayAutoReverse, trayFlip } = getSettings()
  const isGif =
    trayIcon === 'custom' && !!trayIconPath && extname(trayIconPath).toLowerCase() === '.gif'
  const invert = trayIconPath ? invertOf(trayIconPath) : { light: false, dark: false }
  if (isGif) {
    // box=方框拉伸显示（22pt 方框拉伸显示（非正方形素材拉满方框））
    const box = isBoxRole(trayIconPath as string)
    const frames = loadGifFrames(trayIconPath as string, roleSize(trayIconPath as string), {
      box
    })
    if (frames) {
      const seq =
        trayAutoReverse && frames.length > 1
          ? [...frames, ...frames.slice(1, -1).reverse()]
          : frames
      // 帧序列一次性传给 Swift 换帧模型（换帧在 Swift 内部 Timer 完成）
      nativeSetFrames(
        seq.map((f) => f.image.toPNG()),
        false,
        frameInterval(),
        box
      )
      nativeSetInvert(invert.light, invert.dark)
      nativeSetFlip(!!trayFlip)
      startCpuFollow()
      return
    }
  }
  stopCpuFollow()
  const { png, template } = staticTrayIconPng()
  nativeSetFrames([png], template, 1000, false)
  nativeSetInvert(invert.light, invert.dark)
  nativeSetFlip(!!trayFlip)
}

/** 面板外关闭规则：除面板外的所有窗口（主窗口/设置窗口/未来任何窗口）mousedown → 关面板。
 *  全局监视器只看得见其他应用的鼠标事件，自己应用的窗口点击要靠这里兜底。
 *  before-mouse-event 是 Electron 的鼠标事件钩子（before-input-event 只收键盘，收不到鼠标——
 *  2026-09-01 曾用错 API 导致"点主窗口不关面板"）。
 *  每次面板显示时全量重挂（窗口可能懒创建/销毁重建过），隐藏时卸掉 */
let mainMouseHandler: ((e: Electron.Event, mouse: Electron.MouseInputEvent) => void) | null = null
function hookOtherWindows(): void {
  unhookOtherWindows()
  mainMouseHandler = (_e, mouse) => {
    if (menubarPreviewActive) return
    if (mouse.type === 'mouseDown' && panel && !panel.isDestroyed() && panel.isVisible()) {
      panel.hide()
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win === panel || win === historyPanel || win.isDestroyed()) continue
    win.webContents.on('before-mouse-event', mainMouseHandler)
  }
}
function unhookOtherWindows(): void {
  if (!mainMouseHandler) return
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.removeListener('before-mouse-event', mainMouseHandler)
  }
  mainMouseHandler = null
}
// 面板开着时新创建的窗口（主窗口懒创建/销毁重建、设置窗口首次打开）→ 补挂
app.on('browser-window-created', (_e, win) => {
  if (!mainMouseHandler || !panel || panel.isDestroyed() || !panel.isVisible() || win === panel)
    return
  win.webContents.on('before-mouse-event', mainMouseHandler)
})

function createPanel(): BrowserWindow {
  panel = new BrowserWindow({
    width: PANEL_COMPACT_WIDTH,
    height: 424,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    // 系统 Popover 材质由 macOS 自己绘制并随系统深浅切换；项目主窗口主题不参与。
    // 透明窗口 + CSS 圆角面板，窗口边缘透出纯玻璃（.tray-panel margin 区）
    ...(process.platform === 'darwin'
      ? {
          vibrancy: 'popover' as const,
          visualEffectState: 'active' as const,
          transparent: true,
          roundedCorners: true,
          hasShadow: true
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  // 关闭只有两条路（2026-09-01 用户拍板）：再点托盘图标（togglePanel）或点面板外（全局左键监视）。
  // 不做 blur 关闭——点面板里的设置/切换动画/项目行会开别的窗口导致面板失焦，
  // blur 关会让面板被「点内部」误关，用户想连续操作要反复点图标
  // 面板显示期间挂全局左键监视：点击面板外任意处关闭（标准菜单栏交互）；
  // 隐藏即摘除。点托盘图标本身走 button action 的 togglePanel，监视回调里坐标在图标
  // 区内则忽略不误关（坐标已由原生侧转为 CG/Electron 系，原点主屏左上）
  panel.on('show', () => {
    // 每次弹出都回到默认界面（上次停留的项目列表/更多页不残留）
    panel?.webContents.send('tray:reset-view')
    startSystemInfoFeed()
    hookOtherWindows()
    nativeStartGlobalClickMonitor((type, payload) => {
      if (menubarPreviewActive) return
      if (historyRangeMenuOpen) return
      if (type !== 'click' || !panel || panel.isDestroyed() || !panel.isVisible()) return
      const [x, y] = payload.split(',').map(Number)
      const b = panel.getBounds()
      if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) return
      if (
        historyPanel &&
        !historyPanel.isDestroyed() &&
        pointInside(historyPanel.getBounds(), { x, y })
      )
        return
      const f = nativeGetFrame()
      if (f.w > 0 && x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) return
      panel.hide()
    })
  })
  panel.on('hide', () => {
    closeHistoryPanel()
    stopSystemInfoFeed()
    nativeStopGlobalClickMonitor()
    unhookOtherWindows()
  })
  // 面板窗口设为跟随活跃 Space：每次弹出自动出现在当前桌面，不闪回创建时的旧桌面
  try {
    nativeSetPanelBehavior(panel.getNativeWindowHandle())
  } catch {
    /* no-op */
  }
  // 面板关闭不把主窗口带出来：主窗口本来不可见就保持不可见（点托盘第二下主界面弹出的根因）
  panel.on('hide', () => {
    const main = getMainWindow()
    if (main && !main.isDestroyed() && !main.isVisible()) hideMainWindow()
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    panel.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/tray.html`)
  } else {
    panel.loadFile(join(__dirname, '../renderer/tray.html'))
  }
  panel.webContents.once('did-finish-load', () => {
    if (panel && !panel.isDestroyed() && menubarColorsPreview)
      panel.webContents.send('menubar:colors-preview', menubarColorsPreview)
  })
  return panel
}

/** 上次开合时间（防连续点击时 click 事件触发两遍造成开了又关） */
let panelToggleAt = 0

function togglePanel(): void {
  const now = Date.now()
  if (now - panelToggleAt < 250) return
  panelToggleAt = now
  if (!panel || panel.isDestroyed()) createPanel()
  const p = panel
  if (!p) return
  if (p.isVisible()) {
    p.hide()
    return
  }
  // 面板定位在托盘图标下方（原生 getFrame 顶部原点坐标）
  positionPanel(p)
  // 非激活弹出：不抢焦点、不激活应用、主窗口不被带前台（面板纯鼠标交互无输入框）
  p.showInactive()
}

/** 原生层事件：左键点击（右键菜单已移除——与面板内「打开主窗口/偏好设置/退出」重复，2026-09-01；
 *  模板图由系统按每屏菜单栏外观自动着色，无需处理外观事件） */
function onNativeEvent(type: string, payload: string): void {
  if (type === 'click' && payload === 'left') togglePanel()
}

/** 按设置刷新托盘（启用开关/图标样式变化时调用） */
export function refreshTray(): void {
  const { trayEnabled } = getSettings()
  if (!trayEnabled) {
    stopCpuFollow()
    stopCpuTemperature()
    nativeDestroyStatusItem()
    nativeCreated = false
    panel?.destroy()
    panel = null
    return
  }
  if (!nativeCreated) {
    nativeCreateStatusItem(onNativeEvent)
    // SwiftUI 渲染模块（libtray_runner.dylib）：dev=项目 native/build/Release；
    // 打包后由 electron-builder extraResources 拷到 Contents/Resources，走 resourcesPath
    nativeInitTrayRunner(
      app.isPackaged
        ? join(process.resourcesPath, 'libtray_runner.dylib')
        : join(app.getAppPath(), 'native/build/Release/libtray_runner.dylib')
    )
    nativeCreated = true
  }
  applyTrayIcon()
  syncCpuTemperature()
}

/** 应用启动时创建托盘 */
export function initTray(): void {
  refreshTray()
  startBatteryHistory()
}

/** 退出前清理 */
export function destroyTray(): void {
  closeHistoryPanel(false)
  if (batteryTimer) clearInterval(batteryTimer)
  batteryTimer = null
  stopCpuFollow()
  stopCpuTemperature()
  stopSystemInfoFeed()
  nativeDestroyStatusItem()
  nativeCreated = false
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
