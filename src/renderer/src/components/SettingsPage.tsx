import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Database, Info, Keyboard, Monitor, Palette, X, Zap } from 'lucide-react'
import type { EnvCheckItem, Project, Settings, UpdateInfo } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/types'
import { applyTheme } from '../theme'
import { UpdateModal } from './UpdateModal'

type GroupKey = 'general' | 'appearance' | 'menubar' | 'shortcuts' | 'library' | 'about'

// 特殊风格六套（与参考主题一致——名字与双圆预览色取自参考主题）
const SPECIAL_STYLES = [
  { id: 'special-clouddancer', name: '云朵舞者', pleft: '#e8e6e2', pright: '#f0efec' },
  { id: 'special-oceanlight', name: '晴空碧海', pleft: '#b8d4e5', pright: '#d4e5f0' },
  { id: 'special-forestlight', name: '森息晨光', pleft: '#e2e9e4', pright: '#3f8361' },
  { id: 'special-oceandark', name: '苍穹暮色', pleft: '#1a2535', pright: '#3a6a9b' },
  { id: 'special-forestdark', name: '森息夜语', pleft: '#1b2721', pright: '#185337' },
  { id: 'special-slatedark', name: '莫兰迪夜', pleft: '#272429', pright: '#c9a89e' }
]

const GROUPS: { key: GroupKey; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: '通用', icon: <Zap size={15} /> },
  { key: 'appearance', label: '外观', icon: <Palette size={15} /> },
  { key: 'menubar', label: '菜单栏', icon: <Monitor size={15} /> },
  { key: 'shortcuts', label: '快捷键', icon: <Keyboard size={15} /> },
  { key: 'library', label: '资料库', icon: <Database size={15} /> },
  { key: 'about', label: '关于', icon: <Info size={15} /> }
]

