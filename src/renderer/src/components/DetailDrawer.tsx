import { useEffect, useRef } from 'react'
import {
  ChevronLeft,
  ExternalLink,
  Eye,
  FileCode2,
  Folder,
  Layers,
  MonitorPause,
  MonitorPlay,
  Pencil,
  RotateCcw,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import {
  hasPreviewFallback,
  isPureWeb,
  type Project,
  type ProjectStatusEvent
} from '../../../shared/types'

interface Props {
  project: Project
  status?: ProjectStatusEvent
  logs: string[]
  onStart(): void
  onStop(): void
  onEdit(): void
  onDelete(): void
  /** 打开默认入口（主按钮）；带 entry 参数=打开指定入口页面（多入口列表，2026-08-24 拍板） */
  onOpenBrowser(entry?: string): void
  onClose(): void
  /** 组的子项（2026-08-21 项目组：组抽屉显示子项列表，可逐个启停/点端口） */
  groupChildren?: Project[]
  statuses?: Record<string, ProjectStatusEvent>
  onChildStart?(p: Project): void
  onChildStop?(p: Project): void
  onChildOpenBrowser?(p: Project): void
  /** 点子项行：打开该子项自己的详情抽屉（看日志等，2026-08-21 实测补） */
  onChildOpen?(p: Project): void
  /** 左上角返回（组内子项的详情里返回组视图，2026-08-21 实测补） */
  onBack?(): void
  /** 启动失败后的「看成品」兜底按钮（2026-08-24 拍板） */
  onViewPreview?(): void
  /** 失败提示区的一键修复按钮（如"帮我装依赖"，2026-08-24 拍板） */
  onInstallDeps?(): void
  /** 本机局域网 IP（非空=局域网访问开着，端口旁显示局域网地址，2026-08-24） */
  lanIp?: string
}

const STATUS_TEXT: Record<string, string> = {
  stopped: '已停止',
  starting: '启动中…',
  running: '运行中',
  failed: '启动失败'
}

function formatTime(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 右侧滑出的项目详情抽屉（2026-08-20 用户拍板：列表/卡片共用一个预览区，不再行内展开） */
export function DetailDrawer({
  project,
  status,
  logs,
  onStart,
  onStop,
  onEdit,
  onDelete,
  onOpenBrowser,
  onClose,
  groupChildren,
  statuses,
  onChildStart,
  onChildStop,
  onChildOpenBrowser,
  onChildOpen,
  onBack,
  onViewPreview,
  onInstallDeps,
  lanIp
}: Props): React.JSX.Element {
  const logRef = useRef<HTMLDivElement>(null)

  // 日志自动滚到底
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const st = status?.status ?? 'stopped'
  const active = st === 'running' || st === 'starting'
  // 全部网页入口（2026-08-24 拍板：老数据只有 entryPath 一个，entryPaths 存在则用之）
  const entryList = project.entryPaths ?? (project.entryPath ? [project.entryPath] : [])
  // 组视图（2026-08-21 项目组）：子项列表，无日志区
  if (project.type === 'group' && groupChildren) {
    return (
      <aside className="drawer">
        <div className="drawer-inner">
          <div className="drawer-head">
            <span className="drawer-icon">
              <Layers size={15} />
            </span>
            <span className="drawer-name">{project.name}</span>
            <button className="icon-btn" title="关闭" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div className="drawer-meta">
            {project.tags.length > 0 && (
              <div className="drawer-tags">
                {project.tags.map((t) => (
                  <span key={t} className="card-tag">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="drawer-children">
            {groupChildren.length === 0 ? (
              <div className="log-empty">这个组里还没有子项目。</div>
            ) : (
              groupChildren.map((c) => {
                const cst = statuses?.[c.id]?.status ?? 'stopped'
                const cActive = cst === 'running' || cst === 'starting'
                const cPort = statuses?.[c.id]?.port ?? c.port
                return (
                  <div
                    key={c.id}
                    className="drawer-child"
                    onClick={() => onChildOpen?.(c)}
                    title="打开子项详情（日志）"
                  >
                    <span className={`status-dot dot-${cst}`} title={STATUS_TEXT[cst]} />
                    <span className="row-icon">
                      {c.type === 'service' ? <Folder size={15} /> : <FileCode2 size={15} />}
                    </span>
                    <span className="drawer-child-name">{c.name}</span>
                    {cActive && cPort ? (
                      <a
                        className="port-link"
                        title="在浏览器打开"
                        onClick={(e) => {
                          e.stopPropagation()
                          onChildOpenBrowser?.(c)
                        }}
                      >
                        :{cPort}
                        <ExternalLink size={11} />
                      </a>
                    ) : (
                      <span className="drawer-child-port">{cPort ? `:${cPort}` : ''}</span>
                    )}
                    {cActive ? (
                      <button
                        className="icon-btn"
                        title="停止"
                        onClick={(e) => {
                          e.stopPropagation()
                          onChildStop?.(c)
                        }}
                      >
                        <MonitorPause size={14} />
                      </button>
                    ) : (
                      <button
                        className="icon-btn"
                        title="启动"
                        onClick={(e) => {
                          e.stopPropagation()
                          onChildStart?.(c)
                        }}
                      >
                        <MonitorPlay size={14} />
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <div className="drawer-actions">
            <button className="btn-secondary" onClick={onEdit}>
              <Pencil size={14} /> 编辑
            </button>
            <button className="btn-danger" onClick={onDelete}>
              <Trash2 size={14} /> 删除
            </button>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="drawer">
      <div className="drawer-inner">
        <div className="drawer-head">
          {onBack && (
            <button className="icon-btn" title="返回组" onClick={onBack}>
              <ChevronLeft size={16} />
            </button>
          )}
          <span className={`status-dot dot-${st}`} />
          <span className="drawer-icon">
            {project.type === 'service' ? <Folder size={15} /> : <FileCode2 size={15} />}
          </span>
          <span className="drawer-name">{project.name}</span>
          <button className="icon-btn" title="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="drawer-meta">
          <div>
            <span className="drawer-meta-label">状态</span>
            <b>{STATUS_TEXT[st]}</b>
          </div>
          <div>
            <span className="drawer-meta-label">端口</span>
            <b>
              {status?.port ?? project.port ?? '—'}
              {lanIp && (status?.port ?? project.port) && (
                <span className="drawer-lan">
                  局域网 {lanIp}:{status?.port ?? project.port}
                </span>
              )}
            </b>
          </div>
          <div>
            <span className="drawer-meta-label">上次启动</span>
            <b>{formatTime(project.lastStartedAt)}</b>
          </div>
          {/* 多入口列表（2026-08-24 拍板：纯网页项目里多个页面，点哪个打开哪个） */}
          {isPureWeb(project) && entryList.length > 1 && (status?.port ?? project.port) && (
            <div className="drawer-meta drawer-entries">
              <span className="drawer-meta-label">页面（{entryList.length}）</span>
              <div className="drawer-entry-list">
                {entryList.map((ep, i) => (
                  <button
                    key={ep}
                    className="drawer-entry"
                    title={`在浏览器打开 ${ep}`}
                    onClick={() => onOpenBrowser(ep)}
                  >
                    <ExternalLink size={11} />
                    <span className="drawer-entry-name">{ep}</span>
                    {i === 0 && <span className="drawer-entry-main">主页</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {project.type === 'service' && (
            <div className="drawer-command">
              <span className="drawer-meta-label">命令</span>
              <b>{project.command ?? '—'}</b>
            </div>
          )}
          {st === 'failed' && status?.reason && (
            <div className="drawer-fail-reason">
              {status.reason}
              {hasPreviewFallback(project) && (
                <button className="btn-mini" onClick={onViewPreview}>
                  <Eye size={12} /> 看成品
                </button>
              )}
              {status.fix?.kind === 'npm-install' && (
                <button className="btn-mini" onClick={onInstallDeps}>
                  <Wrench size={12} /> {status.fix.label}
                </button>
              )}
            </div>
          )}
          {project.tags.length > 0 && (
            <div className="drawer-tags">
              {project.tags.map((t) => (
                <span key={t} className="card-tag">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="drawer-actions">
          {/* 纯网页（2026-08-24 拍板）：无需激活、永远在线——没有启动/停止/重启，只有「在浏览器打开」 */}
          {!isPureWeb(project) && (
            <>
              {active ? (
                <button className="btn-secondary" onClick={onStop}>
                  <MonitorPause size={14} /> 停止
                </button>
              ) : (
                <button className="btn-primary" onClick={onStart}>
                  <MonitorPlay size={14} /> 启动
                </button>
              )}
              <button className="btn-secondary" onClick={onStart} disabled={active}>
                <RotateCcw size={14} /> 重启
              </button>
            </>
          )}
          <button className="btn-secondary" onClick={() => onOpenBrowser()}>
            <ExternalLink size={14} /> 在浏览器打开
          </button>
          <button className="btn-secondary" onClick={onEdit}>
            <Pencil size={14} /> 编辑
          </button>
          <button className="btn-danger" onClick={onDelete}>
            <Trash2 size={14} /> 删除
          </button>
        </div>

        <div className="drawer-log" ref={logRef}>
          {logs.length === 0 ? (
            <div className="log-empty">还没有日志。点「启动」开始运行。</div>
          ) : (
            logs.map((line, i) => <div key={i}>{line}</div>)
          )}
        </div>
      </div>
    </aside>
  )
}
