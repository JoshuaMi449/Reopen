import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ExternalLink,
  FolderOpen,
  FolderSearch,
  Group,
  MonitorPause,
  MonitorPlay,
  Palette,
  Pencil,
  Tag,
  Trash2,
  Ungroup,
  Zap
} from 'lucide-react'
import type {
  DetectMulti,
  DetectNeedParseApp,
  DetectOutcome,
  DetectSuccess,
  NewProjectInput,
  Project,
  ProjectLogEvent,
  ProjectStatusEvent,
  Settings,
  UpdateInfo
} from '../../shared/types'
import { DEFAULT_SETTINGS, isPureWeb } from '../../shared/types'
import { AutoStartPanel } from './components/AutoStartPanel'
import { BulkTagModal } from './components/BulkTagModal'
import { CardView } from './components/CardView'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ContextMenu, MenuItem } from './components/ContextMenu'
import { DetailDrawer } from './components/DetailDrawer'
import { GroupNameDialog } from './components/GroupNameDialog'
import { GroupPreviewModal } from './components/GroupPreviewModal'
import { GroupRow } from './components/GroupRow'
import { Onboarding } from './components/Onboarding'
import { ProjectFormModal } from './components/ProjectFormModal'
import { ProjectRow } from './components/ProjectRow'
import { SettingsPage } from './components/SettingsPage'
import { Sidebar, Category } from './components/Sidebar'
import { TagColorSlider } from './components/TagColorSlider'
import { TagRenameDialog } from './components/TagRenameDialog'
import { Toast, ToastData } from './components/Toast'
import { Toolbar } from './components/Toolbar'
import { UpdateModal } from './components/UpdateModal'
import { applyTheme } from './theme'

interface FormState {
  mode: 'create' | 'edit' | 'manual'
  detect?: DetectSuccess
  project?: Project
}

interface MenuState {
  x: number
  y: number
  project: Project
}

/** 标签右键菜单的定位与目标标签 */
interface TagMenuState {
  x: number
  y: number
  tag: string
}

// 标签染色色板（侧栏标签右键染色；默认无色）
const TAG_COLORS = [
  '#e74c3c',
  '#e67e22',
  '#f1c40f',
  '#2ecc71',
  '#3498db',
  '#9b59b6',
  '#e84393',
  '#16a085'
]

/** 引导演示用的假项目（引导期间并入列表展示，结束后消失；不写库、不参与自启） */
const DEMO_PROJECTS: Project[] = [
  {
    id: 'demo-app',
    type: 'service',
    name: '演示应用',
    path: '~/演示项目/演示应用',
    command: 'npm run dev',
    port: 5321,
    openBrowser: false,
    note: '',
    tags: [],
    createdAt: 1_782_000_000_000,
    lastStartedAt: 1_786_600_000_000,
    launchModes: [
      { id: 'dev', kind: 'dev', label: '开发服务器', command: 'npm run dev', port: 5321 }
    ],
    activeMode: 'dev'
  },
  {
    id: 'demo-web',
    type: 'web',
    name: '演示官网',
    path: '~/演示项目/我的产品/演示官网',
    port: 53100,
    entryPath: '/index.html',
    openBrowser: false,
    note: '',
    tags: ['演示'],
    createdAt: 1_781_000_000_000,
    lastStartedAt: 1_785_500_000_000,
    parentId: 'demo-group',
    launchModes: [{ id: 'preview', kind: 'preview', label: '成品预览', entryPath: '/index.html' }],
    activeMode: 'preview'
  },
  {
    id: 'demo-py',
    type: 'service',
    name: '演示数据服务',
    path: '~/演示项目/我的产品/演示数据服务',
    command: 'python3 app.py',
    port: 5001,
    openBrowser: false,
    note: '',
    tags: ['工作'],
    createdAt: 1_780_000_000_000,
    lastStartedAt: 1_784_500_000_000,
    parentId: 'demo-group',
    launchModes: [
      {
        id: 'python-dev',
        kind: 'python-static',
        label: 'python 程序',
        command: 'python3 app.py',
        port: 5001
      }
    ],
    activeMode: 'dev'
  },
  {
    id: 'demo-script',
    type: 'service',
    name: '演示脚本',
    path: '~/演示项目/演示脚本',
    command: './start.command',
    port: 8080,
    openBrowser: false,
    note: '',
    tags: [],
    createdAt: 1_779_000_000_000,
    lastStartedAt: 1_783_500_000_000,
    launchModes: [
      { id: 'launch', kind: 'dev', label: '启动脚本', command: './start.command', port: 8080 }
    ],
    activeMode: 'dev'
  },
  {
    id: 'demo-group',
    type: 'group',
    name: '我的产品',
    path: '~/演示项目/我的产品',
    command: '',
    openBrowser: false,
    note: '',
    tags: [],
    createdAt: 1_783_000_000_000,
    lastStartedAt: 1_786_700_000_000
  }
]

/** 引导第 2 步演示用的假日志（演示应用详情抽屉里显示，引导结束消失） */
const DEMO_LOGS = [
  '> npm run dev',
  '> demo-app@1.0.0 dev',
  'ready in 312ms',
  '➜ Local: http://localhost:5321'
]

