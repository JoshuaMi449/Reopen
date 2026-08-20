import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Pencil, Play, Square, Trash2 } from 'lucide-react'
import type {
  DetectNeedParseApp,
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
import { ProjectFormModal } from './components/ProjectFormModal'
import { ProjectRow } from './components/ProjectRow'
import { Sidebar, Category } from './components/Sidebar'
import { Toast, ToastData } from './components/Toast'
import { Toolbar } from './components/Toolbar'

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

// 访达式彩色标签色板（新标签按序分配）
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
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [category, setCategory] = useState<Category>('all')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [appPrompt, setAppPrompt] = useState<DetectNeedParseApp | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [toasts, setToasts] = useState<ToastData[]>([])
  const [dragOver, setDragOver] = useState(false)
  /** 行排序拖拽中的项目 id（仅手动排序模式） */
  const [dragId, setDragId] = useState<string | null>(null)
  /** 自启项气泡面板是否打开 */
  const [autoStartOpen, setAutoStartOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

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
    window.api.listProjects().then((ps) => {
      setProjects(ps)
      window.api.adoptAllRunning()
    })
    window.api.getSettings().then(setSettings)
  }, [])

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

  // ⌘F 聚焦搜索框（应用内快捷键）
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // 已有标签聚合（颜色在展示时惰性分配：settings.tagColors 有则用，没有按色板顺序 fallback）
  const allTags = useMemo(() => [...new Set(projects.flatMap((p) => p.tags))].sort(), [projects])

  // 分类 + 搜索 + 排序（PRD 3.3）
  const visibleProjects = useMemo(() => {
    let list = [...projects]
    if (category === 'service') list = list.filter((p) => p.type === 'service')
    else if (category === 'web') list = list.filter((p) => p.type === 'web')
    else if (category === 'recent') list = list.filter((p) => p.lastStartedAt)
    else if (category.startsWith('tag:')) {
      const tag = category.slice(4)
      list = list.filter((p) => p.tags.includes(tag))
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.note.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
          p.port?.toString().includes(q)
      )
    }
    if (settings.sortMode === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    } else if (settings.sortMode === 'recent') {
      list.sort(
        (a, b) => (b.lastStartedAt ?? 0) - (a.lastStartedAt ?? 0) || b.createdAt - a.createdAt
      )
    } else {
      // 手动排序：按 settings.manualOrder，没记录过的排后面
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
  }, [projects, category, search, settings.sortMode, settings.manualOrder])

  const counts = useMemo(
    () => ({
      all: projects.length,
      recent: projects.filter((p) => p.lastStartedAt).length,
      service: projects.filter((p) => p.type === 'service').length,
      web: projects.filter((p) => p.type === 'web').length
    }),
    [projects]
  )

  // 文件拖入登记（PRD 3.2：拖入 → 识别 → 表单/询问）
  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const path = window.api.getPathForFile(files[0])
    if (!path) return
    const outcome = await window.api.detectPath(path)
    if (outcome.ok) {
      setForm({ mode: 'create', detect: outcome })
    } else if (outcome.kind === 'unsupported-app') {
      setAppPrompt(outcome)
    } else if (outcome.kind === 'no-match') {
      toast(outcome.reason, 'error')
    } else if (outcome.kind === 'duplicate') {
      toast(`「${outcome.name}」已经登记过了，不用重复添加`)
    }
  }

  // 行拖拽：手动排序 + 拖入自启项气泡面板共用
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
    updateSettings({ autoStartIds: [...settings.autoStartIds, id] })
    toast('已加入自启项：打开 Reopen 会自动启动它')
  }

  const removeFromAutoStart = (id: string): void => {
    updateSettings({ autoStartIds: settings.autoStartIds.filter((x) => x !== id) })
  }

  const handleRowDrop = (e: React.DragEvent, target: Project): void => {
    // 文件拖入不归行处理，冒泡给窗口的登记逻辑
    if (e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    const id = dragId ?? e.dataTransfer.getData('application/x-reopen-id')
    setDragId(null)
    if (!id || id === target.id) return
    const order =
      settings.manualOrder.length > 0 ? [...settings.manualOrder] : projects.map((p) => p.id)
    const from = order.indexOf(id)
    if (from !== -1) order.splice(from, 1)
    const to = order.indexOf(target.id)
    order.splice(to === -1 ? order.length : to, 0, id)
    updateSettings({ manualOrder: order })
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
      label: '删除',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => setDeleteTarget(p)
    })
    return items
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
    }
    setForm(null)
  }

  const handleParseApp = async (): Promise<void> => {
    if (!appPrompt) return
    const outcome = await window.api.parseApp(appPrompt.path)
    setAppPrompt(null)
    if (outcome.ok) {
      setForm({ mode: 'create', detect: outcome })
    } else if (outcome.kind === 'no-match') {
      toast(outcome.reason, 'error')
    } else if (outcome.kind === 'duplicate') {
      toast(`「${outcome.name}」已经登记过了，不用重复添加`)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    await window.api.deleteProject(deleteTarget.id)
    setProjects((ps) => ps.filter((p) => p.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

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
        if (e.currentTarget === e.target) setDragOver(false)
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
        tags={allTags.map((t, i) => ({
          name: t,
          color: settings.tagColors[t] ?? TAG_COLORS[i % TAG_COLORS.length]
        }))}
        counts={counts}
        onSelect={setCategory}
      />

      <div className="app-main">
        <Toolbar
          search={search}
          onSearch={setSearch}
          view={settings.view}
          onView={(v) => updateSettings({ view: v })}
          sortMode={settings.sortMode}
          onSort={(m) => updateSettings({ sortMode: m })}
          onAdd={() => setForm({ mode: 'manual' })}
          onOpenSettings={() => toast('偏好设置在 M3-5 实现，先记着')}
          onOpenAutoStart={() => setAutoStartOpen(!autoStartOpen)}
          autoStartCount={settings.autoStartIds.length}
          searchInputRef={searchRef}
        />

        <main className="project-list">
          {projects.length === 0 ? (
            <div className="empty">
              还没有项目。
              <br />
              把一个项目文件夹或 html 文件拖进这个窗口试试。
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="empty">没有符合条件的项目。</div>
          ) : settings.view === 'list' ? (
            visibleProjects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                status={statuses[p.id]}
                logs={logs[p.id] ?? []}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                onStart={() => handleStart(p)}
                onStop={() => window.api.stopProject(p.id)}
                onDelete={() => setDeleteTarget(p)}
                onContextMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, project: p })}
                sortDraggable={settings.sortMode === 'manual' || settings.autoStartEnabled}
                onDragStart={(e) => handleRowDragStart(e, p)}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes('Files')) e.preventDefault()
                }}
                onDrop={(e) => handleRowDrop(e, p)}
                autoStartChecked={settings.autoStartIds.includes(p.id)}
              />
            ))
          ) : (
            <CardView
              projects={visibleProjects}
              statuses={statuses}
              logs={logs}
              expandedId={expandedId}
              autoStartIds={settings.autoStartIds}
              onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
              onStart={handleStart}
              onStop={(p) => window.api.stopProject(p.id)}
              onDelete={(p) => setDeleteTarget(p)}
              onContextMenu={(e, p) => setMenu({ x: e.clientX, y: e.clientY, project: p })}
            />
          )}
        </main>
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

      {autoStartOpen && (
        <AutoStartPanel
          items={autoStartItems}
          enabled={settings.autoStartEnabled}
          onToggleEnabled={() => updateSettings({ autoStartEnabled: !settings.autoStartEnabled })}
          onRemove={removeFromAutoStart}
          onDropId={addToAutoStart}
          onClose={() => setAutoStartOpen(false)}
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
          title="删除项目"
          message={`确定把「${deleteTarget.name}」从 Reopen 移除吗？\n只从 Reopen 移除登记，不删你电脑上的原文件。`}
          confirmText="移除"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <Toast toasts={toasts} />
    </div>
  )
}
