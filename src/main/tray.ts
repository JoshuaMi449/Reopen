// 托盘模块：右上角菜单栏图标 + 点击弹出小面板（PRD 3.7）
// 动画=SwiftUI 视图 + Swift 内部 .common Timer 换帧（严格照抄 BuZhiYin 机制，三图标对比
// 实验定稿：只有 SwiftUI 管线能获得系统「非活跃屏冻结最后一帧」托管，NSImageView 换图/
// 图层动画/button.image 换图全都不行）。JS 只负责解码帧序列与 CPU 变速间隔。
import { app, BrowserWindow, nativeImage, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync } from 'fs'
import { basename, extname, join } from 'path'
import { getSettings } from './store'
import { stopAllRuntimes } from './projectManager'
import { openSettingsWindow } from './settingsWindow'
import { getMainWindow, hideMainWindow, markQuitConfirmed, showMainWindow } from './window'
import { loadGifFrames } from './gifFrames'
import { invertOf, isBoxRole } from './trayCharacters'
import { getCpuUsage } from './cpuSampler'
import {
  nativeCreateStatusItem,
  nativeInitTrayRunner,
  nativeSetFrames,
  nativeSetInterval,
  nativeSetInvert,
  nativeGetFrame,
  nativeSetPanelBehavior,
  nativeStartGlobalClickMonitor,
  nativeStopGlobalClickMonitor,
  nativeDestroyStatusItem
} from './nativeAddon'
import trayIconAsset from '../../resources/tray-icon.png?asset'

/** 黑白（主题）图标大小：菜单栏标准高度 */
const MONO_SIZE = 18
/** 角色图标默认高度 22pt（44px@2x）：不只因体系素材按不只因规格（历史 f6f8b32「固定22px」），宽度随原比例 */
const DEFAULT_CUSTOM_SIZE = 22
/** 个别角色特例：dogeza（日本人磕头）素材来自 RunCat，按 RunCat 显示规格 18pt（素材高 36px 按 2x） */
const ROLE_SIZES: Record<string, number> = { dogeza: 18 }

/** 按角色拿显示高度（pt）：dogeza=RunCat 规格 18pt；其余=不只因规格 22pt */
function roleSize(path: string): number {
  return ROLE_SIZES[basename(path, extname(path))] ?? DEFAULT_CUSTOM_SIZE
}
/** 帧间隔下限（防刷爆菜单栏） */
const MIN_INTERVAL = 40

let panel: BrowserWindow | null = null
let nativeCreated = false
/** CPU 变速定时器（每 2s 采样一次，把换帧间隔传给 Swift 侧 Timer） */
let cpuTimer: ReturnType<typeof setTimeout> | null = null

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

/** 当前帧间隔（ms）：CPU 使用率换算（cpuSampler 内部缓存窗口 2s）。
 *  公式照抄 BuZhiYin 🐔View.swift:126-128：开=(1-CPU)/5×(1.1-只因速)；关=CPU/5×(1.1-只因速），
 *  下限 40ms（防刷爆菜单栏）。换帧本身由 Swift 侧 .common Timer 驱动（BuZhiYin 同款），
 *  JS 只周期性把间隔传给 Swift。 */
