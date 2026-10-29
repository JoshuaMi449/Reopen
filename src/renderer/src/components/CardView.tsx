import { Fragment, useState } from 'react'
import {
  ExternalLink,
  Eye,
  FileCode2,
  Folder,
  MonitorPause,
  MonitorPlay,
  MoreHorizontal,
  Pin,
  Tag,
  Zap
} from 'lucide-react'
import {
  hasPreviewFallback,
  isPureWeb,
  type Project,
  type ProjectStatusEvent
} from '../../../shared/types'

interface ListItem {
  p: Project
  /** 标签排序时：该项目前是否需要插组头（只留文字，无颜色） */
  header: { label: string } | null
}

interface Props {
  items: ListItem[]
  statuses: Record<string, ProjectStatusEvent>
  /** 自启项内的项目 id（打勾同步显示） */
  autoStartIds: string[]
  /** 标签 → 染色（有颜色时 Tag icon 填色；默认无色）*/
  tagColor(tag: string): string | undefined
  /** 正在被拖拽的项目 id（半透明拖影） */
  dragId: string | null
  /** 是否可拖拽（无排序时拖拽排序 / 自启总开关开时拖入面板，与列表行同规则） */
  sortDraggable: boolean
  onDragStart(e: React.DragEvent, p: Project): void
  onDragOver(e: React.DragEvent, p: Project): void
  onDragEnd(e: React.DragEvent): void
  onDrop(e: React.DragEvent, p: Project): void
  /** 文件夹卡作为收纳目标：项目拖上来高亮、松手收进文件夹（文件夹卡不参与排序） */
  onFolderDragOver(e: React.DragEvent, folder: Project): void
  onFolderDragLeave(e: React.DragEvent, folder: Project): void
  onFolderDrop(e: React.DragEvent, folder: Project): void
  /** 当前悬停的文件夹 id（高亮用） */
  dropOnFolder: string | null
  /** 文件夹卡「启动组内全部 / 停止组内全部」 */
  onFolderStart(folder: Project): void
  onFolderStop(folder: Project): void
  /** 点击卡片：打开右侧详情抽屉 */
  onOpen(p: Project): void
  /** 点端口在浏览器打开（运行中时端口可点，网站常驻） */
  onOpenBrowser(p: Project): void
  /** 局域网打不开时「由本应用托管」：停掉手动起的旧服务重新启动（对局域网开门） */
  onRehost?(p: Project): void
  /** 网页截图（dataURL；运行中才有，没有=用渐变色占位） */
  previewOf?(p: Project): string | undefined
  onStart(p: Project): void
  onStop(p: Project): void
  /** 启动失败后的「看成品」兜底按钮 */
  onViewPreview(p: Project): void
  onContextMenu(e: React.MouseEvent, p: Project): void
  /** 组 → 子项（项目组：组卡显示子项汇总+成品端口） */
  childrenOf(id: string): Project[]
  /** 框选多选中（高亮描边） */
  selected(p: Project): boolean
  /** 有选中时点击=切换选中（代替打开抽屉） */
  onSelectToggle(p: Project, e: React.MouseEvent): void
  /** 本机局域网 IP（非空=局域网访问开着，端口旁显示局域网地址）*/
  lanIp?: string
  /** 引导期演示卡片的假局域网地址（demo 卡片专用，引导结束消失）*/
  demoLanIp?: string
  /** 置顶项目 id（按置顶先后排；置顶区与菜单栏面板共用这份顺序） */
  pinnedIds: string[]
  /** 置顶/取消置顶（组卡没有置顶入口） */
  onTogglePin(p: Project): void
}

/** 文件夹组卡的色相池（按组 id 稳定取色，亮暗主题都用 color-mix 稀释） */
const FOLDER_HUES = [258, 205, 30, 152, 348]