export default function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [statuses, setStatuses] = useState<Record<string, ProjectStatusEvent>>({})
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  /** 右侧详情抽屉显示的项目 id */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [category, setCategory] = useState<Category>('all')
  const [search, setSearch] = useState('')
  /** 搜索框是否展开（点搜索 icon / ⌘F 展开；Esc/再点 icon/失焦收起） */
  const [searchOpen, setSearchOpen] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
  /** 多项目容器候选（S2，组预览勾选式）：确认后登记成组 */
  const [multi, setMulti] = useState<DetectMulti | null>(null)
  const [appPrompt, setAppPrompt] = useState<DetectNeedParseApp | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  /** 更新检查结果（启动时自动查 GitHub Release，有新版本弹窗） */
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  /** 侧栏标签右键菜单（重命名/删除/染色）*/
  const [tagMenu, setTagMenu] = useState<TagMenuState | null>(null)
  /** 正在重命名的标签名 */
  const [tagRename, setTagRename] = useState<string | null>(null)
  /** 待删除确认的标签名 */
  const [tagDelete, setTagDelete] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastData[]>([])
  const [dragOver, setDragOver] = useState(false)
  /** 行排序拖拽中的项目 id（仅手动排序模式） */
  const [dragId, setDragId] = useState<string | null>(null)
  /** 排序拖拽的插入位置：目标项目 + 插前/插后 + 目标矩形（全局指示线用，不受行/卡 overflow 裁剪） */
  const [sortOver, setSortOver] = useState<{
    id: string
    before: boolean
    rect: DOMRect
    kind: 'row' | 'card'
  } | null>(null)
  /** 自启项面板列是否打开（占一列的嵌入式列卡片） */
  const [autoStartOpen, setAutoStartOpen] = useState(false)
  /** 框选多选的选中项目 id（鼠标框选+右键批量操作） */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  /** 框选矩形（相对 project-list 容器；非空=正在框选） */
  const [marqueeBox, setMarqueeBox] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  /** 批量右键菜单（选中的多个项目） */
  const [bulkMenu, setBulkMenu] = useState<{ x: number; y: number } | null>(null)
  /** 批量加标签弹窗（含冲突二次确认） */
  const [bulkTag, setBulkTag] = useState<{ ids: string[] } | null>(null)
  /** 成组弹窗待收纳的项目（点「添加成组」先起名再提交） */
  const [bulkGroupIds, setBulkGroupIds] = useState<string[] | null>(null)
  /** 批量删除二次确认 */
  const [bulkDelete, setBulkDelete] = useState<{ ids: string[] } | null>(null)
  /** 偏好设置浮层（主窗口内界面，非独立窗口——浮层交互） */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 本机局域网 IP（局域网访问开时显示给其他设备用） */
  const [lanIp, setLanIp] = useState('')
  /** 新手引导是否显示（首次打开） */
  const [showOnboarding, setShowOnboarding] = useState(false)
  /** 引导当前步骤（第 3 步起 demo 卡片假装运行中，端口旁亮局域网地址供演示） */
  const [onboardStep, setOnboardStep] = useState(0)
  /** 系统当前亮暗（主题"跟随系统"用） */
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const searchRef = useRef<HTMLInputElement>(null)
  /** 自启 icon 引用（自启面板定位锚点） */
  const autoStartBtnRef = useRef<HTMLButtonElement>(null)
  /** 项目列表容器（框选坐标基准）*/
  const listRef = useRef<HTMLElement>(null)
  /** 框选起点（相对列表容器；非空=正在框选） */
  const marqueeStart = useRef<{ x: number; y: number } | null>(null)

  // 局域网访问：开关开时拿本机局域网 IP（关了清空）
  useEffect(() => {
    if (settings.lanAccess) {
      window.api.getLanIp().then(setLanIp)
    } else {
      requestAnimationFrame(() => setLanIp(''))
    }
  }, [settings.lanAccess])

  // 换 WiFi 后 IP 可能变了：每 60 秒对一次，变了就重探所有运行中项目的局域网可达性
  const lanIpRef = useRef(lanIp)
  useEffect(() => {
    lanIpRef.current = lanIp
  }, [lanIp])
  useEffect(() => {
    if (!settings.lanAccess) return
    const timer = setInterval(() => {
      window.api.getLanIp().then((ip) => {
        if (ip && ip !== lanIpRef.current) {
          setLanIp(ip)
          void window.api.recheckLan()
        }
      })
    }, 60_000)
    return () => clearInterval(timer)
  }, [settings.lanAccess])

  // 跟随系统亮暗变化
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // 应用主题（PRD 3.8：风格+亮暗即时生效）
  useEffect(() => {
    applyTheme(settings.theme, settings.darkMode, systemDark, settings.specialStyle)
  }, [settings.theme, settings.darkMode, systemDark, settings.specialStyle])

  // 启动时自动检查更新（有新版弹出「发现新版本」弹窗；失败静默不打扰）
  useEffect(() => {
    void window.api.checkUpdate().then((info) => {
      if (info.hasUpdate) setUpdateInfo(info)
    })
  }, [])

  // 订阅回调里要拿到最新项目名（用于失败通知），用 ref 镜像
  const projectsRef = useRef<Project[]>([])
  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

  const toast = useCallback((message: string, kind: ToastData['kind'] = 'info') => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((ts) => [...ts, { id, message, kind }])
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4000)
  }, [])

  const updateSettings = useCallback(async (patch: Partial<Settings>): Promise<void> => {
    const saved = await window.api.saveSettings(patch)
    setSettings(saved)
  }, [])

  // 初始加载：项目清单 + 设置 + 检测已在运行的项目直接显示运行中
  useEffect(() => {
    window.api.listProjects().then(async (ps) => {
      setProjects(ps)
      await window.api.adoptAllRunning()
      // 网站常驻（打开 Reopen 自动把网页项目拉回在线（服务类保持手动）
      // ：有「成品预览」方式的都算网页项目；老数据（无 launchModes）按 type=web 兼容
      for (const p of ps) {
        const hasPreview =
          (p.launchModes ?? []).some((m) => m.kind === 'preview') ||
          (p.launchModes === undefined && p.type === 'web')
        if (!hasPreview) continue
        const r = await window.api.startProject(p.id, 'preview')
        // adopt 已接管的会返回"已经在运行了"，静默；真失败由状态红点呈现
        if (!r.ok && r.reason && r.reason !== '已经在运行了') toast(r.reason, 'error')
      }
    })
    window.api.getSettings().then((s) => {
      setSettings(s)
      if (!s.onboarded) setShowOnboarding(true)
    })
    // 设置窗口改了什么，主窗口即时同步
    return window.api.onSettingsChanged(setSettings)
  }, [toast])

  // 订阅主进程推送：状态变化 + 日志（PRD 3.4）
  useEffect(() => {
    const offStatus = window.api.onStatus((e: ProjectStatusEvent) => {
      setStatuses((s) => ({ ...s, [e.id]: e }))
      // 局域网探测通过时顺带刷新本机 IP（事件里带的是探测那一刻的 IP，显示恒一致）
      if (e.lanReachable === true && e.lanIp) setLanIp(e.lanIp)
      if (e.status === 'failed') {
        const name = projectsRef.current.find((p) => p.id === e.id)?.name ?? '项目'
        toast(`「${name}」启动失败：${e.reason ?? '未知原因'}`, 'error')
      }
    })
    const offLog = window.api.onLog((e: ProjectLogEvent) => {
      // 每个项目最多保留最近 500 行，防止长时间运行内存无限增长
      setLogs((ls) => ({ ...ls, [e.id]: [...(ls[e.id] ?? []), e.line].slice(-500) }))
    })
    return () => {
      offStatus()
      offLog()
    }
  }, [toast])

  // ⌘F 展开并聚焦搜索框（应用内快捷键；搜索改收起式后同步调整）
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => searchRef.current?.focus())
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // 左上角应用菜单的动作（menu.ts 发送；引导期间全部忽略——蒙层下的界面不能被菜单破坏，
  // 例如 ⌘, 打开偏好设置浮层会盖在引导上）
  useEffect(() => {
    const off = window.api.onMenuAction((action) => {
      if (showOnboarding) return
      if (action === 'add-project') setForm({ mode: 'manual' })
      else if (action === 'focus-search') searchRef.current?.focus()
      else if (action === 'set-view-list') updateSettings({ view: 'list' })
      else if (action === 'set-view-card') updateSettings({ view: 'card' })
      else if (action === 'settings' || action === 'settings-open') setSettingsOpen(true)
      else if (action === 'settings-close') setSettingsOpen(false)
      else if (action === 'about') toast('Reopen 0.1.0（VC复活点）')
      else if (action === 'check-update') toast('检查更新随 M4 发布里程碑上线')
    })
    return off
  }, [toast, updateSettings, showOnboarding])

  // 已有标签聚合（表单联想下拉的数据源：标签无颜色，列表/卡片不展示）
  // 标签显示顺序：settings.tagOrder 优先（侧栏拖动调整），新标签按字母序排后面
  const allTags = useMemo(() => {
    const all = [...new Set(projects.flatMap((p) => p.tags))]
    const order = settings.tagOrder
    return all.sort((a, b) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      if (ia === -1 && ib === -1) return a.localeCompare(b, 'zh')
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })
  }, [projects, settings.tagOrder])

  // 组 → 子项映射（项目组：子项按登记顺序固定在组内）
  // 引导演示假数据：引导期间并入展示（真实组件渲染），结束消失，不写库
  const allProjects = useMemo(
    () => (showOnboarding ? DEMO_PROJECTS : projects),
    [showOnboarding, projects]
  )

  const childrenMap = useMemo(() => {
    const m = new Map<string, Project[]>()
    for (const p of allProjects) {
      if (!p.parentId) continue
      const arr = m.get(p.parentId)
      if (arr) arr.push(p)
      else m.set(p.parentId, [p])
    }
    for (const arr of m.values()) arr.sort((a, b) => a.createdAt - b.createdAt)
    return m
  }, [allProjects])

  const childrenOf = useCallback(
    (id: string): Project[] => childrenMap.get(id) ?? [],
    [childrenMap]
  )

  /** 点开项目：组 → 跳侧栏「组」页面（组不再弹右侧抽屉，页面里显示全部子项）；普通项目 → 详情抽屉 */
  const handleOpen = (p: Project): void => {
    if (p.type === 'group') {
      setCategory(`group:${p.id}` as Category)
      setSelectedId(null)
    } else {
      setSelectedId(p.id)
    }
  }

  // 分类 + 搜索 + 排序（PRD 3.3；排序体系 重做：名称/最近打开/添加日期/标签/无）
  // 项目组：顶层视角——组与独立项目同层，子项只随组出现；组按子项内容进分类
  const visibleProjects = useMemo(() => {
    let list = allProjects.filter((p) => !p.parentId)
    const groupHas = (g: Project, type: 'service' | 'web'): boolean =>
      childrenOf(g.id).some((c) => c.type === type)
    if (category === 'service') {
      list = list.filter(
        (p) => p.type === 'service' || (p.type === 'group' && groupHas(p, 'service'))
      )
    } else if (category === 'web') {
      list = list.filter((p) => p.type === 'web' || (p.type === 'group' && groupHas(p, 'web')))
    } else if (category.startsWith('group:')) {
      // 组页面（点组跳到这里，平铺显示组内全部子项）
      const gid = category.slice(6)
      list = allProjects.filter((p) => p.parentId === gid)
    } else if (category.startsWith('tag:')) {
      const tag = category.slice(4)
      list = list.filter(
        (p) =>
          p.tags.includes(tag) ||
          (p.type === 'group' && childrenOf(p.id).some((c) => c.tags.includes(tag)))
      )
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const match = (p: Project): boolean =>
        p.name.toLowerCase().includes(q) ||
        p.note.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)) ||
        (p.port?.toString().includes(q) ?? false)
      // 子项命中 → 组跟着显示
      list = list.filter((p) => match(p) || (p.type === 'group' && childrenOf(p.id).some(match)))
    }
    // 组之间永远按侧栏顺序（groupOrder，侧栏拖动调整）——任何排序方式下组的先后都跟随侧栏
    const byGroupOrder = (a: Project, b: Project): number | null => {
      if (a.type !== 'group' || b.type !== 'group') return null
      const order = settings.groupOrder
      const ia = order.indexOf(a.id)
      const ib = order.indexOf(b.id)
      if (ia === ib) return null
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    }
    if (settings.sortMode === 'name') {
      list.sort((a, b) => byGroupOrder(a, b) ?? a.name.localeCompare(b.name, 'zh'))
    } else if (settings.sortMode === 'created') {
      list.sort((a, b) => byGroupOrder(a, b) ?? b.createdAt - a.createdAt)
    } else if (settings.sortMode === 'recent') {
      list.sort(
        (a, b) =>
          (byGroupOrder(a, b) ?? (b.lastStartedAt ?? 0) - (a.lastStartedAt ?? 0)) ||
          b.createdAt - a.createdAt
      )
    } else if (settings.sortMode === 'type') {
      // 种类：按 typeOrder 排类型（组「文件夹」→服务→网页，顺序在设置里可调），同类型内按名称
      const order = settings.typeOrder
      const rank = (p: Project): number => {
        const i = order.indexOf(p.type)
        return i === -1 ? order.length : i
      }
      list.sort(
        (a, b) => (byGroupOrder(a, b) ?? rank(a) - rank(b)) || a.name.localeCompare(b.name, 'zh')
      )
    } else if (settings.sortMode === 'tag') {
      // 按第一个标签分组：无标签排最后；组间按侧栏标签顺序（tagOrder），组内按名称
      const order = settings.tagOrder
      const rank = (t: string): number => {
        const i = order.indexOf(t)
        return i === -1 ? order.length : i
      }
      const tagOf = (p: Project): string => p.tags[0] ?? ''
      list.sort((a, b) => {
        const ta = tagOf(a)
        const tb = tagOf(b)
        if (ta !== tb) {
          if (!ta) return 1
          if (!tb) return -1
          return rank(ta) - rank(tb) || ta.localeCompare(tb, 'zh')
        }
        return byGroupOrder(a, b) ?? a.name.localeCompare(b.name, 'zh')
      })
    } else {
      // 'none'：手动拖拽顺序：按 settings.manualOrder，没记录过的排后面
      const order = settings.manualOrder
      list.sort((a, b) => {
        const ia = order.indexOf(a.id)
        const ib = order.indexOf(b.id)
        if (ia === -1 && ib === -1) return byGroupOrder(a, b) ?? a.createdAt - b.createdAt
        if (ia === -1) return 1
        if (ib === -1) return -1
        return byGroupOrder(a, b) ?? ia - ib
      })
    }
    return list
  }, [
    allProjects,
    category,
    search,
    settings.sortMode,
    settings.manualOrder,
    settings.typeOrder,
    settings.tagOrder,
    settings.groupOrder,
    childrenOf
  ])

  // 标签排序时给每个项目标注"是否需要插组头"（组头 = 第一个标签或「无标签」；起无颜色，只留文字）
  // 项目组：展开的组后面紧跟其子项（子项无组头、不参与顶层排序）
  const listItems = useMemo(() => {
    const items: { p: Project; header: { label: string } | null }[] = []
    let last: string | undefined
    for (const p of visibleProjects) {
      let header: { label: string } | null = null
      if (settings.sortMode === 'tag') {
        const t = p.tags[0]
        header = t !== last ? { label: t || '无标签' } : null
        last = t
      }
      items.push({ p, header })
    }
    return items
  }, [visibleProjects, settings.sortMode])

  // 项目组：条目数按顶层算（组算 1 个）；组按子项内容计入分类
  const counts = useMemo(
    () => ({
      all: allProjects.filter((p) => !p.parentId).length,
      service: allProjects.filter(
        (p) =>
          !p.parentId &&
          (p.type === 'service' ||
            (p.type === 'group' && childrenOf(p.id).some((c) => c.type === 'service')))
      ).length,
      web: allProjects.filter(
        (p) =>
          !p.parentId &&
          (p.type === 'web' ||
            (p.type === 'group' && childrenOf(p.id).some((c) => c.type === 'web')))
      ).length
    }),
    [allProjects, childrenOf]
  )

  // 识别结果的统一处理：成功→确认表单；多项目→候选清单；.app→询问解析；识别不了→提示；重复→提示
  const handleDetectOutcome = (outcome: DetectOutcome): void => {
    if (outcome.ok) {
      if ('kind' in outcome && outcome.kind === 'multi') setMulti(outcome)
      else setForm({ mode: 'create', detect: outcome })
    } else if (outcome.kind === 'unsupported-app') {
      setAppPrompt(outcome)
    } else if (outcome.kind === 'no-match') {
      toast(outcome.reason, 'error')
    } else if (outcome.kind === 'duplicate') {
      toast(`「${outcome.name}」已经登记过了，不用重复添加`)
    }
  }

  // 文件拖入登记（PRD 3.2：拖入 → 识别 → 表单/询问）
  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    // 引导期间忽略文件拖入——登记表单会盖在引导遮罩上（引导走完才能拖）
    if (showOnboarding) return
    // 排序拖拽落到空白（列表底部/子项区域）= 移到末尾
    const sortId = e.dataTransfer.getData('application/x-reopen-id')
    if (sortId && dragId) {
      const order =
        settings.manualOrder.length > 0 ? [...settings.manualOrder] : projects.map((p) => p.id)
      const from = order.indexOf(sortId)
      if (from !== -1) order.splice(from, 1)
      order.push(sortId)
      setDragId(null)
      setSortOver(null)
      applyManualOrder(order)
      return
    }
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const path = window.api.getPathForFile(files[0])
    if (!path) return
    handleDetectOutcome(await window.api.detectPath(path))
  }

  // 「+」按钮：打开访达选文件夹 → 自动识别 → 补信息（
  const handlePickFolder = async (): Promise<void> => {
    const path = await window.api.pickProjectFolder()
    if (!path) return
    handleDetectOutcome(await window.api.detectPath(path))
  }

  // 项目拖拽（行与卡片共用）：手动排序 + 拖入自启项面板
  const handleRowDragStart = (e: React.DragEvent, p: Project): void => {
    e.dataTransfer.setData('application/x-reopen-id', p.id)
    e.dataTransfer.effectAllowed = 'move'
    setDragId(p.id)
  }

  // 自启项（PRD 3.5）；引导第 4 步演示：演示脚本自动出现在面板里（引导结束消失）
  const autoStartItems = useMemo(() => {
    const ids =
      showOnboarding && onboardStep >= 3
        ? [...settings.autoStartIds, 'demo-script']
        : settings.autoStartIds
    return ids.map((id) => allProjects.find((p) => p.id === id)).filter(Boolean) as Project[]
  }, [settings.autoStartIds, allProjects, showOnboarding, onboardStep])

  // 引导期演示脚本的卡片/行亮自启闪电标记（与面板内容一致）
  const autoStartIdsForUi = useMemo(
    () =>
      showOnboarding && onboardStep >= 3
        ? [...settings.autoStartIds, 'demo-script']
        : settings.autoStartIds,
    [settings.autoStartIds, showOnboarding, onboardStep]
  )

  // 引导第 4 步自动滑出自启面板（演示脚本在里面）；其它步随真实开关状态
  const autoStartVisible = autoStartOpen || (showOnboarding && onboardStep === 3)

  const addToAutoStart = (id: string): void => {
    if (settings.autoStartIds.includes(id)) return
    const p = projects.find((x) => x.id === id)
    // 组内子项不能单独自启，自启打在组上（只拉成品子项）
    if (p?.parentId) {
      toast('组内子项不能单独自启——请把整个组拖进来', 'error')
      return
    }
    updateSettings({ autoStartIds: [...settings.autoStartIds, id] })
    toast(
      p?.type === 'group'
        ? '已加入自启项：打开 Reopen 只自动拉起组里的成品网站'
        : p?.openBrowser
          ? '已加入自启项：打开 Reopen 会随应用一起激活它。注意：「启动后打开浏览器」对自启不生效，自启不会自动打开浏览器'
          : '已加入自启项：打开 Reopen 会随应用一起激活它'
    )
  }

  const removeFromAutoStart = (id: string): void => {
    updateSettings({ autoStartIds: settings.autoStartIds.filter((x) => x !== id) })
  }

  // 自启面板已改为 .app-body 内占一列的嵌入式列卡片（挤入时项目自动让一列，不遮挡

  // 自启面板关闭：Esc / 点面板外（点 icon 由 toggle 处理；拖拽期间 mousedown 不触发，天然不关）
  useEffect(() => {
    if (!autoStartOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAutoStartOpen(false)
    }
    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return // 右键等不关面板（
      const panel = document.querySelector('.autostart-panel')
      if (!panel || panel.contains(e.target as Node)) return
      if (autoStartBtnRef.current?.contains(e.target as Node)) return
      // 按在项目行/卡片上=准备拖拽进面板，不能关（/21 实测反馈：一按下面板就关了，拖不进去）
      if ((e.target as Element).closest('.project-row')) return
      if ((e.target as Element).closest('.card')) return
      setAutoStartOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouseDown)
    }
  }, [autoStartOpen])

  // ---------- 框选多选（空白处按住拖出矩形框，框住的项目被选中 → 右键批量操作） ----------

  /** 在列表空白处按下左键 = 开始框选（点中项目本体不启动框选，保持点击/拖拽行为）。
   *  window 监听在按下时挂、松开时卸（原生方式，避免 effect 依赖 churn） */
  const beginMarquee = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    if ((e.target as Element).closest('[data-pid]')) return
    const rect = listRef.current?.getBoundingClientRect()
    if (!rect) return
    marqueeStart.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setSelectedIds(new Set())
    setMarqueeBox({ x: marqueeStart.current.x, y: marqueeStart.current.y, w: 0, h: 0 })

    const move = (ev: MouseEvent): void => {
      const r = listRef.current?.getBoundingClientRect()
      const start = marqueeStart.current
      if (!r || !start) return
      const x = ev.clientX - r.left
      const y = ev.clientY - r.top
      const box = {
        x: Math.min(start.x, x),
        y: Math.min(start.y, y),
        w: Math.abs(x - start.x),
        h: Math.abs(y - start.y)
      }
      setMarqueeBox(box)
      // 实时计算与框相交的项目（矩形相交判定）
      const sel = new Set<string>()
      document.querySelectorAll<HTMLElement>('[data-pid]').forEach((el) => {
        const er = el.getBoundingClientRect()
        const rx = er.left - r.left
        const ry = er.top - r.top
        if (
          rx < box.x + box.w &&
          rx + er.width > box.x &&
          ry < box.y + box.h &&
          ry + er.height > box.y
        ) {
          sel.add(el.dataset.pid as string)
        }
      })
      setSelectedIds(sel)
    }
    const up = (): void => {
      marqueeStart.current = null
      setMarqueeBox(null)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Esc 清空选中/关闭批量菜单
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setSelectedIds(new Set())
        setBulkMenu(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** 有选中时点击项目 = 切换选中（无选中时保持打开抽屉/展开组 */
  const selectMode = selectedIds.size > 0

  const toggleSelect = (id: string): void => {
    setSelectedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 项目右键：多选中且右键目标是选中之一 → 批量菜单；否则回到单项目菜单 */
  const handleItemContextMenu = (e: React.MouseEvent, p: Project): void => {
    if (selectedIds.size > 1 && selectedIds.has(p.id)) {
      setBulkMenu({ x: e.clientX, y: e.clientY })
      return
    }
    setSelectedIds(new Set([p.id]))
    setMenu({ x: e.clientX, y: e.clientY, project: p })
  }

  /** 批量：启动全部（跳过项目组/纯网页/已在运行的） */
  const handleBulkStart = async (): Promise<void> => {
    let started = 0
    let skipped = 0
    for (const p of projects) {
      if (!selectedIds.has(p.id)) continue
      const st = statuses[p.id]?.status ?? 'stopped'
      if (p.type === 'group' || isPureWeb(p) || st === 'running' || st === 'starting') {
        skipped++
        continue
      }
      const res = await window.api.startProject(p.id)
      if (res.ok) started++
      else skipped++
    }
    toast(
      started > 0
        ? `已启动 ${started} 个项目${skipped > 0 ? `，跳过 ${skipped} 个` : ''}`
        : `没有可启动的项目（跳过 ${skipped} 个）`,
      started > 0 ? 'success' : 'info'
    )
    setSelectedIds(new Set())
  }

  /** 批量：从自启项移出 */
  const handleBulkRemoveAutoStart = (): void => {
    void updateSettings({
      autoStartIds: settings.autoStartIds.filter((id) => !selectedIds.has(id))
    })
    toast('已从自启项移出', 'success')
    setSelectedIds(new Set())
  }

  /** 批量加标签-第一步：算在别的标签里的项目数（不应用） */
  const handleBulkTagCheck = (tag: string): Promise<number> => {
    const ids = bulkTag?.ids ?? []
    const n = projects.filter(
      (p) => ids.includes(p.id) && p.tags.length > 0 && !p.tags.includes(tag)
    ).length
    return Promise.resolve(n)
  }

  /** 批量加标签-第二步：应用（用户规则：已有该标签跳过；无标签直接加；conflictMode=move 原标签换成新标签） */
  const handleBulkTagApply = async (tag: string, conflictMode: 'skip' | 'move'): Promise<void> => {
    const ids = bulkTag?.ids ?? []
    let added = 0
    for (const p of projects) {
      if (!ids.includes(p.id)) continue
      if (p.tags.includes(tag)) continue
      let tags: string[]
      if (p.tags.length === 0) tags = [tag]
      else if (conflictMode === 'move') tags = [tag]
      else continue
      const updated = await window.api.updateProject(p.id, {
        name: p.name,
        type: p.type,
        path: p.path,
        command: p.command,
        port: p.port,
        openBrowser: p.openBrowser,
        note: p.note,
        tags,
        lastPort: p.lastPort,
        entryPath: p.entryPath,
        entryPaths: p.entryPaths,
        parentId: p.parentId,
        launchModes: p.launchModes,
        activeMode: p.activeMode
      })
      setProjects((ps) => ps.map((x) => (x.id === updated.id ? updated : x)))
      added++
    }
    toast(`已给 ${added} 个项目加上「${tag}」标签`, 'success')
    setBulkTag(null)
    setSelectedIds(new Set())
  }

  /** 批量：删除（组连带子项；二次确认由 ConfirmDialog 兜底） */
  const handleBulkDelete = async (): Promise<void> => {
    const ids = bulkDelete?.ids ?? []
    const targets = projects.filter((p) => ids.includes(p.id))
    for (const p of targets) {
      if (p.type === 'group') {
        for (const c of childrenOf(p.id)) {
          try {
            await window.api.stopProject(c.id)
          } catch {
            // 没在运行就算了
          }
          await window.api.deleteProject(c.id)
        }
      } else {
        // 正在运行的先停掉再删（防孤儿进程占端口）
        try {
          await window.api.stopProject(p.id)
        } catch {
          // 没在运行就算了
        }
      }
      await window.api.deleteProject(p.id)
    }
    setProjects((ps) =>
      ps.filter(
        (x) =>
          !ids.includes(x.id) && !targets.some((t) => t.type === 'group' && x.parentId === t.id)
      )
    )
    if (selectedId && ids.includes(selectedId)) setSelectedId(null)
    setBulkDelete(null)
    setSelectedIds(new Set())
    toast(`已移除 ${ids.length} 个项目`, 'success')
  }

  /** 批量：手动成组（框选右键"添加成组"→先起组名；顶层项目至少两个，组和子项不算） */
  const handleBulkGroup = async (name: string): Promise<void> => {
    const ids = [...(bulkGroupIds ?? [])].filter((id) => {
      const p = projects.find((x) => x.id === id)
      return p && !p.parentId && p.type !== 'group'
    })
    if (ids.length < 2) {
      toast('成组至少需要两个顶层项目（组和组内子项不算）', 'info')
      setSelectedIds(new Set())
      setBulkGroupIds(null)
      return
    }
    try {
      const group = await window.api.createGroup(ids, name)
      setProjects((ps) =>
        ps.map((x) => (ids.includes(x.id) ? { ...x, parentId: group.id } : x)).concat(group)
      )
      toast(`已创建「${group.name}」收纳 ${ids.length} 个项目，右键组可改名`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '成组失败', 'error')
    }
    setSelectedIds(new Set())
    setBulkGroupIds(null)
  }

  /** 解散组（子项回到顶层，组删除 */
  const handleUngroup = async (g: Project): Promise<void> => {
    await window.api.ungroup(g.id)
    setProjects((ps) =>
      ps
        .filter((x) => x.id !== g.id)
        .map((x) => (x.parentId === g.id ? { ...x, parentId: undefined } : x))
    )
    if (category === `group:${g.id}`) setCategory('all')
    setMenu(null)
    toast(`已解散「${g.name}」，子项目回到全部列表`, 'success')
  }

  /** 批量右键菜单项 */
  const bulkMenuItems: MenuItem[] = [
    {
      label: `启动全部（${selectedIds.size}）`,
      icon: <MonitorPlay size={14} />,
      onClick: () => void handleBulkStart()
    },
    {
      label: '添加成组',
      icon: <Group size={14} />,
      onClick: () => setBulkGroupIds([...selectedIds])
    },
    {
      label: '加标签…',
      icon: <Tag size={14} />,
      onClick: () => setBulkTag({ ids: [...selectedIds] })
    },
    {
      label: '从自启项移出',
      icon: <Zap size={14} />,
      onClick: handleBulkRemoveAutoStart
    },
    {
      label: `删除 ${selectedIds.size} 个项目…`,
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => setBulkDelete({ ids: [...selectedIds] })
    }
  ]

  /** 松手后的平滑移动动画（FLIP）：重排前记旧位置 → 重排后反向位移 → 过渡归零 */
  const animateFlip = (from: Map<HTMLElement, { x: number; y: number }>): void => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.project-row, .card'))
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          els.forEach((el) => {
            const before = from.get(el)
            if (!before) return
            const r = el.getBoundingClientRect()
            const dx = before.x - r.left
            const dy = before.y - r.top
            if (dx !== 0 || dy !== 0) {
              el.style.transition = 'none'
              el.style.transform = `translate(${dx}px, ${dy}px)`
            }
          })
          requestAnimationFrame(() => {
            els.forEach((el) => {
              el.style.transition = 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)'
              el.style.transform = ''
            })
            setTimeout(() => {
              els.forEach((el) => {
                el.style.transition = ''
                el.style.transform = ''
              })
            }, 280)
          })
        })
      })
    })
  }

  /** 按新顺序落位：写 manualOrder + FLIP 平滑移动（拖到空白=移到末尾也走这里） */
  const applyManualOrder = (order: string[]): void => {
    const before = new Map<HTMLElement, { x: number; y: number }>()
    document.querySelectorAll<HTMLElement>('.project-row, .card').forEach((el) => {
      const r = el.getBoundingClientRect()
      before.set(el, { x: r.left, y: r.top })
    })
    void updateSettings({ manualOrder: order }).then(() => animateFlip(before))
  }

  /** 排序拖拽 dragover（行/卡共用）：指针在目标中线以上=插前、以下=插后（仿访达插入线语义） */
  const handleSortDragOver = (e: React.DragEvent, p: Project, kind: 'row' | 'card'): void => {
    if (e.dataTransfer.types.includes('Files')) return
    if (p.parentId) return // 组内子项不是排序目标（落到空白=移到末尾）
    e.preventDefault()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const before =
      kind === 'card' ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2
    if (sortOver?.id === p.id && sortOver.before === before) return
    setSortOver({ id: p.id, before, rect: r, kind })
  }

  /** 排序拖拽落下（drop 在目标行/卡上；插入位置以 dragover 时的插前/插后为准） */
  const handleRowDrop = (e: React.DragEvent): void => {
    // 文件拖入不归行处理，冒泡给窗口的登记逻辑
    if (e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    const id = e.dataTransfer.getData('application/x-reopen-id') || dragId
    const over = sortOver
    setDragId(null)
    setSortOver(null)
    if (!id || !over || id === over.id) return
    const order =
      settings.manualOrder.length > 0 ? [...settings.manualOrder] : projects.map((p) => p.id)
    const from = order.indexOf(id)
    if (from !== -1) order.splice(from, 1)
    const to = order.indexOf(over.id)
    // before=插到目标前面（拖到第一个的上半就能排到最前，修复"拖不到第一个"）；
    // 目标没记录过=插到末尾（splice 语义安全）
    order.splice(to === -1 ? order.length : over.before ? to : to + 1, 0, id)
    applyManualOrder(order)
  }

  const handleStart = async (p: Project): Promise<void> => {
    const res = await window.api.startProject(p.id)
    if (!res.ok) toast(res.reason ?? '启动失败', 'error')
    else if (res.reason) toast(res.reason, 'success')
  }

  const handleOpenBrowser = async (p: Project, entry?: string): Promise<void> => {
    const res = await window.api.openProjectBrowser(p.id, entry)
    if (!res.ok) toast(res.reason ?? '打开失败', 'error')
  }

  /** 由本应用托管：停掉手动起的旧服务、用项目自己的方式重新启动（对局域网开门） */
  const handleRehost = async (p: Project): Promise<void> => {
    toast('正在停掉旧服务并重新启动，稍等几秒', 'info')
    const res = await window.api.rehostProject(p.id)
    if (!res.ok) toast(res.reason ?? '切换失败', 'error')
  }

  /** 启动失败后的「看成品」兜底（以成品预览方式打开 */
  const handleViewPreview = async (p: Project): Promise<void> => {
    const res = await window.api.startProject(p.id, 'preview')
    if (!res.ok) toast(res.reason ?? '打开成品失败', 'error')
  }

  // 右键菜单项（随运行状态变化；PRD 3.3）
  const menuItems = (p: Project): MenuItem[] => {
    // 组（项目组）：不启动，编辑/解散/删除（解散组）
    if (p.type === 'group') {
      return [
        {
          label: '编辑',
          icon: <Pencil size={14} />,
          onClick: () => setForm({ mode: 'edit', project: p })
        },
        {
          label: '解散组',
          icon: <Ungroup size={14} />,
          onClick: () => void handleUngroup(p)
        },
        {
          label: '删除',
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: () => setDeleteTarget(p)
        }
      ]
    }
    const st = statuses[p.id]?.status ?? 'stopped'
    const items: MenuItem[] = []
    // 纯网页（无需激活——右键菜单没有启动/停止
    if (!isPureWeb(p)) {
      if (st === 'running' || st === 'starting') {
        items.push({
          label: '停止',
          icon: <MonitorPause size={14} />,
          onClick: () => window.api.stopProject(p.id)
        })
      } else {
        items.push({
          label: '启动',
          icon: <MonitorPlay size={14} />,
          onClick: () => handleStart(p)
        })
      }
    }
    items.push({
      label: '在浏览器打开',
      icon: <ExternalLink size={14} />,
      onClick: () => handleOpenBrowser(p)
    })
    items.push({
      label: '编辑',
      icon: <Pencil size={14} />,
      onClick: () => setForm({ mode: 'edit', project: p })
    })
    items.push({
      label: '重新定位…',
      icon: <FolderSearch size={14} />,
      onClick: () => handleRelocate(p)
    })
    items.push({
      label: '访问项目原目录',
      icon: <FolderOpen size={14} />,
      onClick: () => window.api.revealInFolder(p.path)
    })
    items.push({
      label: '删除',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => setDeleteTarget(p)
    })
    return items
  }

  // 项目文件夹被移动后的找回：访达选新位置 → 更新路径（用户提问，启动时标红提示引导到这里）
  const handleRelocate = async (p: Project): Promise<void> => {
    const newPath = await window.api.pickProjectFolder(p.type === 'web')
    if (!newPath) return
    const updated = await window.api.updateProject(p.id, {
      name: p.name,
      type: p.type,
      path: newPath,
      command: p.command,
      port: p.port,
      openBrowser: p.openBrowser,
      note: p.note,
      tags: p.tags,
      entryPath: p.entryPath,
      entryPaths: p.entryPaths,
      parentId: p.parentId,
      launchModes: p.launchModes,
      activeMode: p.activeMode
    })
    setProjects((ps) => ps.map((x) => (x.id === updated.id ? updated : x)))
    toast(`已重新定位「${updated.name}」`, 'success')
  }

  /** 改过端口且有来源：先改源文件，成功返回新来源片段 → 档案落新端口；
   *  改不动则档案保持原端口（源码和档案永不打架，不会「改了打不开」） */
  const rewritePortFirst = async (
    path: string,
    oldPort: number | undefined,
    input: NewProjectInput
  ): Promise<NewProjectInput> => {
    if (input.port === undefined || input.port === oldPort || !input.portSource) return input
    const r = await window.api.rewriteProjectPortFile(path, input.portSource, input.port)
    if (!r.ok || !r.source) {
      toast(r.reason ?? '端口改写没成功，已保持项目原端口', 'error')
      // 回退：档案用原端口、源码没动，两边一致
      return { ...input, port: oldPort }
    }
    toast('已同步改写项目源代码里的端口，重新启动项目后生效', 'success')
    return { ...input, portSource: r.source }
  }

  const handleFormSubmit = async (input: NewProjectInput): Promise<void> => {
    try {
      if (form?.mode === 'edit' && form.project) {
        // 端口改过且有来源 → 先改写源文件（vite 等不认注入的项目靠这个生效），成功才落新端口
        const finalInput = await rewritePortFirst(form.project.path, form.project.port, input)
        const updated = await window.api.updateProject(form.project.id, finalInput)
        setProjects((ps) => ps.map((p) => (p.id === updated.id ? updated : p)))
        toast(`已保存「${updated.name}」`, 'success')
      } else {
        // 拖入登记时改过端口且有来源 → 先改源文件再登记（表单里已提示「会替换写死的端口」）
        const finalInput = await rewritePortFirst(input.path, form?.detect?.suggested.port, input)
        const project = await window.api.addProject(finalInput)
        setProjects((ps) => [...ps, project])
        toast(`已添加「${project.name}」`, 'success')
        // 网站常驻（网页类型登记提交即上线，端口挂在行上随时点开
        if (project.type === 'web') {
          const r = await window.api.startProject(project.id)
          if (!r.ok && r.reason) toast(r.reason, 'error')
        }
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'error')
      return
    }
    setForm(null)
  }

  /** 组预览确认：登记组 + 按勾选顺序登记子项（成品先勾选的在前），成品子项登记即上线（ */
  const handleGroupCreate = async (name: string, selected: DetectSuccess[]): Promise<void> => {
    try {
      const group = await window.api.addProject({
        name,
        type: 'group',
        path: multi?.path ?? '',
        openBrowser: false,
        note: '',
        tags: []
      })
      const added: Project[] = [group]
      for (const s of selected) {
        const child = await window.api.addProject({
          name: s.suggested.name,
          type: s.type,
          path: s.path,
          command: s.suggested.command,
          port: s.suggested.port,
          entryPath: s.suggested.entryPath,
          entryPaths: s.suggested.entryPaths,
          launchModes: s.suggested.launchModes,
          activeMode: s.suggested.activeMode,
          openBrowser: false,
          note: '',
          tags: [],
          parentId: group.id
        })
        added.push(child)
        // 成品网页登记即上线（网站常驻；：有成品预览方式即按 preview 上线）
        if ((child.launchModes ?? []).some((m) => m.kind === 'preview')) {
          const r = await window.api.startProject(child.id, 'preview')
          if (!r.ok && r.reason) toast(r.reason, 'error')
        }
      }
      setProjects((ps) => [...ps, ...added])
      setMulti(null)
      // 新组登记完直接跳组页面
      setCategory(`group:${group.id}` as Category)
      toast(`已登记项目组「${name}」（${selected.length} 个子项）`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '登记失败', 'error')
    }
  }

  const handleParseApp = async (): Promise<void> => {
    if (!appPrompt) return
    const outcome = await window.api.parseApp(appPrompt.path)
    setAppPrompt(null)
    // 与拖入识别同一套处理（成功/多项目/识别不了/重复）
    handleDetectOutcome(outcome)
  }

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    // 组（项目组）：先停掉在线的子项、删子项，再删组本身
    if (deleteTarget.type === 'group') {
      for (const c of childrenOf(deleteTarget.id)) {
        try {
          await window.api.stopProject(c.id)
        } catch {
          // 没在运行就算了
        }
        await window.api.deleteProject(c.id)
      }
      setProjects((ps) =>
        ps.filter((p) => p.parentId !== deleteTarget.id && p.id !== deleteTarget.id)
      )
    } else {
      setProjects((ps) => ps.filter((p) => p.id !== deleteTarget.id))
    }
    // 正在运行的项目先停掉再删（不然进程变孤儿继续占端口，日志面板也还指着它）
    if (deleteTarget.type !== 'group') {
      try {
        await window.api.stopProject(deleteTarget.id)
      } catch {
        // 没在运行就算了
      }
    }
    await window.api.deleteProject(deleteTarget.id)
    if (selectedId === deleteTarget.id) setSelectedId(null)
    setDeleteTarget(null)
  }

  // ---------- 标签管理（侧栏标签右键 重命名/删除/染色，颜色填进标签 icon） ----------

  /** 标签 → 染色（默认无色） */
  // 组显示顺序：settings.groupOrder 优先（侧栏拖动调整），新组按创建时间排后面
  const orderedGroups = useMemo(() => {
    const gs = allProjects.filter((p) => p.type === 'group' && !p.parentId)
    const order = settings.groupOrder
    return gs.sort((a, b) => {
      const ia = order.indexOf(a.id)
      const ib = order.indexOf(b.id)
      if (ia === -1 && ib === -1) return a.createdAt - b.createdAt
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })
  }, [allProjects, settings.groupOrder])

  /** 侧栏拖动标签换顺序：全量把当前显示顺序写进 tagOrder（标签排序模式下分组顺序跟着变） */
  const handleTagMove = async (from: string, to: string, before: boolean): Promise<void> => {
    const tags = [...allTags]
    const fi = tags.indexOf(from)
    if (fi === -1 || from === to) return
    tags.splice(fi, 1)
    let ti = tags.indexOf(to)
    if (ti === -1) return
    if (!before) ti += 1
    tags.splice(ti, 0, from)
    await updateSettings({ tagOrder: tags })
  }

  /** 侧栏拖动组换顺序：全量把当前显示顺序写进 groupOrder（任何排序方式下组的先后跟着变） */
  const handleGroupMove = async (from: string, to: string, before: boolean): Promise<void> => {
    const gs = [...orderedGroups]
    const fi = gs.findIndex((g) => g.id === from)
    if (fi === -1 || from === to) return
    const [g] = gs.splice(fi, 1)
    let ti = gs.findIndex((x) => x.id === to)
    if (ti === -1) return
    if (!before) ti += 1
    gs.splice(ti, 0, g)
    await updateSettings({ groupOrder: gs.map((x) => x.id) })
  }

  /** 侧栏拖出条目范围（列表上方/下方）→ 直接排到最前/最后 */
  const handleTagMoveToEdge = async (from: string, edge: 'start' | 'end'): Promise<void> => {
    const tags = [...allTags]
    const fi = tags.indexOf(from)
    if (fi === -1) return
    tags.splice(fi, 1)
    if (edge === 'start') tags.unshift(from)
    else tags.push(from)
    await updateSettings({ tagOrder: tags })
  }

  const handleGroupMoveToEdge = async (from: string, edge: 'start' | 'end'): Promise<void> => {
    const gs = [...orderedGroups]
    const fi = gs.findIndex((g) => g.id === from)
    if (fi === -1) return
    const [g] = gs.splice(fi, 1)
    if (edge === 'start') gs.unshift(g)
    else gs.push(g)
    await updateSettings({ groupOrder: gs.map((x) => x.id) })
  }

  const tagColor = (tag: string): string | undefined => settings.tagColors[tag]

  /** 把含某标签的项目批量改名/移除（渲染层逐个 updateProject，全字段传入保留 lastPort） */
  const updateTagInProjects = async (
    oldTag: string,
    next: (tags: string[]) => string[]
  ): Promise<void> => {
    for (const p of projects.filter((x) => x.tags.includes(oldTag))) {
      const updated = await window.api.updateProject(p.id, {
        name: p.name,
        type: p.type,
        path: p.path,
        command: p.command,
        port: p.port,
        openBrowser: p.openBrowser,
        note: p.note,
        tags: next(p.tags),
        lastPort: p.lastPort,
        entryPath: p.entryPath,
        entryPaths: p.entryPaths,
        parentId: p.parentId,
        launchModes: p.launchModes,
        activeMode: p.activeMode
      })
      setProjects((ps) => ps.map((x) => (x.id === updated.id ? updated : x)))
    }
  }

  /** 重命名标签：项目里的标签名、染色键、当前筛选分类一起改名 */
  const handleTagRename = async (newName: string): Promise<void> => {
    const old = tagRename
    setTagRename(null)
    if (!old) return
    const trimmed = newName.trim().slice(0, 6)
    if (!trimmed || trimmed === old) return
    if (allTags.includes(trimmed)) {
      toast(`已经有「${trimmed}」这个标签了`, 'error')
      return
    }
    await updateTagInProjects(old, (tags) => tags.map((t) => (t === old ? trimmed : t)))
    const color = settings.tagColors[old]
    const patch: Partial<Settings> = {
      tagOrder: settings.tagOrder.map((t) => (t === old ? trimmed : t))
    }
    if (color) {
      const next = { ...settings.tagColors }
      delete next[old]
      next[trimmed] = color
      patch.tagColors = next
    }
    await updateSettings(patch)
    if (category === `tag:${old}`) setCategory(`tag:${trimmed}` as Category)
    toast(`标签已重命名为「${trimmed}」`, 'success')
  }

  /** 删除标签：从所有项目移除 + 清染色 + 筛选分类回到全部 */
  const handleTagDelete = async (): Promise<void> => {
    const tag = tagDelete
    setTagDelete(null)
    if (!tag) return
    await updateTagInProjects(tag, (tags) => tags.filter((t) => t !== tag))
    const next = { ...settings.tagColors }
    delete next[tag]
    await updateSettings({
      tagColors: next,
      tagOrder: settings.tagOrder.filter((t) => t !== tag)
    })
    if (category === `tag:${tag}`) setCategory('all')
    toast(`标签「${tag}」已删除`, 'success')
  }

  /** 标签染色（null=清除；滑块拖动松手时提交） */
  const handleTagPickColor = async (tag: string, color: string | null): Promise<void> => {
    const next = { ...settings.tagColors }
    if (color) next[tag] = color
    else delete next[tag]
    await updateSettings({ tagColors: next })
  }

  /** 标签右键菜单项（染色不是弹窗，而是菜单里内嵌渐变色板滑块+无色按钮） */
  const tagMenuItems = (tag: string): MenuItem[] => [
    {
      label: '重命名…',
      icon: <Pencil size={14} />,
      onClick: () => setTagRename(tag)
    },
    {
      label: '染色',
      icon: <Palette size={14} />,
      onClick: () => undefined,
      custom: (
        <TagColorSlider
          colors={TAG_COLORS}
          current={settings.tagColors[tag]}
          onPick={(color) => {
            void handleTagPickColor(tag, color)
            // 选完颜色（或点无色）菜单立即关闭
            setTagMenu(null)
          }}
        />
      )
    },
    {
      label: '删除标签',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => setTagDelete(tag)
    }
  ]

  // 引导期 demo 项目也能打开抽屉（allProjects 含假数据）；
  // 引导第 2 步自动拉出演示应用的详情抽屉展示日志（渲染时派生，不写 state），离开该步自动关上
  const drawerId = showOnboarding && onboardStep === 1 ? 'demo-app' : selectedId
  const selectedProject = allProjects.find((p) => p.id === drawerId) ?? null

  // 关闭时保留最后项目渲染到槽位宽度收回完成（overflow 裁掉内容）——内容不瞬消，关闭不闪；
  // 打开/关闭在事件里同步更新幽灵副本（不写 effect，避开级联渲染）
  const [drawerGhost, setDrawerGhost] = useState<Project | null>(null)
  const drawerProject = selectedProject ?? drawerGhost

  // 引导期 demo 卡片：第 3 步起假装运行中（端口旁亮出局域网地址供演示），引导结束消失
  const cardStatuses = useMemo(() => {
    if (!showOnboarding || onboardStep < 2) return statuses
    return { ...statuses, 'demo-app': { id: 'demo-app', status: 'running' as const, port: 5321 } }
  }, [statuses, showOnboarding, onboardStep])
  const demoLanOf = (p: Project): string =>
    p.id === 'demo-app' && showOnboarding && onboardStep >= 2
      ? '192.168.1.8'
      : settings.lanAccess
        ? lanIp
        : ''

  return (
    <div
      className="app"
      onDragOver={(e) => {
        // 只有文件拖入才显示登记遮罩；行排序拖拽不触发
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        // 只有指针真的离开窗口/容器才清除遮罩：relatedTarget 为空=拖去别的软件或桌面；
        // 旧写法 currentTarget===target 在指针停在子元素上时误判「已离开」→ 遮罩卡住不消失（bug）
        const rt = e.relatedTarget as Node | null
        if (!rt || !(e.currentTarget as Node).contains(rt)) {
          setDragOver(false)
          setSortOver(null)
        }
      }}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-box">松手，登记这个项目</div>
        </div>
      )}

      {/* 排序拖拽的插入指示线（fixed 全局渲染：行=横线贴目标上/下缘，卡片=竖线在目标左/右间隙，
          不受行/卡 overflow:hidden 裁剪，位置随指针上半/下半（左半/右半）切换） */}
      {sortOver && dragId && (
        <div
          className={`drop-line ${sortOver.kind === 'card' ? 'drop-line-v' : 'drop-line-h'}`}
          style={
            sortOver.kind === 'card'
              ? {
                  left: sortOver.before ? sortOver.rect.left - 7 : sortOver.rect.right + 5,
                  top: sortOver.rect.top + 6,
                  height: sortOver.rect.height - 12
                }
              : {
                  left: sortOver.rect.left + 8,
                  width: sortOver.rect.width - 16,
                  top: sortOver.before ? sortOver.rect.top - 4 : sortOver.rect.bottom + 2
                }
          }
        />
      )}

      <Sidebar
        category={category}
        tags={allTags}
        tagColor={tagColor}
        counts={counts}
        groups={orderedGroups.map((g) => ({
          id: g.id,
          name: g.name,
          childCount: childrenOf(g.id).length
        }))}
        runningCount={Object.values(statuses).filter((s) => s.status === 'running').length}
        onSelect={setCategory}
        onTagContextMenu={(tag, e) => setTagMenu({ x: e.clientX, y: e.clientY, tag })}
        onGroupContextMenu={(id, e) => {
          const g = projects.find((x) => x.id === id)
          if (g) handleItemContextMenu(e, g)
        }}
        onTagMove={(from, to, before) => void handleTagMove(from, to, before)}
        onGroupMove={(from, to, before) => void handleGroupMove(from, to, before)}
        onTagMoveToEdge={(from, edge) => void handleTagMoveToEdge(from, edge)}
        onGroupMoveToEdge={(from, edge) => void handleGroupMoveToEdge(from, edge)}
      />

      <div className="app-right">
        <div className="app-body">
          <div className="app-main">
            {/* toolbar 属中间栏：右栏滑出时随中间整体挤压（ */}
            <Toolbar
              search={search}
              onSearch={setSearch}
              searchOpen={searchOpen}
              onSearchOpen={setSearchOpen}
              view={settings.view}
              onView={(v) => updateSettings({ view: v })}
              sortMode={settings.sortMode}
              onSort={(m) => updateSettings({ sortMode: m })}
              onAdd={handlePickFolder}
              onOpenAutoStart={() => setAutoStartOpen(!autoStartOpen)}
              autoStartCount={autoStartIdsForUi.length}
              autoStartEnabled={settings.autoStartEnabled}
              searchInputRef={searchRef}
              autoStartBtnRef={autoStartBtnRef}
            />

            <main
              className="project-list"
              data-tour="list"

              ref={listRef}
              onMouseDown={beginMarquee}
            >
              {marqueeBox && (
                <div
                  className="marquee-rect"
                  style={{
                    left: marqueeBox.x,
                    top: marqueeBox.y,
                    width: marqueeBox.w,
                    height: marqueeBox.h
                  }}
                />
              )}
              {projects.length === 0 ? (
                <div className="empty">
                  还没有项目。
                  <br />
                  把一个项目文件夹或 html 文件拖进这个窗口试试。
                </div>
              ) : visibleProjects.length === 0 ? (
                <div className="empty">没有符合条件的项目。</div>
              ) : settings.view === 'list' ? (
                listItems.map(({ p, header }) =>
                  p.type === 'group' ? (
                    // 组行（项目组）：展开/收起，子项由 listItems 顺序跟随
                    <Fragment key={p.id}>
                      {header && <div className="list-group-header">{header.label}</div>}
                      <GroupRow
                        group={p}
                        onOpen={() => handleOpen(p)}
                        childrenCount={childrenOf(p.id).length}
                        onlineCount={
                          childrenOf(p.id).filter((c) => statuses[c.id]?.status === 'running')
                            .length
                        }
                        tagColor={tagColor}
                        autoStartChecked={autoStartIdsForUi.includes(p.id)}
                        onContextMenu={(e) => handleItemContextMenu(e, p)}
                        selected={selectedIds.has(p.id)}
                        selectMode={selectMode}
                        onSelectToggle={() => toggleSelect(p.id)}
                        sortDraggable={
                          !showOnboarding &&
                          (settings.sortMode === 'none' || settings.autoStartEnabled)
                        }
                        dragging={dragId === p.id}
                        onDragStart={(e) => handleRowDragStart(e, p)}
                        onDragOver={(e) => handleSortDragOver(e, p, 'row')}
                        onDragEnd={() => {
                          setDragId(null)
                          setSortOver(null)
                        }}
                        onDrop={(e) => handleRowDrop(e)}
                      />
                    </Fragment>
                  ) : (
                    <Fragment key={p.id}>
                      {header && <div className="list-group-header">{header.label}</div>}
                      <ProjectRow
                        project={p}
                        status={cardStatuses[p.id]}
                        onOpen={() => setSelectedId(p.id)}
                        onStart={() => handleStart(p)}
                        onStop={() => window.api.stopProject(p.id)}
                        onContextMenu={(e) => handleItemContextMenu(e, p)}
                        selected={selectedIds.has(p.id)}
                        selectMode={selectMode}
                        onSelectToggle={() => toggleSelect(p.id)}
                        sortDraggable={
                          !showOnboarding &&
                          !p.parentId &&
                          (settings.sortMode === 'none' || settings.autoStartEnabled)
                        }
                        dragging={dragId === p.id}
                        onDragStart={(e) => handleRowDragStart(e, p)}
                        onDragOver={(e) => handleSortDragOver(e, p, 'row')}
                        onDragEnd={() => {
                          setDragId(null)
                          setSortOver(null)
                        }}
                        onDrop={(e) => handleRowDrop(e)}
                        autoStartChecked={autoStartIdsForUi.includes(p.id)}
                        tagColor={tagColor}
                        onOpenBrowser={() => handleOpenBrowser(p)}
                        onViewPreview={() => handleViewPreview(p)}
                        isChild={Boolean(p.parentId)}
                        lanIp={demoLanOf(p)}
                        onRehost={() => handleRehost(p)}
                      />
                    </Fragment>
                  )
                )
              ) : (
                <CardView
                  items={listItems}
                  statuses={cardStatuses}
                  autoStartIds={autoStartIdsForUi}
                  dragId={dragId}
                  sortDraggable={
                    !showOnboarding && (settings.sortMode === 'none' || settings.autoStartEnabled)
                  }
                  onDragStart={(e, p) => handleRowDragStart(e, p)}
                  onDragOver={(e, p) => handleSortDragOver(e, p, 'card')}
                  onDragEnd={() => {
                    setDragId(null)
                    setSortOver(null)
                  }}
                  onDrop={(e) => handleRowDrop(e)}
                  tagColor={tagColor}
                  onOpen={(p) => handleOpen(p)}
                  onOpenBrowser={(p) => handleOpenBrowser(p)}
                  onStart={handleStart}
                  onStop={(p) => window.api.stopProject(p.id)}
                  onViewPreview={(p) => handleViewPreview(p)}
                  onContextMenu={(e, p) => handleItemContextMenu(e, p)}
                  childrenOf={childrenOf}
                  selected={(p) => selectedIds.has(p.id)}
                  selectMode={selectMode}
                  onSelectToggle={(p) => toggleSelect(p.id)}
                  lanIp={settings.lanAccess ? lanIp : ''}
                  onRehost={handleRehost}
                  demoLanIp={showOnboarding && onboardStep >= 2 ? '192.168.1.8' : undefined}
                />
              )}
            </main>
          </div>

          {/* 自启面板常驻 DOM：槽位宽度 0↔224 平滑过渡（与抽屉同款滑动，不瞬跳） */}
          <div
            className={`autostart-slot ${
              autoStartVisible && settings.autoStartEnabled ? 'autostart-open' : ''
            }`}
          >
            {settings.autoStartEnabled && (
              <AutoStartPanel
                items={autoStartItems}
                onRemove={removeFromAutoStart}
                onDropId={addToAutoStart}
                tourItemId={showOnboarding ? 'demo-script' : undefined}
              />
            )}
          </div>

          {/* 抽屉常驻 DOM：槽位宽度 0↔456 平滑过渡（中间栏每帧跟着收缩，卡片自然滑动换列，
              不再瞬跳闪一下）；关闭时内容保留到收回完成，被 overflow 裁掉，也不闪 */}
          <div className={`drawer-slot ${selectedProject ? 'drawer-open' : ''}`}>
            {drawerProject && (
              <DetailDrawer
                project={drawerProject}
                status={statuses[drawerProject.id]}
                logs={
                  drawerProject.id === 'demo-app' && showOnboarding
                    ? DEMO_LOGS
                    : (logs[drawerProject.id] ?? [])
                }
                onStart={() => handleStart(drawerProject)}
                onStop={() => window.api.stopProject(drawerProject.id)}
                onEdit={() => setForm({ mode: 'edit', project: drawerProject })}
                onDelete={() => setDeleteTarget(drawerProject)}
                onOpenBrowser={(entry) => handleOpenBrowser(drawerProject, entry)}
                onViewPreview={() => handleViewPreview(drawerProject)}
                onInstallDeps={() => {
                  void window.api.installProjectDeps(drawerProject.id)
                  toast('开始安装依赖，看日志面板的进度，装完再点启动', 'info')
                }}
                onKillResidual={() => {
                  void window.api.killResidual(drawerProject.id)
                  toast('正在终止残留进程并重新启动', 'info')
                }}
                onClose={() => {
                  setDrawerGhost(drawerProject)
                  setSelectedId(null)
                }}
                onBack={
                  drawerProject.parentId
                    ? () =>
                        handleOpen(projects.find((x) => x.id === drawerProject.parentId) as Project)
                    : undefined
                }
                lanIp={settings.lanAccess ? lanIp : ''}
                onRehost={() => handleRehost(drawerProject)}
              />
            )}
          </div>
        </div>
      </div>

      {form && (
        <ProjectFormModal
          mode={form.mode}
          detect={form.detect}
          project={form.project}
          existingTags={allTags}
          onSubmit={handleFormSubmit}
          onCancel={() => setForm(null)}
        />
      )}

      {/* 多项目容器 → 项目组预览勾选（确认后登记成组 */}
      {multi && (
        <GroupPreviewModal
          multi={multi}
          onConfirm={handleGroupCreate}
          onCancel={() => setMulti(null)}
        />
      )}

      {bulkMenu && (
        <ContextMenu
          x={bulkMenu.x}
          y={bulkMenu.y}
          items={bulkMenuItems}
          onClose={() => setBulkMenu(null)}
        />
      )}

      {bulkTag && (
        <BulkTagModal
          count={bulkTag.ids.length}
          existingTags={allTags}
          onCheck={handleBulkTagCheck}
          onApply={handleBulkTagApply}
          onCancel={() => setBulkTag(null)}
        />
      )}

      {bulkGroupIds && (
        <GroupNameDialog
          count={bulkGroupIds.length}
          onConfirm={(name) => void handleBulkGroup(name)}
          onCancel={() => setBulkGroupIds(null)}
        />
      )}

      {bulkDelete && (
        <ConfirmDialog
          title="移除多个项目"
          message={`确定把这 ${bulkDelete.ids.length} 个项目从 Reopen 移除吗？\n项目组会连带里面的子项目一起移除，不删你电脑上的原文件。`}
          confirmText="移除"
          onConfirm={() => void handleBulkDelete()}
          onCancel={() => setBulkDelete(null)}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.project)}
          onClose={() => setMenu(null)}
        />
      )}

      {tagMenu && (
        <ContextMenu
          x={tagMenu.x}
          y={tagMenu.y}
          items={tagMenuItems(tagMenu.tag)}
          onClose={() => setTagMenu(null)}
        />
      )}

      {tagRename && (
        <TagRenameDialog
          initial={tagRename}
          onConfirm={handleTagRename}
          onCancel={() => setTagRename(null)}
        />
      )}

      {tagDelete && (
        <ConfirmDialog
          title="删除标签"
          message={`确定删除标签「${tagDelete}」吗？所有项目上的这个标签都会被去掉（项目本身不受影响）。`}
          confirmText="删除"
          onConfirm={handleTagDelete}
          onCancel={() => setTagDelete(null)}
        />
      )}

      {updateInfo && <UpdateModal info={updateInfo} onClose={() => setUpdateInfo(null)} />}

      {appPrompt && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>暂不支持应用类型</h2>
            <p>
              第一版不支持把 .app
              应用登记进来。是否尝试解析这个应用，看它内部是不是一个服务或网页项目？
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setAppPrompt(null)}>
                取消
              </button>
              <button className="btn-primary" onClick={handleParseApp}>
                尝试解析
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.type === 'group' ? '删除项目组' : '删除项目'}
          message={
            deleteTarget.type === 'group'
              ? `确定把「${deleteTarget.name}」整个组从 Reopen 移除吗？\n组里的 ${childrenOf(deleteTarget.id).length} 个子项目会一起移除，不删你电脑上的原文件。`
              : `确定把「${deleteTarget.name}」从 Reopen 移除吗？\n只从 Reopen 移除登记，不删你电脑上的原文件。`
          }
          confirmText="移除"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* 偏好设置浮层（固定在主界面上方、不可拖动；点遮罩（主界面）=关闭，右上角叉=关闭 */}
      {settingsOpen && (
        <div
          className="settings-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false)
          }}
        >
          <div className="settings-panel">
            <SettingsPage onClose={() => setSettingsOpen(false)} />
          </div>
        </div>
      )}

      <Toast toasts={toasts} />

      {showOnboarding && (
        <Onboarding
          onDone={() => {
            updateSettings({ onboarded: true })
            setShowOnboarding(false)
            setDrawerGhost(null)
          }}
          onStepChange={(next) => {
            setOnboardStep(next)
            // 离开第 2 步（抽屉自动收回）：保留演示项目渲染到收回完成，不瞬消
            if (next !== 1) setDrawerGhost(drawerProject)
          }}
        />
      )}
    </div>
  )
}
