// 主窗口管理：创建、显示、关闭时最小化到托盘（PRD 3.6 通用设置）
import { app, BrowserWindow, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { readdir } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve } from 'path'
import icon from '../../resources/icon.png?asset'
import { getSettings, listProjects } from './store'

let mainWindow: BrowserWindow | null = null
let quitting = false

export function markQuitting(): void {
  quitting = true
}

let quitConfirmed = false

/** 标记退出已确认（托盘右键退出等明确路径跳过 ⌘Q 确认框） */
export function markQuitConfirmed(): void {
  quitConfirmed = true
  markQuitting()
}

export function isQuitConfirmed(): boolean {
  return quitConfirmed
}

/** 主窗口引用（设置窗口 parent 用：设置只盖在主窗口上，不置顶于其他应用，用户澄清） */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** 托盘形态：主窗口可见 → Regular（Dock+应用菜单+可激活）；隐藏/销毁 → Accessory
 *  （纯菜单栏，无 Dock 不抢焦点）。托盘关闭时钉死 Regular（Dock 是唯一入口，切
 *  Accessory 会让应用彻底不可达）；非 macOS 跳过。实验已排除身份切换与非活跃屏
 *  冻结的关联（41bf59c），动态切换安全。 */
function setDockMode(docked: boolean): void {
  if (process.platform !== 'darwin') return
  if (docked) {
    app.setActivationPolicy('regular')
    // 身份切换会把 Dock 图标重置回 Electron 默认（createWindow 里那次 setIcon 被覆盖），补贴一次
    app.dock?.setIcon(icon)
  } else if (getSettings().trayEnabled) {
    app.setActivationPolicy('accessory')
  }
}

export function createWindow(): void {
  // 默认尺寸按主屏工作区 55% 宽、16:10 比例（默认再宽一点，比例=电脑屏幕比例）
  const { workArea } = screen.getPrimaryDisplay()
  const winWidth = Math.min(Math.max(Math.round(workArea.width * 0.55), 1200), 2000)
  const winHeight = Math.round(winWidth * 0.625)

  // macOS Dock 图标：dev 模式跑的是裸 Electron（Dock 显示 Electron 默认图标），显式设置；
  // 打包成 .app 后由 bundle 里的 icns 接管，此处同样生效无冲突（用户问"为什么还是 Electron"）
  if (process.platform === 'darwin') app.dock?.setIcon(icon)

  mainWindow = new BrowserWindow({
    // 三栏布局默认宽度（左 190 固定、中间 4 列卡片 950、自启面板占 1 列 224、日志占 2 列 456；窗口可调）
    width: winWidth,
    height: winHeight,
    // 最小宽度 1200（精确最小 1156=190 侧栏+16 padding+950 四列，保证最小窗口下仍 4 列；
    //  再留滚动条余量——开日志抽屉（占 2 列 456）后卡片区稳定剩 2 列，不塌成 1 列
    minWidth: 1200,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    // macOS 隐藏标题栏：红黄绿按钮浮在内容上，没有深色黑边
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    // 手动打开（Dock/Launchpad/open 命令）→ 窗口直接到前台（2026-09-07 用户：你打开的不显示窗口）；
    // 开机自启那次才只显示不抢焦点（不打断用户）
    const atLogin = process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin
    showMainWindow(undefined, !atLogin)
  })

  // TCC 预热弹窗只在窗口前台时出现：第一次获得焦点才触发（后台启动会被系统吞掉，
  // 2026-09-07 用户反馈预热弹窗没出现）；每个签名只弹一次，已授权静默通过
  mainWindow.on('focus', () => prewarmTccAccess())

  // 关闭窗口 = 最小化到托盘（默认开；⌘Q 走 before-quit 不拦截）
  mainWindow.on('close', (e) => {
    if (!quitting && getSettings().closeToTray) {
      e.preventDefault()
      hideMainWindow()
    }
  })

  // 托盘形态：窗口隐藏（hideMainWindow/Cmd+H 都汇聚到这里）或销毁（closeToTray 关）→
  // 回 Accessory。最小化走 'minimize' 不触发 hide → 保持 Regular、Dock 保留（标准 macOS 行为）
  mainWindow.on('hide', () => setDockMode(false))
  mainWindow.on('closed', () => setDockMode(false))

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

/** 显示主窗口（托盘面板"打开主窗口"、⌥+R 等调用；可附带菜单动作）。
 *  托盘形态：显示即切 Regular（Dock 出现、应用可激活、左上角应用菜单）；
 *  activate=false 用于首启/重建自动显示——只 show 不抢焦点（开机自启不打断用户） */
export function showMainWindow(action?: string, activate = true): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  setDockMode(true)
  mainWindow?.show()
  if (activate) {
    app.focus({ steal: true })
    mainWindow?.focus()
  }
  if (action) {
    mainWindow?.webContents.send('app:menu-action', action)
  }
}

/** 隐藏主窗口：hide 事件里切回 Accessory（托盘形态，见 createWindow 事件注册） */
export function hideMainWindow(): void {
  mainWindow?.hide()
}

/** 全局快捷键：窗口可见且聚焦 → 隐藏；否则唤起（PRD 3.6 全局唤起窗口） */
export function toggleMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) {
    hideMainWindow()
    return
  }
  showMainWindow()
}

// 启动预热（方案 A）：项目在 TCC 保护目录（下载/桌面/文稿）里时，窗口第一次聚焦后
// 主动读一次这些目录——未授权的签名触发系统授权弹窗（点一次「允许」，无密码）；
// 批准后本次运行 Reopen 及其子进程（dev 服务）访问这些目录全部畅通。授权过的签名静默通过
let prewarmed = false

function prewarmTccAccess(): void {
  if (process.platform !== 'darwin' || prewarmed) return
  prewarmed = true
  const protectedDirs = [
    join(homedir(), 'Downloads'),
    join(homedir(), 'Desktop'),
    join(homedir(), 'Documents')
  ]
  const hasProtected = listProjects().some(
    (p) =>
      p.type !== 'group' &&
      protectedDirs.some((d) => resolve(String(p.path ?? '')).startsWith(d + '/'))
  )
  if (!hasProtected) return
  // 异步读：弹窗挂起时不阻塞主进程；顺带 arm 焦点守卫（弹窗关闭后把 Reopen 拉回）。
  // 只在这一个弹窗时刻武装一次——项目启动不再武装，避免用户切窗口被误拽回（2026-09-07）
  for (const d of protectedDirs) {
    void readdir(d).catch(() => {})
  }
  armFocusGuard()
}

// TCC 授权弹窗（下载/桌面/文稿访问）关闭后 macOS 不把焦点还给主窗口（2026-09-07 用户：
// 启动项目后点允许，活跃窗口跳走）。arm 后 60 秒内主窗口一旦失焦（TCC 弹窗出现必然失焦），
// 4 秒仍未聚焦就拉回——弹窗挂起时拉回无碍（系统弹窗是模态顶层），用户点允许后弹窗关闭，
// Reopen 已在前台
let focusGuardTimer: ReturnType<typeof setTimeout> | null = null

export function armFocusGuard(): void {
  if (process.platform !== 'darwin') return
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const onBlur = (): void => {
    if (focusGuardTimer) clearTimeout(focusGuardTimer)
    focusGuardTimer = setTimeout(() => {
      if (win && !win.isDestroyed() && win.isVisible() && !win.isFocused()) {
        win.show()
        app.focus({ steal: true })
        win.focus()
      }
    }, 4000)
  }
  win.once('blur', onBlur)
  setTimeout(() => win.removeListener('blur', onBlur), 60000)
}