function frameInterval(): number {
  const usage = getCpuUsage()
  const { trayIconSpeed, cpuFollow } = getSettings()
  const speed = trayIconSpeed ?? 0.5
  const base = (cpuFollow ? 1.0001 - usage : usage) / 5
  return Math.max(MIN_INTERVAL, Math.round(base * (1.1 - speed) * 1000))
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

/** 自定义图是 GIF → 解码成帧序列交给 SwiftUI 换帧模型（照抄 BuZhiYin：Swift 内部
 *  .common Timer 换帧，系统托管非活跃屏冻结最后一帧）；否则挂静态图（=1 帧）。
 *  原图直传（2026-08-28 定稿）：帧保持素材原样 RGB+alpha，剪影角色的颜色反转由
 *  Swift 侧 RunnerView 按菜单栏外观做 colorInvert（不只因 AutoInvertImage 同款）——
 *  活跃时=GIF 原图、非活跃屏=系统自动线条化，与不只因一致。
 *  自动反转播放=乒乓（拼正向+反向帧序列，边界帧不重复，BuZhiYin autoReverse 同款） */
function applyTrayIcon(): void {
  const { trayIcon, trayIconPath, trayAutoReverse } = getSettings()
  const isGif =
    trayIcon === 'custom' && !!trayIconPath && extname(trayIconPath).toLowerCase() === '.gif'
  const invert = trayIconPath ? invertOf(trayIconPath) : { light: false, dark: false }
  if (isGif) {
    // box=方框拉伸显示（照不只因 .frame(22,22)+.resizable() 显示规格，只因篮球等与不只因同尺寸）
    const box = isBoxRole(trayIconPath as string)
    const frames = loadGifFrames(trayIconPath as string, roleSize(trayIconPath as string), {
      box
    })
    if (frames) {
      const seq =
        trayAutoReverse && frames.length > 1
          ? [...frames, ...frames.slice(1, -1).reverse()]
          : frames
      // 帧序列一次性传给 Swift 换帧模型（BuZhiYin 同款：换帧在 Swift 内部 Timer 完成）
      nativeSetFrames(
        seq.map((f) => f.image.toPNG()),
        false,
        frameInterval(),
        box
      )
      nativeSetInvert(invert.light, invert.dark)
      startCpuFollow()
      return
    }
  }
  stopCpuFollow()
  const { png, template } = staticTrayIconPng()
  nativeSetFrames([png], template, 1000, false)
  nativeSetInvert(invert.light, invert.dark)
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
  // blur 延迟 150ms 再关：点托盘图标会先 blur 后 click——立即 hide 会让 togglePanel
  // 误判「面板已关」反向又弹出来
  panel.on('blur', () => {
    setTimeout(() => panel?.hide(), 150)
  })
  // 面板显示期间挂全局左键监视：点击面板外任意处关闭（标准菜单栏交互，LookAway 同款）；
  // 隐藏即摘除。点托盘图标本身走 button action 的 togglePanel，监视回调里坐标在图标
  // 区内则忽略不误关（坐标已由原生侧转为 CG/Electron 系，原点主屏左上）
  panel.on('show', () => {
    nativeStartGlobalClickMonitor((type, payload) => {
      if (type !== 'click' || !panel || panel.isDestroyed() || !panel.isVisible()) return
      const [x, y] = payload.split(',').map(Number)
      const b = panel.getBounds()
      if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) return
      const f = nativeGetFrame()
      if (f.w > 0 && x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) return
      panel.hide()
    })
  })
  panel.on('hide', () => nativeStopGlobalClickMonitor())
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
  const f = nativeGetFrame()
  const winBounds = p.getBounds()
  const display = screen.getDisplayNearestPoint(
    f.w > 0 ? { x: f.x, y: f.y } : screen.getCursorScreenPoint()
  )
  const { workArea } = display
  let x =
    f.w > 0
      ? Math.round(f.x + f.w / 2 - winBounds.width / 2)
      : workArea.x + workArea.width - winBounds.width - 8
  let y = f.w > 0 ? f.y + f.h + 6 : 30
  x = Math.min(Math.max(x, workArea.x + 4), workArea.x + workArea.width - winBounds.width - 4)
  if (y + winBounds.height > workArea.y + workArea.height) {
    y = (f.w > 0 ? f.y : workArea.y + workArea.height) - winBounds.height - 6
  }
  p.setPosition(x, y)
  // 非激活弹出：不抢焦点、不激活应用、主窗口不被带前台（LookAway 同款；面板纯鼠标交互无输入框）
  p.showInactive()
}

/** 原生层事件：左键点击、右键菜单动作（右键菜单本体在 addon 原生 NSMenu 弹出；
 *  模板图由系统按每屏菜单栏外观自动着色，无需处理外观事件） */
function onNativeEvent(type: string, payload: string): void {
  if (type === 'click') {
    if (payload === 'left') togglePanel()
  } else if (type === 'menu') {
    if (payload === 'show-main') showMainWindow()
    else if (payload === 'settings') openSettingsWindow()
    else if (payload === 'quit') appQuit()
  }
}

/** 按设置刷新托盘（启用开关/图标样式变化时调用） */
export function refreshTray(): void {
  const { trayEnabled } = getSettings()
  if (!trayEnabled) {
    stopCpuFollow()
    nativeDestroyStatusItem()
    nativeCreated = false
    panel?.destroy()
    panel = null
    return
  }
  if (!nativeCreated) {
    nativeCreateStatusItem(onNativeEvent)
    // SwiftUI 渲染模块（libtray_runner.dylib）：dev=项目 native/build/Release；打包后由
    // electron-builder extraResources 处理（M4 发布时接 resourcesPath）
    nativeInitTrayRunner(join(app.getAppPath(), 'native/build/Release/libtray_runner.dylib'))
    nativeCreated = true
  }
  applyTrayIcon()
}

/** 应用启动时创建托盘 */
export function initTray(): void {
  refreshTray()
}

/** 退出前清理 */
export function destroyTray(): void {
  stopCpuFollow()
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
