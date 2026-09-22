import { useEffect, useMemo, useState } from 'react'
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
  BatteryHistorySample,
  Project,
  ProjectStatusEvent,
  SystemHistorySample,
  SystemInfo,
  TrayCharacterItem
} from '../../../shared/types'
import { projectCategory } from '../../../shared/types'
import wordmark from '../assets/wordmark.png'
// 「查看项目状态」格子的菜单栏 logo 素材（用户提供：黑=浅色系统用，白=暗色系统用，CSS 随系统切换）
import trayProjectsLight from '../assets/tray-projects-light.png'
import trayProjectsDark from '../assets/tray-projects-dark.png'

/** 面板三视图：系统信息卡（默认）/ 项目状态 / 更多菜单；关于是更多里的子页 */
type PanelView = 'dashboard' | 'projects' | 'more' | 'about'
import { HISTORY_COLUMNS, historyColumns, normalizeHistoryRange, type HistoryKind } from '../../../shared/historyRanges'

/** CPU 历史面积图：每 2 秒一个真实采样，保留最近 1 分钟。 */
const CPU_HISTORY_POINTS = 30

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

function memoryAvailableBytes(memory?: SystemHistorySample['memory']): number {
  if (!memory) return 0
  if (Number.isFinite(memory.availableBytes)) return Math.max(0, memory.availableBytes ?? 0)
  const used = memory.appBytes + memory.wiredBytes + memory.compressedBytes
  if (memory.percent <= 0 || memory.percent >= 1) return memory.percent <= 0 ? 0 : used * (1 / memory.percent - 1)
  return Math.max(0, used * (1 / memory.percent - 1))
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
  const [sampledAt, setSampledAt] = useState(() => Date.now())
  const [systemHistory, setSystemHistory] = useState<SystemHistorySample[]>([])
  const [historyKind, setHistoryKind] = useState<HistoryKind | null>(null)

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
      const now = Date.now()
      setSampledAt(now)
      setSysInfo(s)
      setSystemHistory((current) => {
        const saved = s.systemHistory ?? []
        const savedEnd = saved.at(-1)?.time ?? 0
        const live = current.filter(
          (sample) => sample.time > savedEnd && sample.time >= now - 10 * 60_000
        )
        return [...saved, ...live]
      })
    })
    const offLog = window.api.onLog(() => {
      // 面板不显示日志，忽略
    })
    // 面板每次弹出前重置回默认界面（上次停留的项目列表/更多页/弹菜单不残留）
    const offReset = window.api.onTrayResetView(() => {
      setView('dashboard')
      setCharMenuOpen(false)
      setHistoryKind(null)
    })
    return () => {
      offStatus()
      offSys()
      offLog()
      offReset()
    }
  }, [])

  useEffect(() => {
    void window.api.setTrayHistoryExpanded(historyKind !== null, historyKind ?? undefined)
  }, [historyKind])

  useEffect(() => window.api.onTrayHistoryClosed(() => setHistoryKind(null)), [])

  const charItems = useMemo(
    () => characters.filter((c) => (charTab === 'gif' ? c.isGif : !c.isGif)),
    [characters, charTab]
  )

  const runningCount = useMemo(
    () => Object.values(statuses).filter((s) => s.status === 'running').length,
    [statuses]
  )

  const webProjects = useMemo(
    () => projects.filter((p) => projectCategory(p) === 'web'),
    [projects]
  )
  const serviceProjects = useMemo(
    () => projects.filter((p) => projectCategory(p) === 'service'),
    [projects]
  )

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
          {view === 'dashboard' && (
            <SystemCards
              sysInfo={sysInfo}
              systemHistory={systemHistory}
              sampledAt={sampledAt}
              onOpenHistory={setHistoryKind}
            />
          )}
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
  systemHistory: SystemHistorySample[]
  sampledAt: number
  onOpenHistory: (kind: HistoryKind) => void
}): React.JSX.Element {
  const { sysInfo, systemHistory, sampledAt, onOpenHistory } = props
  const cpu = sysInfo?.cpu
  const memory = sysInfo?.memory
  const storage = sysInfo?.storage
  const battery = sysInfo?.battery
  const network = sysInfo?.network
  return (
    <div className="tray-cards">
      <div className="sys-card sys-card-interactive" onClick={() => onOpenHistory('cpu')}>
        <div className="sys-row">
          <Cpu size={28} className="sys-icon" />
          <div className="sys-main">
            <span className="sys-summary">CPU：{cpu ? fmtPct(cpu.percent) : '…'}</span>
            <div className="metric-history-row">
              <div className="sys-details">
                <span className="metric-system">系统：{cpu ? fmtPct(cpu.system) : '…'}</span>
                <span className="metric-user">用户：{cpu ? fmtPct(cpu.user) : '…'}</span>
                <span className="metric-idle">空闲：{cpu ? fmtPct(cpu.idle) : '…'}</span>
              </div>

              <button
                className="metric-graph-button"
                title="查看 CPU 历史"
                onClick={() => onOpenHistory('cpu')}
              >
                <CpuAreaGraph history={systemHistory} end={sampledAt} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="sys-card sys-card-interactive" onClick={() => onOpenHistory('memory')}>
        <div className="sys-row">
          <MemoryStick size={28} className="sys-icon" />
          <div className="sys-main">
            <div className="memory-breakdown">
              {([
                ['App内存', 'var(--theme-memory-app, #007aff)', memory?.appBytes],
                ['联动内存', 'var(--theme-memory-wired, #f346a2)', memory?.wiredBytes],
                ['已压缩', 'var(--theme-memory-compressed, #ffcc00)', memory?.compressedBytes],
                ['可用', 'var(--theme-memory-available, #5b5b60)', memory?.availableBytes]
              ] as const).map(([label, color, bytes]) => (
                <div className="memory-breakdown-row" key={label}>
                  <i style={{ backgroundColor: color }} />
                  <span>{label}</span>
                  <strong>{bytes === undefined ? '…' : fmtBytes(bytes)}</strong>
                </div>
              ))}
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

      <div className="sys-card sys-card-interactive" onClick={() => onOpenHistory('battery')}>
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
              <div className="metric-history-row">
                <div className="sys-details">
                  <span>电源：{battery.adapterName || battery.charging ? '适配器' : '电池'}</span>
                  <span>最大容量：{fmtPct(battery.maxCapacity)}</span>
                  <span>循环计数：{battery.cycleCount}</span>
                  <span>
                    温度：{battery.temperature > 0 ? `${battery.temperature.toFixed(1)}°C` : '…'}
                  </span>
                </div>
                <button
                  className="metric-graph-button"
                  title="查看电源历史"
                  onClick={() => onOpenHistory('battery')}
                >
                  <BatteryGraph history={sysInfo?.batteryHistory ?? []} end={sampledAt} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="sys-card sys-card-interactive" onClick={() => onOpenHistory('network')}>
        <div className="sys-row">
          <Wifi size={28} className="sys-icon" />
          <div className="sys-main">
            <span className="sys-summary">网络：{networkTypeName(network?.type)}</span>
            {network && (
              <div className="sys-details">
                <span>本地 IP：{network.ip || '…'}</span>
                <div className="network-history-row">
                  <div className="network-rates">
                    <span className="metric-upload">上传：{fmtSpeed(network.uploadBps)}</span>
                    <span className="metric-download">下载：{fmtSpeed(network.downloadBps)}</span>
                  </div>
                  <button
                    className="metric-graph-button"
                    title="查看网络历史"
                    onClick={() => onOpenHistory('network')}
                  >
                    <NetworkGraph history={systemHistory} end={sampledAt} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function BatteryGraph({ history, end }: { history: BatteryHistorySample[]; end: number }): React.JSX.Element {
  // The compact graph is a literal crop of the default one-hour detail graph.
  const buckets = batteryBuckets(
    bucketHistory(history, end, 60, BATTERY_BUCKETS, averageBattery)
  ).slice(-CPU_HISTORY_POINTS)
  const intervals: { start: number; end: number; plugged: boolean; charging: boolean }[] = []
  buckets.forEach((bucket, i) => {
    if (!bucket.value) return
    const previous = intervals.at(-1)
    if (
      previous &&
      previous.end === i &&
      previous.plugged === bucket.value.plugged
    )
      previous.end = i + 1
    else
      intervals.push({
        start: i,
        end: i + 1,
        plugged: bucket.value.plugged,
        charging: bucket.value.charging
      })
  })
  return (
    <svg
      className="battery-wave"
      viewBox="0 0 90 70"
      role="img"
      aria-label="两小时电量历史与接电区间"
    >
      <title>
        最近两小时 ·
        柱高为电量百分比；蓝色接电，粉色使用电池；底部蓝条为接电区间，闪电表示正在充电。空白为未记录。
      </title>
      {buckets.map((bucket, i) =>
        bucket.value ? (
          <rect
            key={bucket.time}
            x={i * 3}
            y={53 - bucket.value.percent * 50}
            width="2"
            height={Math.max(1, bucket.value.percent * 50)}
            fill={bucket.value.plugged ? 'var(--theme-battery-adapter, #007aff)' : 'var(--theme-battery-battery, #f346a2)'}
          />
        ) : (
          <MissingBar key={bucket.time} x={i * 3} baseline={52} />
        )
      )}
      {intervals
        .map((range, i) => (
          <g key={i}>
            <rect
              x={range.start * 3}
              y="58"
              width={(range.end - range.start) * 3}
              height="8"
              rx="0"
              fill={range.plugged ? "var(--theme-battery-adapter, #007aff)" : "var(--theme-battery-battery, #f346a2)"}
            />
            {range.plugged && range.end - range.start >= 4 && (
              <path
                transform={`translate(${(range.start + range.end) * 1.5 - 4},55)`}
                d="M6 0 L0 8 H4 L2 15 L10 5 H6 Z"
                fill="white"
                stroke="#303137"
                strokeWidth="1"
              />
            )}
          </g>
        ))}
    </svg>
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

function CpuAreaGraph({ history, end }: { history: SystemHistorySample[]; end: number }): React.JSX.Element {
  // Build the same fixed ten-minute buckets used by the detail graph, then show its tail.
  const allBuckets = carryHistoryBuckets(
    bucketHistory(history, end, 0.5, CPU_HISTORY_POINTS, averageSystem)
  )
  const buckets = allBuckets.slice(-CPU_HISTORY_POINTS)
  const fallback = allBuckets.find((bucket) => bucket.value)?.value
  return (
    <svg
      className="sys-wave"
      viewBox="0 0 90 48"
      role="img"
      aria-label="CPU 历史：用户、系统、空闲"
    >
      <title>最近 30 秒 · 用户 / 系统 / 空闲 · 纵轴 0–100%</title>
      <line x1="0" x2="90" y1="47.5" y2="47.5" stroke="var(--cpu-user)" strokeWidth="1" />
      {buckets.map((bucket, i) => {
        if (!bucket.value)
          return (
            <MissingBar
              key={bucket.time}
              x={i * 3}
              baseline={48}
              height={fallback ? Math.max(1, (fallback.cpu.user + fallback.cpu.system) * 47) : 1}
              color="var(--cpu-user)"
            />
          )
        const user = Math.max(0, Math.min(1, bucket.value.cpu.user) * 47)
        const system = Math.max(
          0,
          Math.min(1 - bucket.value.cpu.user, bucket.value.cpu.system) * 47
        )
        return (
          <g key={bucket.time}>
            <rect x={i * 3} y="1" width="2" height={Math.max(0,47-user-system)} fill="var(--theme-cpu-idle, #66666b)" />
            <rect x={i * 3} y={48 - user} width="2" height={user} fill="var(--cpu-user)" />
            <rect
              x={i * 3}
              y={48 - user - system}
              width="2"
              height={system}
              fill="var(--cpu-system)"
            />
          </g>
        )
      })}
    </svg>
  )
}

function NetworkGraph({ history, end }: { history: SystemHistorySample[]; end: number }): React.JSX.Element {
  const saved = Number(localStorage.getItem('reopen-history-range-network'))
  const minutes = normalizeHistoryRange('network', saved)
  const buckets = carryHistoryBuckets(
    bucketHistory(history, end, minutes, SYSTEM_BUCKETS, averageSystem)
  )
  return <LargeNetworkGraph buckets={buckets} activeIndex={null} onMove={() => {}} compact />
}

const SYSTEM_BUCKETS = HISTORY_COLUMNS
const BATTERY_BUCKETS = HISTORY_COLUMNS
const LARGE_GRAPH_HEIGHT = 180
// Detail percentages span the full plot; bar width stays two CSS pixels.
const PERCENT_PLOT_HEIGHT = 167

interface HistoryBucket<T> {
  time: number
  value?: T
}

function bucketHistory<T extends { time: number }>(
  history: T[],
  end: number,
  minutes: number,
  count: number,
  merge: (items: T[]) => T
): HistoryBucket<T>[] {
  const duration = minutes * 60_000
  const bucketMs = duration / count
  // Render completed, wall-clock-aligned intervals only.
  const boundary = Math.floor(end / bucketMs) * bucketMs
  const start = boundary - duration
  const grouped = Array.from({ length: count }, () => [] as T[])
  for (const sample of history) {
    if (sample.time < start) continue
    if (sample.time >= boundary) continue
    const index = Math.min(count - 1, Math.floor((sample.time - start) / bucketMs))
    if (index >= 0) grouped[index].push(sample)
  }
  return grouped.map((items, index) => ({
    time: start + index * bucketMs,
    value: items.length > 0 ? merge(items) : undefined
  }))
}

/** System monitors treat a sample as current until the next sample arrives. Carrying it
 * through fixed buckets keeps the graph continuous without inventing history before
 * the first observation. */
function carryHistoryBuckets<T extends { time: number }>(
  buckets: HistoryBucket<T>[]
): HistoryBucket<T>[] {
  return buckets
}

/** Battery level and power source are continuous states. Preserve the last known
 * state through internal recording gaps so reopening Reopen does not punch holes
 * into an otherwise continuous battery timeline. */
function batteryBuckets(buckets: HistoryBucket<BatteryHistorySample>[]): HistoryBucket<BatteryHistorySample>[] {
  let previous: BatteryHistorySample | undefined
  return buckets.map((bucket) => {
    if (bucket.value) { previous = bucket.value; return bucket }
    if (previous && bucket.time >= previous.time) return { ...bucket, value: previous }
    return bucket
  })
}

function averageSystem(items: SystemHistorySample[]): SystemHistorySample {
  const sum = items.reduce(
    (total, item) => ({
      cpuPercent: total.cpuPercent + item.cpu.percent,
      cpuSystem: total.cpuSystem + item.cpu.system,
      cpuUser: total.cpuUser + item.cpu.user,
      cpuIdle: total.cpuIdle + item.cpu.idle,
      memoryPercent: total.memoryPercent + (item.memory?.percent ?? 0),
      memoryPressure: total.memoryPressure + (item.memory?.pressure ?? 0),
      appBytes: total.appBytes + (item.memory?.appBytes ?? 0),
      wiredBytes: total.wiredBytes + (item.memory?.wiredBytes ?? 0),
      compressedBytes: total.compressedBytes + (item.memory?.compressedBytes ?? 0),
      availableBytes: total.availableBytes + memoryAvailableBytes(item.memory),
      download: total.download + item.network.downloadBps,
      upload: total.upload + item.network.uploadBps
    }),
    {
      cpuPercent: 0,
      cpuSystem: 0,
      cpuUser: 0,
      cpuIdle: 0,
      memoryPercent: 0,
      memoryPressure: 0,
      appBytes: 0,
      wiredBytes: 0,
      compressedBytes: 0,
      availableBytes: 0,
      download: 0,
      upload: 0
    }
  )
  const n = items.length
  const memoryN = items.filter((item) => item.memory).length
  return {
    time: items.at(-1)?.time ?? 0,
    cpu: {
      percent: sum.cpuPercent / n,
      system: sum.cpuSystem / n,
      user: sum.cpuUser / n,
      idle: sum.cpuIdle / n
    },
    memory:
      memoryN > 0
        ? {
            percent: sum.memoryPercent / memoryN,
            pressure: sum.memoryPressure / memoryN,
            appBytes: sum.appBytes / memoryN,
            wiredBytes: sum.wiredBytes / memoryN,
            compressedBytes: sum.compressedBytes / memoryN,
            availableBytes: sum.availableBytes / memoryN
          }
        : undefined,
    network: { downloadBps: sum.download / n, uploadBps: sum.upload / n }
  }
}

function averageBattery(items: BatteryHistorySample[]): BatteryHistorySample {
  const pluggedCount = items.filter((item) => item.plugged).length
  return {
    time: items.at(-1)?.time ?? 0,
    percent: items.reduce((sum, item) => sum + item.percent, 0) / items.length,
    plugged: pluggedCount >= items.length / 2,
    charging: items.some((item) => item.charging)
  }
}

function rangeName(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes < 1440) return `${minutes / 60} 小时`
  return `${minutes / 1440} 天`
}

/** 点击总览中的图表后显示完整历史；采样由主进程每分钟落盘，关闭面板也不会丢失。 */
function HistoryDetail(props: {
  kind: HistoryKind
  systemHistory: SystemHistorySample[]
  batteryHistory: BatteryHistorySample[]
  network?: SystemInfo['network']
}): React.JSX.Element {
  const { kind, systemHistory, batteryHistory, network } = props
  const [minutes, setMinutes] = useState<number>(() => {
    const saved = Number(localStorage.getItem(`reopen-history-range-${kind}`))
    return normalizeHistoryRange(kind, saved)
  })
  useEffect(() => { localStorage.setItem(`reopen-history-range-${kind}`, String(minutes)) }, [kind, minutes])
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  // Advance on the sampling cadence, never on pointer-driven renders.
  const [end, setEnd] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setEnd(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const title =
    kind === 'cpu' ? 'CPU' : kind === 'memory' ? '内存' : kind === 'network' ? '网络' : '电池'
  const buckets = useMemo(() => {
    const columns = historyColumns(minutes)
    const raw = kind === 'battery'
      ? bucketHistory(batteryHistory, end, minutes, columns, averageBattery)
      : bucketHistory(systemHistory, end, minutes, columns, averageSystem)
    return kind === 'battery' ? batteryBuckets(raw as HistoryBucket<BatteryHistorySample>[]) : raw
  }, [kind, batteryHistory, systemHistory, end, minutes])
  const onChartMove = (event: React.MouseEvent<SVGSVGElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHoverIndex(
      Math.min(
        buckets.length - 1,
        Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * buckets.length))
      )
    )
  }
  const hovered = hoverIndex === null ? null : buckets[hoverIndex]
  const tooltipLeft =
    hoverIndex === null ? 30 : Math.min(270, Math.max(20, 37 + hoverIndex * 3 - 50))
  return (
    <section className={`tray-history-detail history-${kind}`} aria-label={`${title}历史`}>
      <div className="tray-history-head">
        <strong>{title}</strong>
        <button className="history-range-button" aria-label="历史范围" aria-haspopup="menu"
          onClick={async () => {
            const selected = await window.api.showHistoryRangeMenu(kind, minutes)
            if (selected !== null) { setMinutes(selected); setHoverIndex(null) }
          }}>
          {rangeName(minutes)}⌃
        </button>
      </div>
      {kind === 'cpu' && (
        <LargeCpuGraph
          buckets={buckets as HistoryBucket<SystemHistorySample>[]}
          activeIndex={hoverIndex}
          onMove={onChartMove}
        />
      )}
      {kind === 'memory' && (
        <LargeMemoryGraph
          buckets={buckets as HistoryBucket<SystemHistorySample>[]}
          activeIndex={hoverIndex}
          onMove={onChartMove}
        />
      )}
      {kind === 'network' && (
        <LargeNetworkGraph
          buckets={buckets as HistoryBucket<SystemHistorySample>[]}
          activeIndex={hoverIndex}
          onMove={onChartMove}
        />
      )}
      {kind === 'battery' && (
        <LargeBatteryGraph
          buckets={buckets as HistoryBucket<BatteryHistorySample>[]}
          activeIndex={hoverIndex}
          onMove={onChartMove}
        />
      )}
      {hovered?.value && (
        <div className="history-tooltip" style={{ left: tooltipLeft }}>
          <b>
            {new Date(hovered.time).toLocaleString('zh-CN', {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </b>
          {kind === 'cpu' && (
            <span>
              <i style={{ color: 'var(--cpu-system)' }}>●</i> 系统 {fmtPct((hovered.value as SystemHistorySample).cpu.system)}
              <br /><i style={{ color: 'var(--cpu-user)' }}>●</i> 用户 {fmtPct((hovered.value as SystemHistorySample).cpu.user)}
              <br /><i style={{ color: 'var(--theme-cpu-idle)' }}>●</i> 空闲 {fmtPct((hovered.value as SystemHistorySample).cpu.idle)}
            </span>
          )}
          {kind === 'memory' && (
            <span>
              <i style={{color: 'var(--theme-memory-app, #007aff)'}}>●</i> App内存 {fmtBytes((hovered.value as SystemHistorySample).memory?.appBytes ?? 0)}
              <br /><i style={{color: 'var(--theme-memory-wired, #f346a2)'}}>●</i> 联动内存 {fmtBytes((hovered.value as SystemHistorySample).memory?.wiredBytes ?? 0)}
              <br /><i style={{color: 'var(--theme-memory-compressed, #ffcc00)'}}>●</i> 已压缩 {fmtBytes((hovered.value as SystemHistorySample).memory?.compressedBytes ?? 0)}
              <br /><i style={{color: 'var(--theme-memory-available, #5b5b60)'}}>●</i> 可用 {fmtBytes(memoryAvailableBytes((hovered.value as SystemHistorySample).memory))}
            </span>
          )}
          {kind === 'network' && (
            <span>
              <i style={{ color: 'var(--net-upload)' }}>●</i> ↑ {fmtSpeed((hovered.value as SystemHistorySample).network.uploadBps)}
              <br /><i style={{ color: 'var(--net-download)' }}>●</i> ↓ {fmtSpeed((hovered.value as SystemHistorySample).network.downloadBps)}
            </span>
          )}
          {kind === 'battery' && (
            <span><i style={{color:(hovered.value as BatteryHistorySample).plugged ? 'var(--theme-battery-adapter, #007aff)' : 'var(--theme-battery-battery, #f346a2)'}}>●</i> 数值 {fmtPct((hovered.value as BatteryHistorySample).percent)}</span>
          )}
        </div>
      )}
      {kind === 'network' && (
        <div className="history-legend history-network-legend">
          <span className="legend-upload"><i style={{color: "var(--net-upload)", fontStyle: "normal"}}>●</i> 上传</span>
          <strong>{network ? fmtSpeed(network.uploadBps) : '…'}</strong>
          <span className="legend-download"><i style={{color: "var(--net-download)", fontStyle: "normal"}}>●</i> 下载</span>
          <strong>{network ? fmtSpeed(network.downloadBps) : '…'}</strong>
        </div>
      )}
    </section>
  )
}

// Missing observations remain blank; they are neither zero nor a held previous value.
function MissingBar(_props: { x: number; baseline: number; height?: number; color?: string }): null {
  void _props
  return null
}

function CursorLine({ index, height = LARGE_GRAPH_HEIGHT, stride = 3 }: { index: number | null; height?: number; stride?: number }): React.JSX.Element | null {
  if (index === null) return null
  const x = index * stride + 1
  return <line x1={x} x2={x} y1="0" y2={height} className="history-cursor" />
}

interface LargeGraphProps<T> {
  buckets: HistoryBucket<T>[]
  activeIndex: number | null
  onMove: (event: React.MouseEvent<SVGSVGElement>) => void
}

function LargeCpuGraph({
  buckets,
  activeIndex,
  onMove
}: LargeGraphProps<SystemHistorySample>): React.JSX.Element {
  const fallback = buckets.find((bucket) => bucket.value)?.value
  return (
    <svg
      className="large-history-chart"
      viewBox={`0 0 ${360} ${PERCENT_PLOT_HEIGHT}`}
      onMouseMove={onMove}
    >
      {buckets.map((bucket, i) => {
        if (!bucket.value) {
          const height = fallback
            ? Math.max(2, Math.min(1, fallback.cpu.user + fallback.cpu.system) * PERCENT_PLOT_HEIGHT)
            : 1
          return (
            <MissingBar
              key={bucket.time}
              x={i * (360 / buckets.length)}
              baseline={PERCENT_PLOT_HEIGHT}
              height={height}
              color="var(--cpu-user)"
            />
          )
        }
        const user = Math.max(0, Math.min(1, bucket.value.cpu.user) * PERCENT_PLOT_HEIGHT)
        const system = Math.max(
          0,
          Math.min(1 - bucket.value.cpu.user, bucket.value.cpu.system) * PERCENT_PLOT_HEIGHT
        )
        return (
          <g key={bucket.time}>
            <rect x={i * (360 / buckets.length)} y="0" width="2" height={Math.max(0,PERCENT_PLOT_HEIGHT-user-system)} fill="var(--theme-cpu-idle, #66666b)" />
            <rect x={i * (360 / buckets.length)} y={PERCENT_PLOT_HEIGHT - user} width="2" height={user} fill="var(--cpu-user)" />
            <rect
              x={i * (360 / buckets.length)}
              y={PERCENT_PLOT_HEIGHT - user - system}
              width="2"
              height={system}
              fill="var(--cpu-system)"
            />
          </g>
        )
      })}
      <CursorLine index={activeIndex} height={PERCENT_PLOT_HEIGHT} stride={360 / buckets.length} />
    </svg>
  )
}

function LargeMemoryGraph({ buckets, activeIndex, onMove }: LargeGraphProps<SystemHistorySample>): React.JSX.Element {
  const fallback = buckets.find((bucket) => bucket.value?.memory)?.value?.memory
  return (
    <svg className="large-history-chart" viewBox={`0 0 360 ${PERCENT_PLOT_HEIGHT}`} onMouseMove={onMove}>
      {buckets.map((bucket, i) => {
        const memory = bucket.value?.memory
        const x = i * (360 / buckets.length)
        if (!memory) return <MissingBar key={bucket.time} x={x} baseline={PERCENT_PLOT_HEIGHT} height={fallback ? fallback.percent * PERCENT_PLOT_HEIGHT : 1} color="var(--theme-memory-app, #007aff)" />
        const used = memory.appBytes + memory.wiredBytes + memory.compressedBytes
        const availableBytes = memoryAvailableBytes(memory)
        const total = used + availableBytes
        const scale = total > 0 ? PERCENT_PLOT_HEIGHT / total : 0
        const app = memory.appBytes * scale
        const wired = memory.wiredBytes * scale
        const compressed = memory.compressedBytes * scale
        const available = Math.max(0, PERCENT_PLOT_HEIGHT - app - wired - compressed)
        return <g key={bucket.time}>
          <rect x={x} y="0" width="2" height={available} fill="var(--theme-memory-available, #5b5b60)" />
          <rect x={x} y={PERCENT_PLOT_HEIGHT - app} width="2" height={app} fill="var(--theme-memory-app, #007aff)" />
          <rect x={x} y={PERCENT_PLOT_HEIGHT - app - wired} width="2" height={wired} fill="var(--theme-memory-wired, #f346a2)" />
          <rect x={x} y={PERCENT_PLOT_HEIGHT - app - wired - compressed} width="2" height={compressed} fill="var(--theme-memory-compressed, #ffcc00)" />
        </g>
      })}
      <CursorLine index={activeIndex} height={PERCENT_PLOT_HEIGHT} stride={360 / buckets.length} />
    </svg>
  )
}

function LargeNetworkGraph({
  buckets,
  activeIndex,
  onMove,
  compact = false
}: LargeGraphProps<SystemHistorySample> & { compact?: boolean }): React.JSX.Element {
  const uploadCeiling = Math.max(1, ...buckets.map((b) => b.value?.network.uploadBps ?? 0))
  const downloadCeiling = Math.max(1, ...buckets.map((b) => b.value?.network.downloadBps ?? 0))
  return (
    <svg
      className={compact ? "network-wave network-history-crop" : "large-history-chart"}
      viewBox={compact ? "270 57.5 90 34" : "0 0 360 149"}
      onMouseMove={onMove}
    >
      <line x1="0" x2={360} y1="74.5" y2="74.5" className="history-baseline" />
      {buckets.map((bucket, i) => {
        if (!bucket.value) return null
        const up = Math.max(
          1,
          (bucket.value.network.uploadBps / uploadCeiling) * 74.5
        )
        const down = Math.max(
          1,
          (bucket.value.network.downloadBps / downloadCeiling) * 74.5
        )
        return (
          <g key={bucket.time}>
            <rect x={i * (360 / buckets.length)} y={74.5 - up} width="2" height={up} fill="var(--net-upload)" />
            <rect x={i * (360 / buckets.length)} y="74.5" width="2" height={down} fill="var(--net-download)" />
          </g>
        )
      })}
      <CursorLine index={activeIndex} height={149} stride={360 / buckets.length} />
    </svg>
  )
}

function LargeBatteryGraph({
  buckets,
  activeIndex,
  onMove
}: LargeGraphProps<BatteryHistorySample>): React.JSX.Element {
  const fallback = buckets.find((bucket) => bucket.value)?.value
  const ranges: { start: number; end: number; plugged: boolean; charging: boolean }[] = []
  buckets.forEach((bucket, index) => {
    if (!bucket.value) return
    const previous = ranges.at(-1)
    if (
      previous &&
      previous.end === index &&
      previous.plugged === bucket.value.plugged
    )
      previous.end = index + 1
    else
      ranges.push({
        start: index,
        end: index + 1,
        plugged: bucket.value.plugged,
        charging: bucket.value.charging
      })
  })
  return (
    <svg
      className="large-history-chart battery-history-chart"
      viewBox={`0 0 ${buckets.length * 3} ${147}`}
      onMouseMove={onMove}
    >
      {buckets.map((bucket, i) =>
        bucket.value ? (
          <rect
            key={bucket.time}
            x={i * 3}
            y={135 - Math.max(0, Math.min(1, bucket.value.percent)) * 130}
            width="2"
            height={Math.max(1, Math.max(0, Math.min(1, bucket.value.percent)) * 130)}
            fill={bucket.value.plugged ? 'var(--theme-battery-adapter, #007aff)' : 'var(--theme-battery-battery, #f346a2)'}
          />
        ) : (
          <MissingBar
            key={bucket.time}
            x={i * 3}
            baseline={135}
            height={fallback ? Math.max(1, fallback.percent * 130) : 1}
            color={fallback?.plugged ? 'var(--theme-battery-adapter, #007aff)' : 'var(--theme-battery-battery, #f346a2)'}
          />
        )
      )}
      {ranges
        .map((range) => (
          <rect
            key={`${range.start}-${range.end}`}
            x={range.start * 3}
            y="139"
            width={(range.end - range.start) * 3}
            height="8"
            rx="0"
            fill={range.plugged ? "var(--theme-battery-adapter, #007aff)" : "var(--theme-battery-battery, #f346a2)"}
          />
        ))}
      {ranges
        .filter((range) => range.plugged && range.end - range.start >= 4)
        .map((range) => (
          <path key={`bolt-${range.start}`}
            transform={`translate(${(range.start + range.end) * 1.5 - 5}, 136)`}
            d="M7 0 L0 8 L4 8 L2 14 L10 5 L6 5 Z"
            fill="white" stroke="#303136" strokeWidth="0.8" />
        ))}
      <CursorLine index={activeIndex} height={135} />
    </svg>
  )
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
        {projectCategory(p) === 'service' ? <Folder size={13} /> : <FileCode2 size={13} />}
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
        <div className="tray-about-version">版本 1.1.0</div>
        <div className="tray-about-desc">
          本地项目启动器：一键复活你的开发服务。 菜单栏常驻，端口状态一目了然，退出即止。
        </div>
        <div className="tray-about-copy">© 2026 HanYu</div>
      </div>
    </div>
  )
}

export function TrayHistoryWindow(): React.JSX.Element {
  const requested = new URLSearchParams(location.search).get('history')
  const kind: HistoryKind =
    requested === 'battery' || requested === 'network' || requested === 'memory' ? requested : 'cpu'
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [history, setHistory] = useState<SystemHistorySample[]>([])
  useEffect(
    () =>
      window.api.onSystemInfo((sample) => {
        setInfo(sample)
        setHistory(sample.systemHistory ?? [])
      }),
    []
  )
  return (
    <div className="tray-history-window">
      <HistoryDetail
        kind={kind}
        network={info?.network}
        systemHistory={history}
        batteryHistory={info?.batteryHistory ?? []}
      />
    </div>
  )
}