/** 偏好设置（主窗口内浮层界面，非独立窗口——浮层交互）：左侧分组 + 右侧内容（PRD 3.6） */
export function SettingsPage({ onClose }: { onClose?: () => void }): React.JSX.Element {
  const [group, setGroup] = useState<GroupKey>('general')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [projects, setProjects] = useState<Project[]>([])
  /** 环境监测结果（关于组下方） */
  const [envItems, setEnvItems] = useState<EnvCheckItem[]>([])
  /** 更新检查结果与弹窗（关于组「检查更新」，有新版弹窗） */
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [showUpdate, setShowUpdate] = useState(false)
  /** 正在一键安装的运行时 key（按钮转"取消"；再点=取消安装） */
  const [installingKey, setInstallingKey] = useState<string | null>(null)
  /** 安装实时日志行（最近 60 行：Cakebrew 式流水日志） */
  const [installLines, setInstallLines] = useState<string[]>([])
  const installingKeyRef = useRef<string | null>(null)
  const installLogRef = useRef<HTMLDivElement>(null)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    applyTheme(settings.theme, settings.darkMode, systemDark, settings.specialStyle)
  }, [settings.theme, settings.darkMode, systemDark, settings.specialStyle])

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    window.api.listProjects().then(setProjects)
    window.api.checkEnvironment().then(setEnvItems)
  }, [])

  const update = useCallback(async (patch: Partial<Settings>): Promise<void> => {
    const saved = await window.api.saveSettings(patch)
    setSettings(saved)
  }, [])

  /** 自定义菜单栏图标：选图 → 复制到应用数据目录 → 立即生效 */
  const pickTrayIcon = async (): Promise<void> => {
    try {
      const p = await window.api.pickTrayIcon()
      if (p) update({ trayIcon: 'custom', trayIconPath: p })
    } catch (err) {
      console.error(err)
    }
  }

  /** 当前自定义图标的预览（dataURL；GIF 在 <img> 里原生动画） */
  const [iconPreview, setIconPreview] = useState<{ dataUrl: string; isGif: boolean } | null>(null)
  useEffect(() => {
    if (settings.trayIcon === 'custom' && settings.trayIconPath) {
      let live = true
      void window.api.getTrayIconPreview().then((pv) => {
        if (live) setIconPreview(pv)
      })
      return () => {
        live = false
      }
    } else {
      requestAnimationFrame(() => setIconPreview(null))
      return undefined
    }
  }, [settings.trayIcon, settings.trayIconPath])

  /** 检查更新（GitHub Release；有新版弹窗，失败静默显示已是最新） */
  const checkUpdate = async (): Promise<void> => {
    const info = await window.api.checkUpdate()
    setUpdateInfo(info)
    if (info.hasUpdate) setShowUpdate(true)
  }

  /** 一键安装运行时（brew 自动装+实时日志；再点=取消） */
  const handleInstallEnv = (item: EnvCheckItem): void => {
    if (installingKeyRef.current === item.key) {
      // 再点 = 取消（主进程掐进程，结束事件会收尾）
      void window.api.cancelEnvInstall(item.key)
      return
    }
    setInstallingKey(item.key)
    installingKeyRef.current = item.key
    setInstallLines([])
    void window.api.installEnvTool(item.key)
  }

  // 订阅安装事件：实时日志追加 + 结束收尾（装完重新检测）
  useEffect(() => {
    return window.api.onEnvInstallEvent((e) => {
      if (e.key !== installingKeyRef.current) return
      if (e.line !== undefined) {
        setInstallLines((ls) => [...ls, e.line as string].slice(-60))
      } else if (e.ok !== undefined) {
        setInstallingKey(null)
        installingKeyRef.current = null
        setInstallLines((ls) =>
          [
            ...ls,
            e.ok ? '安装完成，已重新检测' : `${e.error ?? '安装没成功'}（也可以点「去官网」手动装）`
          ].slice(-60)
        )
        void window.api.checkEnvironment().then(setEnvItems)
      }
    })
  }, [])

  // 日志自动滚到底
  useEffect(() => {
    if (installLogRef.current) installLogRef.current.scrollTop = installLogRef.current.scrollHeight
  }, [installLines])

  // 通用组
  const general = (
    <div className="settings-group">
      <div className="settings-card">
        <SettingRow label="自启项总开关" hint="打开软件后，自动启动你放进来的产品">
          <Switch
            checked={settings.autoStartEnabled}
            onChange={(v) => update({ autoStartEnabled: v })}
          />
        </SettingRow>

        <SettingRow label="开机自启" hint="让 Reopen 随 Mac 开机自动打开（加入登录项）">
          <Switch
            checked={settings.launchAtLogin}
            onChange={(v) => {
              window.api.setLaunchAtLogin(v)
              update({ launchAtLogin: v })
            }}
          />
        </SettingRow>

        <SettingRow
          label="关闭时最小化到托盘"
          hint="点红色关闭按钮时隐藏到右上角菜单栏，而不是退出"
        >
          <Switch checked={settings.closeToTray} onChange={(v) => update({ closeToTray: v })} />
        </SettingRow>

        <SettingRow label="默认浏览器" hint="打开项目网页时用哪个浏览器（自动检索你电脑里的）">
          <BrowserSelect
            value={settings.defaultBrowser ?? ''}
            onChange={(v) => update({ defaultBrowser: v })}
          />
        </SettingRow>

        <SettingRow
          label="允许局域网访问"
          hint="打开后，同一 Wi-Fi 的设备（比如另一台电脑/手机）也能访问你跑的项目；公共网络（咖啡馆/机场）慎开。其他设备还打不开时，检查 Mac 防火墙是否拦截"
        >
          <Switch checked={settings.lanAccess} onChange={(v) => update({ lanAccess: v })} />
        </SettingRow>

        <SettingRow
          label="退出后项目继续运行"
          hint="勾选后，⌘Q 彻底退出 Reopen 时，正在运行的项目保持本地运行；不勾选则退出时一并停止。点红叉关窗口只是收到托盘，项目始终在跑，不受影响"
        >
          <Switch
            checked={settings.keepProjectsOnQuit}
            onChange={(v) => update({ keepProjectsOnQuit: v })}
          />
        </SettingRow>

        <SettingRow
          label="种类排序顺序"
          hint="工具栏排序选「种类」时，项目按这个先后分组：文件夹（项目组）→ 服务 → 网页，拖动调整"
        >
          <TypeOrderList
            order={settings.typeOrder}
            onChange={(o) => void update({ typeOrder: o })}
          />
        </SettingRow>

        <SettingRow label="语言" hint="中英切换随 M4 发布里程碑上线">
          <span className="settings-static">简体中文</span>
        </SettingRow>

        <SettingRow label="启动失败通知" hint="项目启动失败时发系统通知（右上角弹窗）">
          <Switch checked={settings.notifyOnFail} onChange={(v) => update({ notifyOnFail: v })} />
        </SettingRow>
      </div>
    </div>
  )

  // 外观组（与参考主题一致——主题模式四段+特殊风格六套，都包在圆角卡里）
  const appearance = (
    <div className="settings-group">
      <div className="settings-card">
        <div className="settings-card-block">
          <div className="settings-subtitle">主题模式</div>
          <div className="segmented">
            {(
              [
                { key: 'light', label: '浅色' },
                { key: 'dark', label: '深色' },
                { key: 'system', label: '跟随系统' },
                { key: 'special', label: '特殊风格' }
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                className={settings.darkMode === m.key ? 'seg-on' : ''}
                onClick={() =>
                  update({
                    darkMode: m.key,
                    specialStyle: m.key === 'special' ? settings.specialStyle : ''
                  })
                }
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-card-block">
          <div className="settings-subtitle">特殊风格</div>
          <div className="special-grid">
            {SPECIAL_STYLES.map((st) => {
              const isSelected = settings.darkMode === 'special' && settings.specialStyle === st.id
              return (
                <button
                  key={st.id}
                  className={`special-card ${isSelected ? 'special-on' : ''}`}
                  onClick={() => update({ darkMode: 'special', specialStyle: st.id })}
                >
                  <div
                    className="special-preview"
                    style={{ '--pleft': st.pleft, '--pright': st.pright } as React.CSSProperties}
                  />
                  {isSelected && (
                    <span className="special-check">
                      <Check size={10} />
                    </span>
                  )}
                  <span>{st.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )

  // 菜单栏组
  const menubar = (
    <div className="settings-group">
      <div className="settings-card">
        <SettingRow label="显示菜单栏图标" hint="右上角顶栏的 Reopen 图标（点击弹快速启停面板）">
          <Switch checked={settings.trayEnabled} onChange={(v) => update({ trayEnabled: v })} />
        </SettingRow>

        <SettingRow
          label="图标样式"
          hint="黑白：随系统深浅色自动反转；自定义：用你自己的图片（PNG/JPG/GIF，最大 2MB，自动缩放；GIF 会以动图轮播显示）"
        >
          <div className="settings-tray-icon-ctrl">
            <div className="settings-seg">
              <button
                className={`settings-seg-btn ${settings.trayIcon === 'mono' ? 'settings-seg-on' : ''}`}
                onClick={() => update({ trayIcon: 'mono' })}
              >
                黑白
              </button>
              <button
                className={`settings-seg-btn ${settings.trayIcon === 'custom' ? 'settings-seg-on' : ''}`}
                onClick={() => update({ trayIcon: 'custom' })}
              >
                自定义
              </button>
            </div>
            {settings.trayIcon === 'custom' && (
              <div className="tray-icon-actions">
                {iconPreview && (
                  <img className="tray-icon-preview" src={iconPreview.dataUrl} alt="当前图标预览" />
                )}
                <button className="btn-secondary" onClick={() => void pickTrayIcon()}>
                  {settings.trayIconPath ? '换一张图片…' : '选择图片…'}
                </button>
              </div>
            )}
          </div>
        </SettingRow>

        <SettingRow label="播放速度" hint="动图轮播的快慢（仅自定义 GIF 图标生效）">
          <div className="settings-seg">
            {[0.5, 1, 1.5, 2].map((v) => (
              <button
                key={v}
                className={`settings-seg-btn ${settings.trayIconSpeed === v ? 'settings-seg-on' : ''}`}
                onClick={() => update({ trayIconSpeed: v })}
              >
                {v}×
              </button>
            ))}
          </div>
        </SettingRow>

        <SettingRow label="图标大小" hint="右上角菜单栏图标的大小（黑白和自定义统一生效）">
          <div className="settings-seg">
            {[14, 16, 18, 20, 22].map((v) => (
              <button
                key={v}
                className={`settings-seg-btn ${settings.trayIconSize === v ? 'settings-seg-on' : ''}`}
                onClick={() => update({ trayIconSize: v })}
              >
                {v}
              </button>
            ))}
          </div>
        </SettingRow>
      </div>
    </div>
  )

  // 快捷键组
  const [capturing, setCapturing] = useState<'hotkey' | string | null>(null)

  const shortcuts = (
    <div className="settings-group">
      <div className="settings-card">
        <SettingRow
          label="全局唤起窗口"
          hint="在任何软件里按下，唤起/隐藏 Reopen 窗口（至少带一个修饰键）"
        >
          {capturing === 'hotkey' ? (
            <KeyCapture
              defaultValue={settings.hotkey}
              onDone={(acc) => {
                update({ hotkey: acc })
                setCapturing(null)
              }}
              onCancel={() => setCapturing(null)}
            />
          ) : (
            <button
              className="settings-kbd settings-kbd-btn"
              onClick={() => setCapturing('hotkey')}
            >
              {displayAcc(settings.hotkey)}
            </button>
          )}
        </SettingRow>
      </div>

      <div className="settings-subtitle">快捷启动项目（一键启动）</div>
      {projects.length === 0 ? (
        <div className="settings-static">还没有登记项目</div>
      ) : (
        <div className="settings-card">
          {projects.map((p) => (
            <div key={p.id} className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">{p.name}</div>
              </div>
              <div className="settings-row-control">
                {capturing === p.id ? (
                  <KeyCapture
                    defaultValue={settings.quickLaunch[p.id]}
                    onDone={(acc) => {
                      update({ quickLaunch: { ...settings.quickLaunch, [p.id]: acc } })
                      setCapturing(null)
                    }}
                    onCancel={() => setCapturing(null)}
                  />
                ) : settings.quickLaunch[p.id] ? (
                  <span className="settings-bound">
                    <span className="settings-kbd">{displayAcc(settings.quickLaunch[p.id])}</span>
                    <button
                      className="icon-btn"
                      title="解绑"
                      onClick={() => {
                        const ql = { ...settings.quickLaunch }
                        delete ql[p.id]
                        update({ quickLaunch: ql })
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <button className="btn-secondary" onClick={() => setCapturing(p.id)}>
                    绑定…
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="settings-subtitle">应用内快捷键</div>
      <div className="settings-shortcut-list">
        <div>
          <span className="settings-kbd">⌘N</span> 添加项目
        </div>
        <div>
          <span className="settings-kbd">⌘F</span> 搜索
        </div>
        <div>
          <span className="settings-kbd">⌘,</span> 偏好设置
        </div>
        <div>
          <span className="settings-kbd">⌘W</span> 关闭窗口（最小化到托盘）
        </div>
        <div>
          <span className="settings-kbd">⌘Q</span> 退出 Reopen
        </div>
      </div>
    </div>
  )

  // 资料库组
  const library = (
    <div className="settings-group">
      <div className="settings-subtitle">项目源文件路径</div>
      <div className="settings-path-list">
        {projects.length === 0 ? (
          <div className="settings-static">还没有登记项目</div>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              className="settings-path-item"
              title={`${p.path}（点击在访达中显示）`}
              onClick={() => window.api.revealInFolder(p.path)}
            >
              <span>{p.name}</span>
              <code>{p.path}</code>
            </div>
          ))
        )}
      </div>

      <div className="settings-subtitle">数据备份</div>
      <div className="settings-card">
        <SettingRow label="导出资料库" hint="把项目清单和设置导出成 JSON 文件">
          <button className="btn-secondary" onClick={() => window.api.exportData()}>
            导出…
          </button>
        </SettingRow>
        <SettingRow label="导入资料库" hint="从 JSON 文件恢复项目清单和设置（与现有项目合并）">
          <button className="btn-secondary" onClick={() => window.api.importData()}>
            导入…
          </button>
        </SettingRow>
      </div>
    </div>
  )

  // 关于组
  const about = (
    <div className="settings-group">
      <div className="settings-about-app">Reopen</div>
      <div className="settings-about-line">版本 0.1.0（VC复活点）</div>
      <div className="settings-about-line">Restart your Mac without losing your projects</div>
      <div className="settings-about-line">
        <a
          href="#"
          className="update-check-link"
          onClick={(e) => {
            e.preventDefault()
            // 已查到新版 → 直接弹详情弹窗；否则重新检查
            if (updateInfo?.hasUpdate) setShowUpdate(true)
            else void checkUpdate()
          }}
        >
          {updateInfo
            ? updateInfo.hasUpdate
              ? `新版本 v${updateInfo.latestVersion} 可用`
              : '已是最新版本'
            : '检查更新'}
        </a>
      </div>
      <div className="settings-subtitle">链接</div>
      <div className="settings-about-links">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            window.api.openExternal('https://github.com/JoshuaMi449/Reopen')
          }}
        >
          GitHub 仓库
        </a>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            window.api.openExternal('https://github.com/JoshuaMi449/Reopen/issues')
          }}
        >
          报告问题
        </a>
      </div>
      <div className="settings-subtitle">开源协议</div>
      <div className="settings-about-line">MIT License</div>

      {/* 环境监测（项目要什么运行时一目了然，没装给安装官网，与参考主题一致） */}
      <div className="settings-subtitle">环境监测</div>
      <div className="settings-card">
        {envItems.length === 0 ? (
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-label">检测中…</div>
            </div>
          </div>
        ) : (
          envItems.map((item) => (
            <div key={item.key} className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">
                  <span className={`env-dot ${item.ok ? 'env-dot-ok' : 'env-dot-miss'}`}>
                    {item.ok ? '✓' : '!'}
                  </span>
                  {item.name}
                </div>
                <div className="settings-row-hint">
                  {item.ok
                    ? item.version
                    : `${item.hint ?? '未安装'} —— ${item.link ? '点右侧按钮一键安装或去官网' : ''}`}
                </div>
              </div>
              <div className="settings-row-control">
                {item.ok ? (
                  <span className="settings-static">已安装</span>
                ) : (
                  <>
                    {item.installCommand && (
                      <button className="btn-secondary" onClick={() => handleInstallEnv(item)}>
                        {installingKey === item.key ? '取消安装' : '一键安装'}
                      </button>
                    )}
                    {item.link && (
                      <button
                        className="btn-secondary"
                        onClick={() => window.api.openExternal(item.link as string)}
                      >
                        去官网
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
        {/* 安装实时日志（Cakebrew 式流水，看得到进度、再点取消） */}
        {installingKey && (
          <div className="env-log" ref={installLogRef}>
            {installLines.map((line, i) => (
              <div key={i} className="env-log-line">
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  const groups: Record<GroupKey, React.ReactNode> = {
    general,
    appearance,
    menubar,
    shortcuts,
    library,
    about
  }

  const titles = useMemo(
    () => ({
      general: '通用',
      appearance: '外观',
      menubar: '菜单栏',
      shortcuts: '快捷键',
      library: '资料库',
      about: '关于'
    }),
    []
  )

  return (
    <div className="settings-window">
      {/* 标题栏（与参考主题一致——无红黄绿按钮，只留右上角一个叉，整条可拖拽） */}
      <div className="settings-titlebar">
        <span className="settings-titlebar-title">偏好设置</span>
        <button
          className="settings-close-btn"
          title="关闭"
          onClick={() => (onClose ? onClose() : window.api.closeSettingsWindow())}
        >
          <X size={14} />
        </button>
      </div>
      <div className="settings-body">
        <aside className="settings-sidebar">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              className={`settings-side-item ${group === g.key ? 'settings-side-active' : ''}`}
              onClick={() => setGroup(g.key)}
            >
              {g.icon}
              {g.label}
            </button>
          ))}
        </aside>
        <main className="settings-content">
          <h2 className="settings-title">{titles[group]}</h2>
          {groups[group]}
        </main>
      </div>
      {showUpdate && updateInfo && (
        <UpdateModal info={updateInfo} onClose={() => setShowUpdate(false)} />
      )}
    </div>
  )
}

/** 默认浏览器下拉（自动检索电脑里的浏览器） */
function BrowserSelect({
  value,
  onChange
}: {
  value: string
  onChange(v: string): void
}): React.JSX.Element {
  const [browsers, setBrowsers] = useState<string[]>([])

  useEffect(() => {
    window.api.listBrowsers().then(setBrowsers)
  }, [])

  return (
    <select className="settings-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">系统默认</option>
      {browsers.map((b) => (
        <option key={b} value={b}>
          {b}
        </option>
      ))}
    </select>
  )
}

/** 侧栏拖拽排序共用的 MIME（同窗口内不会与文件拖入冲突） */
const SORT_MIME = 'application/x-reopen-sort'

/** 种类排序的顺序列表（文件夹=项目组/服务/网页），拖动调整先后 */
function TypeOrderList({
  order,
  onChange
}: {
  order: string[]
  onChange(order: string[]): void
}): React.JSX.Element {
  const TYPE_ITEMS: { value: string; label: string }[] = [
    { value: 'group', label: '文件夹（项目组）' },
    { value: 'service', label: '服务' },
    { value: 'web', label: '网页' }
  ]
  const [dropOn, setDropOn] = useState<string | null>(null)

  const items = [...TYPE_ITEMS].sort((a, b) => {
    const ia = order.indexOf(a.value)
    const ib = order.indexOf(b.value)
    if (ia === -1 && ib === -1) return 0
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })

  const move = (from: string, to: string): void => {
    if (from === to) return
    const cur = items.map((x) => x.value)
    const fi = cur.indexOf(from)
    if (fi === -1) return
    cur.splice(fi, 1)
    cur.splice(cur.indexOf(to), 0, from)
    onChange(cur)
  }

  return (
    <div className="type-order-list">
      {items.map((it) => (
        <div
          key={it.value}
          draggable
          className={`type-order-item ${dropOn === it.value ? 'type-order-item-droptarget' : ''}`}
          onDragStart={(e) => {
            e.dataTransfer.setData(SORT_MIME, it.value)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(SORT_MIME)) return
            e.preventDefault()
            if (dropOn !== it.value) setDropOn(it.value)
          }}
          onDragLeave={() => setDropOn(null)}
          onDrop={(e) => {
            e.preventDefault()
            const from = e.dataTransfer.getData(SORT_MIME)
            setDropOn(null)
            // 只认三种类型的值（从侧栏拖来的载荷是 JSON，不属于本列表，忽略）
            if (from && TYPE_ITEMS.some((x) => x.value === from)) move(from, it.value)
          }}
        >
          {it.label}
        </div>
      ))}
    </div>
  )
}

function SettingRow({
  label,
  hint,
  children
}: {
  label: string
  hint: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-hint">{hint}</div>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function Switch({
  checked,
  onChange
}: {
  checked: boolean
  onChange(v: boolean): void
}): React.JSX.Element {
  return (
    <button
      className={`settings-switch ${checked ? 'settings-switch-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-switch-knob" />
    </button>
  )
}

/** Electron accelerator → 界面显示（⌥R / ⌘⇧1 这种） */
function displayAcc(acc: string): string {
  return acc
    .replace(/CommandOrControl|Command/g, '⌘')
    .replace(/Control/g, '⌃')
    .replace(/Alt|Option/g, '⌥')
    .replace(/Shift/g, '⇧')
}

/** 按键录制框：按下组合键（至少一个修饰键），回车确认 / Esc 取消 */
function KeyCapture({
  defaultValue,
  onDone,
  onCancel
}: {
  defaultValue?: string
  onDone(acc: string): void
  onCancel(): void
}): React.JSX.Element {
  const [acc, setAcc] = useState(defaultValue ?? '')

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        onCancel()
        return
      }
      if (e.key === 'Enter' && acc) {
        onDone(acc)
        return
      }
      const mods: string[] = []
      if (e.metaKey) mods.push('Command')
      if (e.altKey) mods.push('Alt')
      if (e.ctrlKey) mods.push('Control')
      if (e.shiftKey) mods.push('Shift')
      const key = e.key.toUpperCase()
      if (mods.length === 0 || ['META', 'ALT', 'CONTROL', 'SHIFT'].includes(key)) return
      setAcc([...mods, key].join('+'))
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [acc, onDone, onCancel])

  return (
    <span className={`settings-kbd settings-kbd-capture ${acc ? 'settings-kbd-ready' : ''}`}>
      {acc ? displayAcc(acc) : '按下组合键…'}
    </span>
  )
}
