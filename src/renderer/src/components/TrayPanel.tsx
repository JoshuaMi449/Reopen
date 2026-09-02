import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  Battery,
  BatteryCharging,
  Cpu,
  ExternalLink,
  FileCode2,
  Folder,
  Gauge,
  HardDrive,
  Info,
  List,
  MemoryStick,
  PawPrint,
  Power,
  RefreshCw,
  Settings as SettingsIcon,
  Wifi
} from 'lucide-react'
import type {
  Project,
  ProjectStatusEvent,
  SystemInfo,
  TrayCharacterItem
} from '../../../shared/types'
import wordmark from '../assets/wordmark.png'
// 「查看项目状态」格子的菜单栏 logo 素材（用户提供：黑=浅色系统用，白=暗色系统用，CSS 随系统切换）
import trayProjectsLight from '../assets/tray-projects-light.png'
import trayProjectsDark from '../assets/tray-projects-dark.png'

/** 面板三视图：系统信息卡（默认）/ 项目状态 / 更多菜单；关于是更多里的子页 */
type PanelView = 'dashboard' | 'projects' | 'more' | 'about'

/** CPU 波形图历史窗口（2s 一次采样 × 30 = 1 分钟） */
const WAVE_POINTS = 30

/** 字节 → 人类可读（同款显示：GB 一位小数起步） */
function fmtBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  const digits = i >= 3 || v >= 100 ? 1 : 0
  return `${v.toFixed(digits)} ${units[i]}`
}

