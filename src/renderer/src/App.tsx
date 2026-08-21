import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, FolderSearch, Palette, Pencil, Play, Square, Trash2 } from 'lucide-react'
import type {
  DetectMulti,
  DetectNeedParseApp,
  DetectOutcome,
  DetectSuccess,
  NewProjectInput,
  Project,
  ProjectLogEvent,
  ProjectStatusEvent,
  Settings
} from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { AutoStartPanel } from './components/AutoStartPanel'
import { CardView } from './components/CardView'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ContextMenu, MenuItem } from './components/ContextMenu'
import { DetailDrawer } from './components/DetailDrawer'
import { GroupPreviewModal } from './components/GroupPreviewModal'
import { GroupRow } from './components/GroupRow'
import { Onboarding } from './components/Onboarding'
import { ProjectFormModal } from './components/ProjectFormModal'
import { ProjectRow } from './components/ProjectRow'
import { Sidebar, Category } from './components/Sidebar'
import { TagColorSlider } from './components/TagColorSlider'
import { TagRenameDialog } from './components/TagRenameDialog'
import { Toast, ToastData } from './components/Toast'
import { Toolbar } from './components/Toolbar'
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

// 标签染色色板（2026-08-21 拍板：侧栏标签右键染色；默认无色）
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

export default function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [statuses, setStatuses] = useState<Record<string, ProjectStatusEvent>>({})
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  /** 右侧详情抽屉显示的项目 id */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [category, setCategory] = useState<Category>('all')
  const [search, setSearch] = useState('')
  /** 搜索框是否展开（点搜索 icon / ⌘F 展开；Esc/再点 icon/失焦收起，2026-08-20 拍板） */
  const [searchOpen, setSearchOpen] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
  /** 多项目容器候选（2026-08-21 S2，组预览勾选式）：确认后登记成组 */
  const [multi, setMulti] = useState<DetectMulti | null>(null)
  /** 展开的组 id（2026-08-21 项目组；新登记的组默认展开） */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [appPrompt, setAppPrompt] = useState<DetectNeedParseApp | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  /** 侧栏标签右键菜单（重命名/删除/染色，2026-08-21） */
  const [tagMenu, setTagMenu] = useState<TagMenuState | null>(null)
  /** 正在重命名的标签名 */
  const [tagRename, setTagRename] = useState<string | null>(null)
  /** 待删除确认的标签名 */
  const [tagDelete, setTagDelete] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastData[]>([])
  const [dragOver, setDragOver] = useState(false)
  /** 行排序拖拽中的项目 id（仅手动排序模式） */
  const [dragId, setDragId] = useState<string | null>(null)
  /** 拖拽悬停的目标项目 id：其后面显示占位空位（动态让位效果，2026-08-21） */
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  /** 自启项面板列是否打开（2026-08-21 拍板：占一列的嵌入式列卡片） */
  const [autoStartOpen, setAutoStartOpen] = useState(false)
  /** 新手引导是否显示（首次打开） */
  const [showOnboarding, setShowOnboarding] = useState(false)
  /** 系统当前亮暗（主题"跟随系统"用） */
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const searchRef = useRef<HTMLInputElement>(null)
  /** 自启 icon 引用（自启面板定位锚点） */
  const autoStartBtnRef = useRef<HTMLButtonElement>(null)

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
      // 网站常驻（2026-08-21 拍板）：打开 Reopen 自动把网页项目拉回在线（服务类保持手动）
      for (const p of ps) {
        if (p.type !== 'web') continue
        const r = await window.api.startProject(p.id)
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

  // ⌘F 展开并聚焦搜索框（应用内快捷键；2026-08-20 搜索改收起式后同步调整）
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

  // 左上角应用菜单的动作（menu.ts 发送）
  useEffect(() => {
    const off = window.api.onMenuAction((action) => {
      if (action === 'add-project') setForm({ mode: 'manual' })
      else if (action === 'focus-search') searchRef.current?.focus()
      else if (action === 'set-view-list') updateSettings({ view: 'list' })
      else if (action === 'set-view-card') updateSettings({ view: 'card' })
      else if (action === 'settings') window.api.openSettingsWindow()
      else if (action === 'about') toast('Reopen 0.1.0（VC复活点）')
      else if (action === 'check-update') toast('检查更新随 M4 发布里程碑上线')
    })
    return off
  }, [toast, updateSettings])

  // 已有标签聚合（表单联想下拉的数据源；2026-08-21 拍板：标签无颜色，列表/卡片不展示）
  const allTags = useMemo(() => [...new Set(projects.flatMap((p) => p.tags))].sort(), [projects])

  // 组 → 子项映射（2026-08-21 项目组：子项按登记顺序固定在组内）
  const childrenMap = useMemo(() => {
    const m = new Map<string, Project[]>()
    for (const p of projects) {
      if (!p.parentId) continue
      const arr = m.get(p.parentId)
      if (arr) arr.push(p)
      else m.set(p.parentId, [p])
    }
    for (const arr of m.values()) arr.sort((a, b) => a.createdAt - b.createdAt)
    return m
  }, [projects])

  const childrenOf = useCallback(
    (id: string): Project[] => childrenMap.get(id) ?? [],
    [childrenMap]
  )

  const toggleGroup = (id: string): void => {
    setExpandedGroups((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 分类 + 搜索 + 排序（PRD 3.3；排序体系 2026-08-20 重做：名称/最近打开/添加日期/标签/无）
  // 2026-08-21 项目组：顶层视角——组与独立项目同层，子项只随组出现；组按子项内容进分类
  const visibleProjects = useMemo(() => {
    let list = projects.filter((p) => !p.parentId)
    const groupHas = (g: Project, type: 'service' | 'web'): boolean =>
      childrenOf(g.id).some((c) => c.type === type)
    if (category === 'service') {
      list = list.filter(
        (p) => p.type === 'service' || (p.type === 'group' && groupHas(p, 'service'))
      )
    } else if (category === 'web') {
      list = list.filter((p) => p.type === 'web' || (p.type === 'group' && groupHas(p, 'web')))
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
    if (settings.sortMode === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    } else if (settings.sortMode === 'created') {
      list.sort((a, b) => b.createdAt - a.createdAt)
    } else if (settings.sortMode === 'recent') {
      list.sort(
        (a, b) => (b.lastStartedAt ?? 0) - (a.lastStartedAt ?? 0) || b.createdAt - a.createdAt
      )
    } else if (settings.sortMode === 'tag') {
      // 按第一个标签分组：无标签排最后；组间按标签名，组内按名称
      const tagOf = (p: Project): string => p.tags[0] ?? ''
      list.sort((a, b) => {
        const ta = tagOf(a)
        const tb = tagOf(b)
        if (ta !== tb) {
          if (!ta) return 1
          if (!tb) return -1
          return ta.localeCompare(tb, 'zh')
        }
        return a.name.localeCompare(b.name, 'zh')
      })
    } else {
      // 'none'：手动拖拽顺序：按 settings.manualOrder，没记录过的排后面
      const order = settings.manualOrder
      list.sort((a, b) => {
        const ia = order.indexOf(a.id)
        const ib = order.indexOf(b.id)
        if (ia === -1 && ib === -1) return a.createdAt - b.createdAt
        if (ia === -1) return 1
        if (ib === -1) return -1
        return ia - ib
      })
    }
    return list
  }, [projects, category, search, settings.sortMode, settings.manualOrder, childrenOf])

  // 标签排序时给每个项目标注"是否需要插组头"（组头 = 第一个标签或「无标签」；2026-08-21 起无颜色，只留文字）
  // 2026-08-21 项目组：展开的组后面紧跟其子项（子项无组头、不参与顶层排序）
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
      // 只在列表视图展开插子项；卡片视图子项收纳在组卡/组抽屉里（2026-08-21 实测重做）
      if (settings.view === 'list' && p.type === 'group' && expandedGroups.has(p.id)) {
        for (const c of childrenOf(p.id)) items.push({ p: c, header: null })
      }
    }
    return items
  }, [visibleProjects, settings.sortMode, expandedGroups, childrenOf, settings.view])

  // 2026-08-21 项目组：条目数按顶层算（组算 1 个）；组按子项内容计入分类
  const counts = useMemo(
    () => ({
      all: projects.filter((p) => !p.parentId).length,
      service: projects.filter(
        (p) =>
          !p.parentId &&
          (p.type === 'service' ||
            (p.type === 'group' && childrenOf(p.id).some((c) => c.type === 'service')))
      ).length,
      web: projects.filter(
        (p) =>
          !p.parentId &&
          (p.type === 'web' ||
            (p.type === 'group' && childrenOf(p.id).some((c) => c.type === 'web')))
      ).length
    }),
    [projects, childrenOf]
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
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const path = window.api.getPathForFile(files[0])
    if (!path) return
    handleDetectOutcome(await window.api.detectPath(path))
  }

  // 「+」按钮：打开访达选文件夹 → 自动识别 → 补信息（2026-08-20 拍板）
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

  // 自启项（PRD 3.5）
  const autoStartItems = useMemo(
    () =>
      settings.autoStartIds
        .map((id) => projects.find((p) => p.id === id))
        .filter(Boolean) as Project[],
    [settings.autoStartIds, projects]
  )

  const addToAutoStart = (id: string): void => {
    if (settings.autoStartIds.includes(id)) return
    const p = projects.find((x) => x.id === id)
    // 2026-08-21 拍板：组内子项不能单独自启，自启打在组上（只拉成品子项）
    if (p?.parentId) {
      toast('组内子项不能单独自启——请把整个组拖进来', 'error')
      return
    }
    updateSettings({ autoStartIds: [...settings.autoStartIds, id] })
    toast(
      p?.type === 'group'
        ? '已加入自启项：打开 Reopen 只自动拉起组里的成品网站'
        : '已加入自启项：打开 Reopen 会自动启动它'
    )
  }

  const removeFromAutoStart = (id: string): void => {
    updateSettings({ autoStartIds: settings.autoStartIds.filter((x) => x !== id) })
  }

  // 自启面板已改为 .app-body 内占一列的嵌入式列卡片（2026-08-21 拍板）：挤入时项目自动让一列，不遮挡

  // 自启面板关闭：Esc / 点面板外（点 icon 由 toggle 处理；拖拽期间 mousedown 不触发，天然不关）
  useEffect(() => {
    if (!autoStartOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAutoStartOpen(false)
    }
    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return // 右键等不关面板（2026-08-21）
      const panel = document.querySelector('.autostart-panel')
      if (!panel || panel.contains(e.target as Node)) return
      if (autoStartBtnRef.current?.contains(e.target as Node)) return
      // 按在项目行/卡片上=准备拖拽进面板，不能关（2026-08-20/21 实测反馈：一按下面板就关了，拖不进去）
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

  /** 松手后的平滑移动动画（FLIP，2026-08-21 拍板）：重排前记旧位置 → 重排后反向位移 → 过渡归零 */
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

  const handleRowDrop = (e: React.DragEvent, target: Project): void => {
    // 文件拖入不归行处理，冒泡给窗口的登记逻辑
    if (e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    const id = e.dataTransfer.getData('application/x-reopen-id') || dragId
    setDragId(null)
    setDragOverId(null)
    if (!id || id === target.id) return
    const order =
      settings.manualOrder.length > 0 ? [...settings.manualOrder] : projects.map((p) => p.id)
    const from = order.indexOf(id)
    if (from !== -1) order.splice(from, 1)
    const to = order.indexOf(target.id)
    // 插到目标行后面（to+1）：拖 A 到 B 上 = A 移到 B 后面。
    // 之前插目标前面，拖到相邻行等于原位，看起来"拖了根本不会排序"（2026-08-20 实测反馈）
    order.splice(to === -1 ? order.length : to + 1, 0, id)
    // 重排前记录所有项目元素的位置，供松手后的平滑移动动画使用
    const before = new Map<HTMLElement, { x: number; y: number }>()
    document.querySelectorAll<HTMLElement>('.project-row, .card').forEach((el) => {
      const r = el.getBoundingClientRect()
      before.set(el, { x: r.left, y: r.top })
    })
    void updateSettings({ manualOrder: order }).then(() => animateFlip(before))
  }

  const handleStart = async (p: Project): Promise<void> => {
    const res = await window.api.startProject(p.id)
    if (!res.ok) toast(res.reason ?? '启动失败', 'error')
    else if (res.reason) toast(res.reason, 'success')
  }

  const handleOpenBrowser = async (p: Project): Promise<void> => {
    const res = await window.api.openProjectBrowser(p.id)
    if (!res.ok) toast(res.reason ?? '打开失败', 'error')
  }

  // 右键菜单项（随运行状态变化；PRD 3.3）
  const menuItems = (p: Project): MenuItem[] => {
    // 组（2026-08-21 项目组）：不启动，只有编辑/删除
    if (p.type === 'group') {
      return [
        {
          label: '编辑',
          icon: <Pencil size={14} />,
          onClick: () => setForm({ mode: 'edit', project: p })
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
    if (st === 'running' || st === 'starting') {
      items.push({
        label: '停止',
        icon: <Square size={14} />,
        onClick: () => window.api.stopProject(p.id)
      })
    } else {
      items.push({
        label: '启动',
        icon: <Play size={14} />,
        onClick: () => handleStart(p)
      })
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
      label: '删除',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => setDeleteTarget(p)
    })
    return items
  }

  // 项目文件夹被移动后的找回：访达选新位置 → 更新路径（2026-08-20 用户提问，启动时标红提示引导到这里）
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
      parentId: p.parentId
    })
    setProjects((ps) => ps.map((x) => (x.id === updated.id ? updated : x)))
    toast(`已重新定位「${updated.name}」`, 'success')
  }

  const handleFormSubmit = async (input: NewProjectInput): Promise<void> => {
    if (form?.mode === 'edit' && form.project) {
      const updated = await window.api.updateProject(form.project.id, input)
      setProjects((ps) => ps.map((p) => (p.id === updated.id ? updated : p)))
      toast(`已保存「${updated.name}」`, 'success')
    } else {
      const project = await window.api.addProject(input)
      setProjects((ps) => [...ps, project])
      toast(`已添加「${project.name}」`, 'success')
      // 网站常驻（2026-08-21 拍板）：网页类型登记提交即上线，端口挂在行上随时点开
      if (project.type === 'web') {
        const r = await window.api.startProject(project.id)
        if (!r.ok && r.reason) toast(r.reason, 'error')
      }
    }
    setForm(null)
  }

  /** 组预览确认：登记组 + 按勾选顺序登记子项（成品先勾选的在前），成品子项登记即上线（2026-08-21 拍板） */
  const handleGroupCreate = async (name: string, selected: DetectSuccess[]): Promise<void> => {
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
        openBrowser: false,
        note: '',
        tags: [],
        parentId: group.id
      })
      added.push(child)
      // 成品网页登记即上线（网站常驻）
      if (child.type === 'web') {
        const r = await window.api.startProject(child.id)
        if (!r.ok && r.reason) toast(r.reason, 'error')
      }
    }
    setProjects((ps) => [...ps, ...added])
    setMulti(null)
    // 新组默认展开，登记完立刻能看到子项
    setExpandedGroups((s) => new Set(s).add(group.id))
    toast(`已登记项目组「${name}」（${selected.length} 个子项）`, 'success')
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
    // 组（2026-08-21 项目组）：先停掉在线的子项、删子项，再删组本身
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
    await window.api.deleteProject(deleteTarget.id)
    if (selectedId === deleteTarget.id) setSelectedId(null)
    setDeleteTarget(null)
  }

  // ---------- 标签管理（2026-08-21 拍板：侧栏标签右键 重命名/删除/染色，颜色填进标签 icon） ----------

  /** 标签 → 染色（默认无色） */
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
        parentId: p.parentId
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
    if (color) {
      const next = { ...settings.tagColors }
      delete next[old]
      next[trimmed] = color
      await updateSettings({ tagColors: next })
    }
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
    await updateSettings({ tagColors: next })
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

  /** 标签右键菜单项（2026-08-21 拍板：染色不是弹窗，而是菜单里内嵌渐变色板滑块+无色按钮） */
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
            // 选完颜色（或点无色）菜单立即关闭（2026-08-21 用户反馈）
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

  const selectedProject = projects.find((p) => p.id === selectedId) ?? null

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
        if (e.currentTarget === e.target) {
          setDragOver(false)
          setDragOverId(null)
        }
      }}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-box">松手，登记这个项目</div>
        </div>
      )}

      <Sidebar
        category={category}
        tags={allTags}
        tagColor={tagColor}
        counts={counts}
        onSelect={setCategory}
        onTagContextMenu={(tag, e) => setTagMenu({ x: e.clientX, y: e.clientY, tag })}
      />

      <div className="app-right">
        <div className="app-body">
          <div className="app-main">
            {/* toolbar 属中间栏：右栏滑出时随中间整体挤压（2026-08-20 拍板） */}
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
              autoStartCount={settings.autoStartIds.length}
              autoStartEnabled={settings.autoStartEnabled}
              searchInputRef={searchRef}
              autoStartBtnRef={autoStartBtnRef}
            />

            <main className="project-list" data-tour="list">
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
                    // 组行（2026-08-21 项目组）：展开/收起，子项由 listItems 顺序跟随
                    <Fragment key={p.id}>
                      {header && <div className="list-group-header">{header.label}</div>}
                      <GroupRow
                        group={p}
                        expanded={expandedGroups.has(p.id)}
                        onToggle={() => toggleGroup(p.id)}
                        childrenCount={childrenOf(p.id).length}
                        onlineCount={
                          childrenOf(p.id).filter((c) => statuses[c.id]?.status === 'running')
                            .length
                        }
                        tagColor={tagColor}
                        autoStartChecked={settings.autoStartIds.includes(p.id)}
                        onContextMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, project: p })}
                        sortDraggable={settings.sortMode === 'none' || settings.autoStartEnabled}
                        dragging={dragId === p.id}
                        dropTarget={dragOverId === p.id}
                        onDragStart={(e) => handleRowDragStart(e, p)}
                        onDragOver={(e) => {
                          if (!e.dataTransfer.types.includes('Files')) {
                            e.preventDefault()
                            setDragOverId(p.id)
                          }
                        }}
                        onDragEnd={() => {
                          setDragId(null)
                          setDragOverId(null)
                        }}
                        onDrop={(e) => handleRowDrop(e, p)}
                      />
                    </Fragment>
                  ) : (
                    <Fragment key={p.id}>
                      {header && <div className="list-group-header">{header.label}</div>}
                      <ProjectRow
                        project={p}
                        status={statuses[p.id]}
                        onOpen={() => setSelectedId(p.id)}
                        onStart={() => handleStart(p)}
                        onStop={() => window.api.stopProject(p.id)}
                        onContextMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, project: p })}
                        sortDraggable={
                          !p.parentId && (settings.sortMode === 'none' || settings.autoStartEnabled)
                        }
                        dragging={dragId === p.id}
                        dropTarget={dragOverId === p.id}
                        onDragStart={(e) => handleRowDragStart(e, p)}
                        onDragOver={(e) => {
                          if (!e.dataTransfer.types.includes('Files')) {
                            e.preventDefault()
                            setDragOverId(p.id)
                          }
                        }}
                        onDragEnd={() => {
                          setDragId(null)
                          setDragOverId(null)
                        }}
                        onDrop={(e) => handleRowDrop(e, p)}
                        autoStartChecked={settings.autoStartIds.includes(p.id)}
                        tagColor={tagColor}
                        onOpenBrowser={() => handleOpenBrowser(p)}
                        isChild={Boolean(p.parentId)}
                      />
                    </Fragment>
                  )
                )
              ) : (
                <CardView
                  items={listItems}
                  statuses={statuses}
                  autoStartIds={settings.autoStartIds}
                  dragId={dragId}
                  dragOverId={dragOverId}
                  sortDraggable={settings.sortMode === 'none' || settings.autoStartEnabled}
                  onDragStart={(e, p) => handleRowDragStart(e, p)}
                  onDragOver={(e, p) => {
                    if (!e.dataTransfer.types.includes('Files')) {
                      e.preventDefault()
                      setDragOverId(p.id)
                    }
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setDragOverId(null)
                  }}
                  onDrop={(e, p) => handleRowDrop(e, p)}
                  tagColor={tagColor}
                  onOpen={(p) => setSelectedId(p.id)}
                  onOpenBrowser={(p) => handleOpenBrowser(p)}
                  onStart={handleStart}
                  onStop={(p) => window.api.stopProject(p.id)}
                  onContextMenu={(e, p) => setMenu({ x: e.clientX, y: e.clientY, project: p })}
                  childrenOf={childrenOf}
                />
              )}
            </main>
          </div>

          {autoStartOpen && settings.autoStartEnabled && (
            <AutoStartPanel
              items={autoStartItems}
              onRemove={removeFromAutoStart}
              onDropId={addToAutoStart}
            />
          )}

          {selectedProject && (
            <DetailDrawer
              project={selectedProject}
              status={statuses[selectedProject.id]}
              logs={logs[selectedProject.id] ?? []}
              onStart={() => handleStart(selectedProject)}
              onStop={() => window.api.stopProject(selectedProject.id)}
              onEdit={() => setForm({ mode: 'edit', project: selectedProject })}
              onDelete={() => setDeleteTarget(selectedProject)}
              onOpenBrowser={() => handleOpenBrowser(selectedProject)}
              onClose={() => setSelectedId(null)}
              // 组视图（2026-08-21 项目组）：子项列表，可逐个启停/点端口
              groupChildren={
                selectedProject.type === 'group' ? childrenOf(selectedProject.id) : undefined
              }
              statuses={statuses}
              onChildStart={handleStart}
              onChildStop={(c) => window.api.stopProject(c.id)}
              onChildOpenBrowser={handleOpenBrowser}
              onChildOpen={(c) => setSelectedId(c.id)}
            />
          )}
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

      {/* 多项目容器 → 项目组预览勾选（2026-08-21 拍板）：确认后登记成组 */}
      {multi && (
        <GroupPreviewModal
          multi={multi}
          onConfirm={handleGroupCreate}
          onCancel={() => setMulti(null)}
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

      <Toast toasts={toasts} />

      {showOnboarding && (
        <Onboarding
          onDone={() => {
            updateSettings({ onboarded: true })
            setShowOnboarding(false)
          }}
        />
      )}
    </div>
  )
}