function hashHue(id: string): number {
  let h = 7
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

function relTime(ts?: number): string {
  if (!ts) return '还没启动过'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

const STATUS_TEXT: Record<string, string> = {
  running: '运行中',
  starting: '启动中',
  stopped: '已停止',
  failed: '启动失败'
}

/** 卡片视图：组=文件夹卡，项目=截图卡（截图来自启动时抓的网页静态图） */
export function CardView({
  items,
  statuses,
  autoStartIds,
  tagColor,
  dragId,
  sortDraggable,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  dropOnFolder,
  onFolderStart,
  onFolderStop,
  onOpen,
  onOpenBrowser,
  onRehost,
  onStart,
  onStop,
  onViewPreview,
  onContextMenu,
  childrenOf,
  selected,
  onSelectToggle,
  lanIp,
  demoLanIp,
  previewOf,
  pinnedIds,
  onTogglePin
}: Props): React.JSX.Element {
  // 局域网地址复制反馈（点击=复制不再跳转；记录是哪张卡在显示「已复制」）
  const [lanCopiedId, setLanCopiedId] = useState<string | null>(null)
  // 局域网不通时的复制反馈：点复制 → 「复制失败」+ 托管按钮边框闪一下（引导开门）
  const [lanFailId, setLanFailId] = useState<string | null>(null)
  const [lanFlashId, setLanFlashId] = useState<string | null>(null)

  const pinnedSet = new Set(pinnedIds)
  // 置顶项按 settings.pinnedIds 的顺序（置顶先后），且只取当前可见的
  const pinned = pinnedIds
    .map((id) => items.find((i) => i.p.id === id))
    .filter((i): i is ListItem => !!i && i.p.type !== 'group')
  const groups = items.filter(({ p }) => p.type === 'group')
  const projects = items.filter(({ p }) => p.type !== 'group' && !pinnedSet.has(p.id))

  /** 项目卡（置顶区与项目区共用） */
  const renderProject = (p: Project, header: ListItem['header']): React.JSX.Element => {
              const st = statuses[p.id]?.status ?? 'stopped'
              const failed = st === 'failed'
              const active = st === 'running' || st === 'starting'
              const port = statuses[p.id]?.port ?? p.port ?? p.lastPort
              const ev = statuses[p.id]
              // 引导期 demo 卡片显示假局域网地址（演示用，引导结束消失）；
              // 正常项目以主进程实测为准：通→显示地址；不通→灰字（接管服务没开门时给托管按钮）
              const cardLan =
                p.id === 'demo-app' && demoLanIp
                  ? demoLanIp
                  : ev?.lanReachable === true
                    ? (ev.lanIp ?? lanIp)
                    : ''
              const lanBlocked = p.id !== 'demo-app' && ev?.lanReachable === false
              // 统一入口挂载成功（route/route-rewrite）→ 访客地址显示统一入口；其余沿用独立端口
              const mounted =
                (ev?.lanMode === 'route' || ev?.lanMode === 'route-rewrite') &&
                !!p.lanSlug &&
                !!ev?.gatewayPort
              const guestUrl = mounted
                ? `http://${ev?.lanIp ?? lanIp}:${ev?.gatewayPort}/rp/${p.lanSlug}/`
                : `http://${cardLan}:${port}`
              const shot = previewOf?.(p)
              const hue = hashHue(p.id)
              const isPinned = pinnedSet.has(p.id)
              return (
                <Fragment key={p.id}>
                  {header && <div className="list-group-header card-grid-full">{header.label}</div>}
                  <div
                    className={`wf-card ${failed ? 'wf-card-failed' : ''} ${
                      dragId === p.id ? 'dragging' : ''
                    } ${selected(p) ? 'selected' : ''}`}
                    data-pid={p.id}
                    data-tour={p.id === 'demo-app' ? 'demo-card' : undefined}
                    draggable={sortDraggable}
                    onDragStart={(e) => onDragStart(e, p)}
                    onDragOver={(e) => onDragOver(e, p)}
                    onDragEnd={onDragEnd}
                    onDrop={(e) => onDrop(e, p)}
                    onClick={(e) =>
                      e.metaKey || e.ctrlKey || e.shiftKey ? onSelectToggle(p, e) : onOpen(p)
                    }
                    onContextMenu={(e) => {
                      e.preventDefault()
                      onContextMenu(e, p)
                    }}
                  >
                    <div
                      className={`wf-thumb ${shot ? 'has-shot' : ''}`}
                      style={
                        shot
                          ? { backgroundImage: `url(${shot})` }
                          : {
                              backgroundImage: `linear-gradient(140deg, hsl(${hue} 44% 84%), hsl(${
                                (hue + 46) % 360
                              } 40% 68%))`
                            }
                      }
                    >
                      {!shot && (
                        <span className="wf-thumb-icon">
                          <span className="wf-thumb-glass">
                            {p.type === 'service' ? <Folder size={20} /> : <FileCode2 size={20} />}
                          </span>
                        </span>
                      )}
                      {/* 置顶只对顶层项目开放：组内子项不显示图钉 */}
                      {!p.parentId && (
                        <button
                          className={`wf-pin ${isPinned ? 'is-pinned' : ''}`}
                          title={isPinned ? '取消置顶' : '置顶（菜单栏面板顶部也显示）'}
                          data-tour={p.id === 'demo-app' ? 'pin' : undefined}
                          onClick={(e) => {
                            e.stopPropagation()
                            onTogglePin(p)
                          }}
                        >
                          <Pin size={13} />
                        </button>
                      )}
                      <button
                        className="wf-kebab"
                        title="更多操作"
                        onClick={(e) => {
                          e.stopPropagation()
                          onContextMenu(e, p)
                        }}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    </div>

                    <div className="wf-plate">
                      <div className={`wf-meta ${failed ? 'is-failed' : ''}`}>
                        <span className={`status-dot dot-${st}`} />
                        <span className="wf-meta-text">
                          {relTime(p.lastStartedAt)}
                          <i>·</i>
                          {STATUS_TEXT[st]}
                        </span>
                        <span
                          className="wf-type"
                          title={p.type === 'service' ? '本地服务' : '网页文件'}
                        >
                          {p.type === 'service' ? <Folder size={10} /> : <FileCode2 size={10} />}
                        </span>
                        {autoStartIds.includes(p.id) && (
                          <span className="wf-zap" title="在自启项里">
                            <Zap size={11} />
                          </span>
                        )}
                      </div>

                      <div className="wf-title" title={p.name}>
                        {p.name}
                      </div>

                      <div className="wf-actions">
                        {isPureWeb(p) ? (
                          <button
                            className="wf-run"
                            title="在浏览器打开"
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpenBrowser(p)
                            }}
                          >
                            <ExternalLink size={13} />
                          </button>
                        ) : active ? (
                          <button
                            className="wf-run"
                            title="停止"
                            onClick={(e) => {
                              e.stopPropagation()
                              onStop(p)
                            }}
                          >
                            <MonitorPause size={13} />
                          </button>
                        ) : (
                          <button
                            className="wf-run"
                            title="启动"
                            data-tour={p.id === 'demo-app' ? 'row-play' : undefined}
                            onClick={(e) => {
                              e.stopPropagation()
                              onStart(p)
                            }}
                          >
                            <MonitorPlay size={13} />
                          </button>
                        )}

                        {failed ? (
                          <>
                            <span
                              className="wf-fail"
                              title={`${statuses[p.id]?.reason ?? '点击卡片查看原因'}（点卡片看诊断）`}
                            >
                              启动失败
                            </span>
                            {hasPreviewFallback(p) && (
                              <button
                                className="wf-mini"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onViewPreview(p)
                                }}
                              >
                                <Eye size={11} /> 看成品
                              </button>
                            )}
                          </>
                        ) : active && port ? (
                          <a
                            className="wf-port"
                            title="在浏览器打开"
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpenBrowser(p)
                            }}
                          >
                            localhost:{port}
                            <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="wf-port wf-port-off">
                            {port ? `localhost:${port}` : '未设置端口'}
                          </span>
                        )}

                        <span className="wf-spacer" />
                      </div>

                      {/* 局域网区：运行中才显示；不通时给「由本应用托管」的开门按钮 */}
                      {active && port && (mounted || (!lanBlocked && cardLan)) && (
                        <div className="wf-lan-row">
                          <a
                            className={`wf-lan ${lanCopiedId === p.id ? 'is-copied' : ''}`}
                            data-tour={p.id === 'demo-app' ? 'lan-link' : undefined}
                            title={
                              mounted
                                ? '访客地址（点击复制，同一 Wi-Fi 的设备用这个）'
                                : '局域网地址（点击复制，同一 Wi-Fi 的设备用这个）'
                            }
                            onClick={(e) => {
                              e.stopPropagation()
                              void navigator.clipboard.writeText(guestUrl)
                              setLanCopiedId(p.id)
                              setTimeout(() => setLanCopiedId(null), 1500)
                            }}
                          >
                            {mounted
                              ? `${ev?.lanIp ?? lanIp}:${ev?.gatewayPort}/rp/${p.lanSlug}/`
                              : `${cardLan}:${port}`}
                            {lanCopiedId === p.id && <i>已复制</i>}
                          </a>
                        </div>
                      )}
                      {lanBlocked && !mounted && active && port && (
                        <div className="wf-lan-row">
                          <span
                            className="wf-lan-blocked"
                            title={
                              ev.spawned === true
                                ? '这个服务是本应用拉起的，在项目的启动命令里加 --host 0.0.0.0 才能局域网访问'
                                : '这个服务只绑了本机，同一 Wi-Fi 的其他设备访问不了'
                            }
                          >
                            仅本机可访问
                            <button
                              className="wf-copy-fail"
                              title="局域网不通，点「由本应用托管」开门后就能复制给别的设备用"
                              onClick={(e) => {
                                e.stopPropagation()
                                setLanFailId(p.id)
                                setLanFlashId(p.id)
                                setTimeout(() => setLanFailId(null), 1500)
                                setTimeout(() => setLanFlashId(null), 900)
                              }}
                            >
                              {lanFailId === p.id ? '复制失败' : '复制'}
                            </button>
                            {ev.spawned !== true && (
                              <button
                                className={`wf-rehost ${lanFlashId === p.id ? 'is-flash' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onRehost?.(p)
                                }}
                              >
                                由本应用托管
                              </button>
                            )}
                          </span>
                        </div>
                      )}

                      {p.tags.length > 0 && (
                        <div className="wf-tags" title={p.tags.join('、')}>
                          {p.tags.slice(0, 2).map((t) => {
                            const color = tagColor(t)
                            return (
                              <span
                                key={t}
                                className="wf-tag"
                                style={color ? { color, borderColor: color } : undefined}
                              >
                                <Tag size={9} fill={color ?? 'none'} />
                                {t}
                              </span>
                            )
                          })}
                          {p.tags.length > 2 && (
                            <span className="wf-tag-more">+{p.tags.length - 2}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Fragment>
              )
  }

  return (
    <>
      {pinned.length > 0 && (
        <>
          <div className="sec-head">
            <span className="sec-icon">
              <Pin size={14} />
            </span>
            <span className="sec-title">置顶</span>
            <span className="sec-chip">{pinned.length}</span>
          </div>
          <div className="card-grid">
            {pinned.map(({ p }) => renderProject(p, null))}
          </div>
        </>
      )}

      {groups.length > 0 && (
        <>
          <div className="sec-head">
            <span className="sec-title">组</span>
            <span className="sec-chip">{groups.length}</span>
          </div>
          <div className="card-grid folder-grid">
            {groups.map(({ p }) => {
              const children = childrenOf(p.id)
              const online = children.filter((c) => statuses[c.id]?.status === 'running')
              const webOnline = online.find((c) => c.type === 'web')
              const webPort = webOnline ? statuses[webOnline.id]?.port : undefined
              const hue = FOLDER_HUES[hashHue(p.id) % FOLDER_HUES.length]
              return (
                <div
                  key={p.id}
                  className={`folder-card ${dragId === p.id ? 'dragging' : ''} ${
                    dropOnFolder === p.id ? 'drop-target' : ''
                  } ${selected(p) ? 'selected' : ''}`}
                  data-pid={p.id}
                  style={{ '--fh': hue } as React.CSSProperties}
                  onClick={(e) =>
                    e.metaKey || e.ctrlKey || e.shiftKey ? onSelectToggle(p, e) : onOpen(p)
                  }
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onContextMenu(e, p)
                  }}
                  onDragOver={(e) => onFolderDragOver(e, p)}
                  onDragLeave={(e) => onFolderDragLeave(e, p)}
                  onDragEnd={onDragEnd}
                  onDrop={(e) => onFolderDrop(e, p)}
                >
                  {/* 文件夹轮廓：整块 SVG 一体成形（不拼两块），色调跟着组色走 */}
                  <svg
                    className="folder-shape"
                    viewBox="0 0 220 140"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path d="M14 0 H112 Q128 0 134 16 H204 Q220 16 220 32 V122 Q220 138 204 138 H16 Q0 138 0 122 V14 Q0 0 14 0 Z" />
                  </svg>

                  <button
                    className="wf-kebab folder-kebab"
                    title="更多操作"
                    onClick={(e) => {
                      e.stopPropagation()
                      onContextMenu(e, p)
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>

                  {autoStartIds.includes(p.id) && (
                    <span className="folder-zap" title="在自启项里（开机只拉组内成品网站）">
                      <Zap size={11} />
                    </span>
                  )}

                  <div className="folder-name" title={p.name}>
                    {p.name}
                  </div>

                  {webOnline && webPort && (
                    <a
                      className="folder-port"
                      title="在浏览器打开（组内成品网站）"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenBrowser(webOnline)
                      }}
                    >
                      localhost:{webPort}
                      <ExternalLink size={10} />
                    </a>
                  )}

                  <div className="folder-foot">
                    <button
                      className="folder-run"
                      title={online.length > 0 ? '停止组内全部' : '启动组内全部'}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (online.length > 0) onFolderStop(p)
                        else onFolderStart(p)
                      }}
                    >
                      {online.length > 0 ? (
                        <MonitorPause size={11} />
                      ) : (
                        <MonitorPlay size={11} />
                      )}
                    </button>
                    <span className={`folder-online ${online.length > 0 ? 'is-on' : ''}`}>
                      {online.length > 0 ? `${online.length} 个在线` : '全部停止'}
                    </span>
                    <span className="folder-count">{children.length} 个子项</span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {projects.length > 0 && (
        <>
          <div className="sec-head">
            <span className="sec-title">项目</span>
            <span className="sec-chip">{projects.length}</span>
          </div>
          <div className="card-grid">
            {projects.map(({ p, header }) => renderProject(p, header))}
          </div>
        </>
      )}
    </>
  )
}