/** 速度 → kB/s 或 MB/s */
function fmtSpeed(bps: number): string {
  if (!isFinite(bps) || bps <= 0) return '0 B/s'
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`
  return `${(bps / 1000).toFixed(1)} kB/s`
}

/** 百分比 0-1 → "12.0%" */
function fmtPct(v: number, digits = 1): string {
  return `${(Math.max(0, Math.min(v, 1)) * 100).toFixed(digits)}%`
}

/** 面板布局参照业界通行面板（2026-08-30 定稿）：
 *  左侧大框=5 张系统信息卡（CPU 波形图/内存/储存进度条/电池/网络，同款数据），
 *  右上角 wordmark 文字 logo（点击回默认页），右侧 5 个方形功能格（图标+下方小字）。
 *  左框三视图切换：dashboard（默认）/ projects（点①查看项目状态）/ more（点⑤）。
 */
export function TrayPanel(): React.JSX.Element {
  const [view, setView] = useState<PanelView>('dashboard')
  const [projects, setProjects] = useState<Project[]>([])
  const [statuses, setStatuses] = useState<Record<string, ProjectStatusEvent>>({})
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null)
  // CPU 波形历史（2s 采样 × 30 点）
  const [cpuHistory, setCpuHistory] = useState<number[]>([])
  // 切换动画弹菜单：角色类型页（动图=GIF 角色 / 图片=静态素材）
  const [charMenuOpen, setCharMenuOpen] = useState(false)
  const [charTab, setCharTab] = useState<'gif' | 'img'>('gif')
  const [characters, setCharacters] = useState<TrayCharacterItem[]>([])

  useEffect(() => {
    window.api.listProjects().then(setProjects)
    window.api.adoptAllRunning()
    window.api.listTrayCharacters().then(setCharacters)
    const offStatus = window.api.onStatus((e: ProjectStatusEvent) => {
      setStatuses((s) => ({ ...s, [e.id]: e }))
    })
    const offSys = window.api.onSystemInfo((s: SystemInfo) => {
      setSysInfo(s)
      setCpuHistory((h) => [...h.slice(-(WAVE_POINTS - 1)), s.cpu.percent])
    })
    const offLog = window.api.onLog(() => {
      // 面板不显示日志，忽略
    })
    // 面板每次弹出前重置回默认界面（上次停留的项目列表/更多页/弹菜单不残留）
    const offReset = window.api.onTrayResetView(() => {
      setView('dashboard')
      setCharMenuOpen(false)
    })
    return () => {
      offStatus()
      offSys()
      offLog()
      offReset()
    }
  }, [])

  const charItems = useMemo(
    () => characters.filter((c) => (charTab === 'gif' ? c.isGif : !c.isGif)),
    [characters, charTab]
  )

  const runningCount = useMemo(
    () => Object.values(statuses).filter((s) => s.status === 'running').length,
    [statuses]
  )

  const webProjects = useMemo(() => projects.filter((p) => p.type !== 'service'), [projects])
  const serviceProjects = useMemo(() => projects.filter((p) => p.type === 'service'), [projects])

  const openBrowser = (p: Project): void => {
    window.api.openProjectBrowser(p.id)
  }

  const switchCharacter = (path: string): void => {
    setCharMenuOpen(false)
    window.api.switchTrayCharacter(path)
  }

  return (
    <div className="tray-panel">
      {/* 右上角 wordmark 文字 logo（浮层无底框，点击回默认页） */}
      <img
        className="tray-wordmark"
        src={wordmark}
        alt="Reopen"
        draggable={false}
        title="回到系统信息"
        onClick={() => setView('dashboard')}
      />

      <div className="tray-main">
        <div className="tray-body">
          {view === 'dashboard' && <SystemCards sysInfo={sysInfo} cpuHistory={cpuHistory} />}
          {view === 'projects' && (
            <ProjectsView
              runningCount={runningCount}
              webProjects={webProjects}
              serviceProjects={serviceProjects}
              statuses={statuses}
              onOpen={openBrowser}
            />
          )}
          {view === 'more' && <MoreView onNavigate={setView} />}
          {view === 'about' && <AboutView onBack={() => setView('more')} />}
        </div>

        {/* 右侧 5 功能格（面板布局：图标+下方小字） */}
        <div className="tray-side">
          <button
            className={`tray-side-btn ${view === 'projects' ? 'is-active' : ''}`}
            title="项目状态"
            onClick={() => setView(view === 'projects' ? 'dashboard' : 'projects')}
          >
            {/* 菜单栏 logo 素材（用户提供黑白双版，CSS 随系统外观切换） */}
            <img
              className="tray-projects-img tray-projects-img-light"
              src={trayProjectsLight}
              alt=""
              draggable={false}
            />
            <img
              className="tray-projects-img tray-projects-img-dark"
              src={trayProjectsDark}
              alt=""
              draggable={false}
            />
            <span className="tray-side-label">项目状态</span>
          </button>
          <button
            className="tray-side-btn"
            title="设置"
            onClick={() => window.api.showMainWindow('settings')}
          >
            <SettingsIcon size={28} />
            <span className="tray-side-label">设置</span>
          </button>
          <div className="tray-side-btn-wrap">
            <button
              className="tray-side-btn"
              title="切换动画"
              onClick={() => setCharMenuOpen((v) => !v)}
            >
              <PawPrint size={28} />
              <span className="tray-side-label">切换动画</span>
            </button>
            {charMenuOpen && (
              <div className="tray-char-menu">
                {/* 左列：动图/图片 tab（左上角竖排）+ 主题按钮（左下角） */}
                <div className="tray-char-side">
                  <div className="tray-char-tabs">
                    <button
                      className={`tray-char-tab ${charTab === 'gif' ? 'is-active' : ''}`}
                      onClick={() => setCharTab('gif')}
                    >
                      动图
                    </button>
                    <button
                      className={`tray-char-tab ${charTab === 'img' ? 'is-active' : ''}`}
                      onClick={() => setCharTab('img')}
                    >
                      图片
                    </button>
                  </div>
                  <button className="tray-char-theme" onClick={() => window.api.switchTrayTheme()}>
                    主题
                  </button>
                </div>
                {/* 右区：角色滚动列表（点选即切换菜单栏 icon） */}
                <div className="tray-char-list">
                  {charItems.map((c) => (
                    <button
                      key={c.key}
                      className="tray-char-item"
                      onClick={() => switchCharacter(c.path)}
                    >
                      {c.dataUrl ? (
                        <img src={c.dataUrl} alt="" className="tray-char-thumb" />
                      ) : (
                        <span className="tray-char-thumb-empty" />
                      )}
                      <span>{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            className="tray-side-btn"
            title="活动监视器"
            onClick={() => window.api.openActivityMonitor()}
          >
            <Activity size={28} />
            <span className="tray-side-label">活动监视器</span>
          </button>
          <button
            className={`tray-side-btn ${view === 'more' ? 'is-active' : ''}`}
            title="更多"
            onClick={() => setView(view === 'more' ? 'dashboard' : 'more')}
          >
            <List size={28} />
            <span className="tray-side-label">更多</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/** 默认页：5 张系统信息卡（数据口径与业界通行面板一致） */
function SystemCards(props: {
  sysInfo: SystemInfo | null
  cpuHistory: number[]
}): React.JSX.Element {
  const { sysInfo, cpuHistory } = props
  const cpu = sysInfo?.cpu
  const memory = sysInfo?.memory
  const storage = sysInfo?.storage
  const battery = sysInfo?.battery
  const network = sysInfo?.network
  return (
    <div className="tray-cards">
      <div className="sys-card">
        <div className="sys-row">
          <Cpu size={28} className="sys-icon" />
          <div className="sys-main">
            <span className="sys-summary">CPU：{cpu ? fmtPct(cpu.percent) : '…'}</span>
            <div className="sys-details">
              <span>系统：{cpu ? fmtPct(cpu.system) : '…'}</span>
              <span>用户：{cpu ? fmtPct(cpu.user) : '…'}</span>
              <span>闲置：{cpu ? fmtPct(cpu.idle) : '…'}</span>
            </div>
          </div>
        </div>
        <CpuWave history={cpuHistory} />
      </div>

      <div className="sys-card">
        <div className="sys-row">
          <MemoryStick size={28} className="sys-icon" />
          <div className="sys-main">
            <span className="sys-summary">内存：{memory ? fmtPct(memory.percent) : '…'}</span>
            <div className="sys-details">
              <span>压力：{memory ? fmtPct(memory.pressure) : '…'}</span>
              <span>App 内存：{memory ? fmtBytes(memory.appBytes) : '…'}</span>
              <span>联动内存：{memory ? fmtBytes(memory.wiredBytes) : '…'}</span>
              <span>被压缩：{memory ? fmtBytes(memory.compressedBytes) : '…'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="sys-card">
        <div className="sys-row">
          <HardDrive size={28} className="sys-icon" />
          <div className="sys-main">
            <span className="sys-summary">
              储存：{storage ? fmtPct(storage.percent) : '…'}已使用
            </span>
            {storage && (
              <>
                <div className="sys-bar">
                  <div className="sys-bar-fill" style={{ width: `${storage.percent * 100}%` }} />
                </div>
                <div className="sys-details">
                  <span>
                    {fmtBytes(storage.usedBytes)} / {fmtBytes(storage.totalBytes)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="sys-card">
        <div className="sys-row">
          {battery?.charging ? (
            <BatteryCharging size={28} className="sys-icon" />
          ) : (
            <Battery size={28} className="sys-icon" />
          )}
          <div className="sys-main">
            <span className="sys-summary">
              电池：
              {!battery ? '…' : battery.installed ? fmtPct(battery.percent) : '未安装'}
            </span>
            {battery?.installed && (
              <div className="sys-details">
                <span>电源：{battery.charging ? battery.adapterName || '电源适配器' : '电池'}</span>
                <span>最大容量：{fmtPct(battery.maxCapacity)}</span>
                <span>循环计数：{battery.cycleCount}</span>
                <span>
                  温度：{battery.temperature > 0 ? `${battery.temperature.toFixed(1)}°C` : '…'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="sys-card">
        <div className="sys-row">
          <Wifi size={28} className="sys-icon" />
          <div className="sys-main">
            <span className="sys-summary">网络：{networkTypeName(network?.type)}</span>
            {network && (
              <div className="sys-details">
                <span>本地 IP：{network.ip || '…'}</span>
                <span>上传：{fmtSpeed(network.uploadBps)}</span>
                <span>下载：{fmtSpeed(network.downloadBps)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function networkTypeName(type?: string): string {
  switch (type) {
    case 'wifi':
      return 'Wi-Fi'
    case 'ethernet':
      return '以太网'
    case 'cellular':
      return '蜂窝网络'
    case 'loopback':
      return '回环'
    default:
      return '未连接'
  }
}

/** CPU 柱状波形图（同款蓝色波形：每 2s 一根柱子，30 根=1 分钟窗口） */
function CpuWave(props: { history: number[] }): React.JSX.Element {
  const { history } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    // accentColor 系统蓝：浅色 #007AFF、暗色 #0A84FF，读 CSS 变量
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--tray-accent')
      .trim()
    const barW = w / WAVE_POINTS - 2
    history.forEach((v, i) => {
      const bh = Math.max(2, v * (h - 2))
      const x = i * (barW + 2)
      ctx.fillStyle = accent || '#0A84FF'
      ctx.fillRect(x, h - bh, barW, bh)
    })
  }, [history])

  return <canvas ref={canvasRef} className="sys-wave" />
}

/** 项目状态页：顶部运行计数 + 网页/服务两组只读列表 + 底部打开主窗口 */
function ProjectsView(props: {
  runningCount: number
  webProjects: Project[]
  serviceProjects: Project[]
  statuses: Record<string, ProjectStatusEvent>
  onOpen: (p: Project) => void
}): React.JSX.Element {
  const { runningCount, webProjects, serviceProjects, statuses, onOpen } = props
  return (
    <div className="tray-projects">
      <div className="tray-projects-count">
        <span className="tray-projects-dot" />
        {runningCount} 个运行中
      </div>
      <div className="tray-projects-list">
        {webProjects.length + serviceProjects.length === 0 ? (
          <div className="tray-empty">还没有项目。打开 Reopen 拖入你的项目吧。</div>
        ) : (
          <>
            {webProjects.length > 0 && (
              <div className="tray-group">
                <div className="tray-group-title">网页</div>
                {webProjects.map((p) => (
                  <ProjectRow key={p.id} p={p} statuses={statuses} onOpen={onOpen} />
                ))}
              </div>
            )}
            {serviceProjects.length > 0 && (
              <div className="tray-group">
                <div className="tray-group-title">服务</div>
                {serviceProjects.map((p) => (
                  <ProjectRow key={p.id} p={p} statuses={statuses} onOpen={onOpen} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div className="tray-foot">
        <button className="tray-foot-btn" onClick={() => window.api.showMainWindow()}>
          打开主窗口
        </button>
      </div>
    </div>
  )
}

/** 项目行（只读：点行在浏览器打开，不在面板启停） */
function ProjectRow(props: {
  p: Project
  statuses: Record<string, ProjectStatusEvent>
  onOpen: (p: Project) => void
}): React.JSX.Element {
  const { p, statuses, onOpen } = props
  const st = statuses[p.id]?.status ?? 'stopped'
  const port = statuses[p.id]?.port ?? p.port
  return (
    <div
      className={`tray-item ${st === 'failed' ? 'tray-item-failed' : ''}`}
      title={st === 'failed' ? statuses[p.id]?.reason : undefined}
      onClick={() => onOpen(p)}
    >
      <span className={`status-dot dot-${st}`} />
      <span className="tray-item-icon">
        {p.type === 'service' ? <Folder size={13} /> : <FileCode2 size={13} />}
      </span>
      <span className="tray-item-name">{p.name}</span>
      <span className="tray-item-port">{port ? `:${port}` : ''}</span>
      <ExternalLink size={13} className="tray-item-action" />
    </div>
  )
}

/** 更多页（更多菜单内容：返回/关于/帮助/反馈问题/退出） */
function MoreView(props: { onNavigate: (v: PanelView) => void }): React.JSX.Element {
  const { onNavigate } = props
  const GITHUB = 'https://github.com/JoshuaMi449/Reopen'
  return (
    <div className="tray-more">
      <button className="tray-more-row" onClick={() => onNavigate('dashboard')}>
        <ArrowLeft size={14} />
        <span>返回</span>
      </button>
      <button className="tray-more-row" onClick={() => onNavigate('about')}>
        <Info size={14} />
        <span>关于 Reopen</span>
      </button>
      <button className="tray-more-row" onClick={() => window.api.showMainWindow('check-update')}>
        <RefreshCw size={14} />
        <span>检查更新</span>
      </button>
      <button className="tray-more-row" onClick={() => window.api.openExternal(`${GITHUB}#readme`)}>
        <ExternalLink size={14} />
        <span>帮助</span>
      </button>
      <button className="tray-more-row" onClick={() => window.api.openExternal(`${GITHUB}/issues`)}>
        <Gauge size={14} />
        <span>反馈问题</span>
      </button>
      <button className="tray-more-row" onClick={() => window.api.quitApp()}>
        <Power size={14} />
        <span>退出 Reopen</span>
      </button>
    </div>
  )
}

/** 关于页（关于弹窗布局：图标+名字+版本、简介、版权） */
function AboutView(props: { onBack: () => void }): React.JSX.Element {
  const { onBack } = props
  return (
    <div className="tray-about">
      <button className="tray-about-back" onClick={onBack}>
        <ArrowLeft size={13} />
        <span>返回</span>
      </button>
      <div className="tray-about-body">
        <div className="tray-about-logo">
          <img
            className="tray-projects-img tray-projects-img-light"
            src={trayProjectsLight}
            alt=""
            draggable={false}
          />
          <img
            className="tray-projects-img tray-projects-img-dark"
            src={trayProjectsDark}
            alt=""
            draggable={false}
          />
        </div>
        <div className="tray-about-name">Reopen</div>
        <div className="tray-about-version">版本 1.0.2</div>
        <div className="tray-about-desc">
          本地项目启动器：一键复活你的开发服务。 菜单栏常驻，端口状态一目了然，退出即止。
        </div>
        <div className="tray-about-copy">© 2026 HanYu</div>
      </div>
    </div>
  )
}
