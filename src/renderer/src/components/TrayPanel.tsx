import { useEffect, useMemo, useState } from 'react'
import {
  ExternalLink,
  FileCode2,
  Folder,
  MonitorPlay,
  Settings as SettingsIcon,
  MonitorPause,
  XCircle
} from 'lucide-react'
import type { Project, ProjectStatusEvent } from '../../../shared/types'

/** 托盘（右上角菜单栏图标）弹出的小面板（PRD 3.7） */
export function TrayPanel(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [statuses, setStatuses] = useState<Record<string, ProjectStatusEvent>>({})

  useEffect(() => {
    window.api.listProjects().then(setProjects)
    window.api.adoptAllRunning()

    const offStatus = window.api.onStatus((e: ProjectStatusEvent) => {
      setStatuses((s) => ({ ...s, [e.id]: e }))
    })
    const offLog = window.api.onLog(() => {
      // 面板不显示日志，忽略
    })
    return () => {
      offStatus()
      offLog()
    }
  }, [])

  const runningCount = useMemo(
    () => Object.values(statuses).filter((s) => s.status === 'running').length,
    [statuses]
  )

  const toggle = (p: Project): void => {
    const st = statuses[p.id]?.status ?? 'stopped'
    if (st === 'running' || st === 'starting') {
      window.api.stopProject(p.id)
    } else {
      window.api.startProject(p.id)
    }
  }

  const openBrowser = (p: Project): void => {
    window.api.openProjectBrowser(p.id)
  }

  return (
    <div className="tray-panel">
      <div className="tray-head">
        <span className="tray-title">Reopen</span>
        <span className="tray-running">{runningCount} 个运行中</span>
      </div>

      <div className="tray-list">
        {projects.length === 0 ? (
          <div className="tray-empty">还没有项目。打开 Reopen 拖入你的项目吧。</div>
        ) : (
          projects.map((p) => {
            const st = statuses[p.id]?.status ?? 'stopped'
            const port = statuses[p.id]?.port ?? p.port
            return (
              <div
                key={p.id}
                className={`tray-item ${st === 'failed' ? 'tray-item-failed' : ''}`}
                title={st === 'failed' ? statuses[p.id]?.reason : undefined}
                onClick={() => toggle(p)}
              >
                <span className={`status-dot dot-${st}`} />
                <span className="tray-item-icon">
                  {p.type === 'service' ? <Folder size={13} /> : <FileCode2 size={13} />}
                </span>
                <span className="tray-item-name">{p.name}</span>
                <span className="tray-item-port">{port ? `:${port}` : ''}</span>
                {st === 'failed' ? (
                  <XCircle size={13} className="tray-item-fail-icon" />
                ) : (
                  <button
                    className="icon-btn tray-item-browser"
                    title="在浏览器打开"
                    onClick={(e) => {
                      e.stopPropagation()
                      openBrowser(p)
                    }}
                  >
                    <ExternalLink size={13} />
                  </button>
                )}
                {st === 'running' || st === 'starting' ? (
                  <MonitorPause size={13} className="tray-item-action" />
                ) : (
                  <MonitorPlay size={13} className="tray-item-action" />
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="tray-foot">
        <button className="tray-foot-btn" onClick={() => window.api.showMainWindow()}>
          打开主窗口
        </button>
        <button className="tray-foot-btn" onClick={() => window.api.showMainWindow('settings')}>
          <SettingsIcon size={12} />
          偏好设置
        </button>
        <button className="tray-foot-btn" onClick={() => window.api.quitApp()}>
          退出
        </button>
      </div>
    </div>
  )
}
