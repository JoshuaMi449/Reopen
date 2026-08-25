import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ExternalLink,
  Eye,
  FileCode2,
  Folder,
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
  /** 打开默认入口（主按钮）；带 entry 参数=打开指定入口页面（多入口列表） */
  onOpenBrowser(entry?: string): void
  onClose(): void
  /** 左上角返回（组页面里的子项详情返回组页面，组重设计后保留） */
  onBack?(): void
  /** 启动失败后的「看成品」兜底按钮（ */
  onViewPreview?(): void
  /** 失败提示区的一键修复按钮（如"帮我装依赖"） */
  onInstallDeps?(): void
  /** 同目录残留 dev 进程的「终止残留并启动」按钮（ */
  onKillResidual?(): void
  /** 本机局域网 IP（非空=局域网访问开着，端口旁显示局域网地址）*/
  lanIp?: string
  /** 局域网打不开时「由本应用托管」（接管服务没开门） */
  onRehost?(): void
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

/** 右侧滑出的项目详情抽屉（用户列表/卡片共用一个预览区，不再行内展开） */
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
  onBack,
  onViewPreview,
  onInstallDeps,
  onKillResidual,
  lanIp,
  onRehost
}: Props): React.JSX.Element {
  const logRef = useRef<HTMLDivElement>(null)
  // 局域网地址复制反馈（点击=复制不再跳转）
  const [lanCopied, setLanCopied] = useState(false)

  // 日志自动滚到底
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const st = status?.status ?? 'stopped'
  const active = st === 'running' || st === 'starting'
  // 全部网页入口（老数据只有 entryPath 一个，entryPaths 存在则用之）
  const entryList = project.entryPaths ?? (project.entryPath ? [project.entryPath] : [])
  // 组不再弹抽屉，这里都是普通项目详情
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
              {status?.lanReachable === true && (status?.port ?? project.port) && (
                <span
                  className={`drawer-lan ${lanCopied ? 'lan-copied' : ''}`}
                  title="局域网地址（点击复制）"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      `http://${status?.lanIp ?? lanIp}:${status?.port ?? project.port}`
                    )
                    setLanCopied(true)
                    setTimeout(() => setLanCopied(false), 1500)
                  }}
                >
                  局域网 {status?.lanIp ?? lanIp}:{status?.port ?? project.port}
                  {lanCopied && <span className="lan-copied-tag">已复制 ✓</span>}
                </span>
              )}
              {status?.lanReachable === false && (
                <span
                  className="lan-blocked"
                  title={
                    status.spawned === true
                      ? '这个服务是本应用拉起的，在项目的启动命令里加 --host 0.0.0.0 才能局域网访问'
                      : '这个服务只绑了本机，同一 Wi-Fi 的其他设备访问不了'
                  }
                >
                  仅本机可访问
                  {status.spawned !== true && (
                    <button
                      className="lan-rehost"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRehost?.()
                      }}
                    >
                      由本应用托管
                    </button>
                  )}
                </span>
              )}
            </b>
          </div>
          <div>
            <span className="drawer-meta-label">上次启动</span>
            <b>{formatTime(project.lastStartedAt)}</b>
          </div>
          {/* 多入口列表（纯网页项目里多个页面，点哪个打开哪个） */}
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
          {/* 纯网页（无需激活、永远在线——没有启动/停止/重启，只有「在浏览器打开」 */}
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

        {/* 失败原因放在日志上方（用户报错信息显示在日志的上面） */}
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
            {status.fix?.kind === 'kill-residue' && (
              <button className="btn-mini" onClick={onKillResidual}>
                <Wrench size={12} /> {status.fix.label}
              </button>
            )}
          </div>
        )}

        <div className="drawer-log" ref={logRef} data-tour="log-panel">
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
