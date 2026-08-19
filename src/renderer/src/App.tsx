import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DetectNeedParseApp,
  DetectSuccess,
  NewProjectInput,
  Project,
  ProjectLogEvent,
  ProjectStatusEvent
} from '../../shared/types'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ProjectFormModal } from './components/ProjectFormModal'
import { ProjectRow } from './components/ProjectRow'
import { Toast, ToastData } from './components/Toast'

interface FormState {
  detect: DetectSuccess
}

export default function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [statuses, setStatuses] = useState<Record<string, ProjectStatusEvent>>({})
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [appPrompt, setAppPrompt] = useState<DetectNeedParseApp | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [toasts, setToasts] = useState<ToastData[]>([])
  const [dragOver, setDragOver] = useState(false)

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

  // 初始加载项目清单
  useEffect(() => {
    window.api.listProjects().then(setProjects)
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

  // 拖拽登记（PRD 3.2：拖入 → 识别 → 表单/询问）
  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const path = window.api.getPathForFile(files[0])
    if (!path) return
    const outcome = await window.api.detectPath(path)
    if (outcome.ok) {
      setForm({ detect: outcome })
    } else if (outcome.kind === 'unsupported-app') {
      setAppPrompt(outcome)
    } else if (outcome.kind === 'no-match') {
      toast(outcome.reason, 'error')
    }
  }

  const handleStart = async (p: Project): Promise<void> => {
    const res = await window.api.startProject(p.id)
    if (!res.ok) toast(res.reason ?? '启动失败', 'error')
  }

  const handleFormSubmit = async (input: NewProjectInput): Promise<void> => {
    const project = await window.api.addProject(input)
    setProjects((ps) => [...ps, project])
    setForm(null)
    toast(`已添加「${project.name}」`, 'success')
  }

  const handleParseApp = async (): Promise<void> => {
    if (!appPrompt) return
    const outcome = await window.api.parseApp(appPrompt.path)
    setAppPrompt(null)
    if (outcome.ok) {
      setForm({ detect: outcome })
    } else if (outcome.kind === 'no-match') {
      toast(outcome.reason, 'error')
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
        e.preventDefault()
        setDragOver(true)
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

      <header className="app-header">
        <h1>Reopen</h1>
        <span className="hint">把项目文件夹或 html 文件拖进窗口，自动识别登记</span>
      </header>

      <main className="project-list">
        {projects.length === 0 ? (
          <div className="empty">
            还没有项目。
            <br />
            把一个项目文件夹或 html 文件拖进这个窗口试试。
          </div>
        ) : (
          projects.map((p) => (
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
            />
          ))
        )}
      </main>

      {form && (
        <ProjectFormModal
          detect={form.detect}
          onSubmit={handleFormSubmit}
          onCancel={() => setForm(null)}
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
