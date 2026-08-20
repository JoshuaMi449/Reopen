import { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, Info, Keyboard, Monitor, Moon, Palette, Sun, Zap } from 'lucide-react'
import type { Project, Settings } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/types'
import { applyTheme } from '../theme'

type GroupKey = 'general' | 'appearance' | 'menubar' | 'shortcuts' | 'library' | 'about'

const GROUPS: { key: GroupKey; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: '通用', icon: <Zap size={15} /> },
  { key: 'appearance', label: '外观', icon: <Palette size={15} /> },
  { key: 'menubar', label: '菜单栏', icon: <Monitor size={15} /> },
  { key: 'shortcuts', label: '快捷键', icon: <Keyboard size={15} /> },
  { key: 'library', label: '资料库', icon: <Database size={15} /> },
  { key: 'about', label: '关于', icon: <Info size={15} /> }
]

/** 偏好设置：独立窗口（Proma 式，2026-08-20 用户拍板），左侧分组 + 右侧内容（PRD 3.6） */
export function SettingsPage(): React.JSX.Element {
  const [group, setGroup] = useState<GroupKey>('general')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [projects, setProjects] = useState<Project[]>([])
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
    applyTheme(settings.theme, settings.darkMode, systemDark, settings.rowDensity)
  }, [settings.theme, settings.darkMode, systemDark, settings.rowDensity])

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    window.api.listProjects().then(setProjects)
  }, [])

  const update = useCallback(async (patch: Partial<Settings>): Promise<void> => {
    const saved = await window.api.saveSettings(patch)
    setSettings(saved)
  }, [])

  // 通用组
  const general = (
    <div className="settings-group">
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

      <SettingRow label="关闭时最小化到托盘" hint="点红色关闭按钮时隐藏到右上角菜单栏，而不是退出">
        <Switch checked={settings.closeToTray} onChange={(v) => update({ closeToTray: v })} />
      </SettingRow>

      <SettingRow label="默认浏览器" hint="跟随系统默认浏览器（macOS 系统设置里改）">
        <span className="settings-static">系统默认</span>
      </SettingRow>

      <SettingRow label="语言" hint="中英切换随 M4 发布里程碑上线">
        <span className="settings-static">简体中文</span>
      </SettingRow>

      <SettingRow label="启动失败通知" hint="项目启动失败时发系统通知（右上角弹窗）">
        <Switch checked={settings.notifyOnFail} onChange={(v) => update({ notifyOnFail: v })} />
      </SettingRow>
    </div>
  )

  // 外观组
  const appearance = (
    <div className="settings-group">
      <div className="settings-subtitle">主题风格</div>
      <div className="settings-themes">
        {(
          [
            { key: 'morandi', name: '莫兰迪', swatch: '#c0a29a' },
            { key: 'ocean', name: '海洋', swatch: '#408abf' },
            { key: 'slate', name: '石墨', swatch: '#4a4a45' }
          ] as const
        ).map((s) => (
          <button
            key={s.key}
            className={`settings-theme-card ${settings.theme === s.key ? 'settings-theme-on' : ''}`}
            onClick={() => update({ theme: s.key })}
          >
            <span className="settings-swatch" style={{ background: s.swatch }} />
            {s.name}
          </button>
        ))}
      </div>

      <div className="settings-subtitle">亮暗</div>
      <div className="settings-darkmodes">
        {(
          [
            { key: 'system', label: '跟随系统', icon: <Monitor size={14} /> },
            { key: 'light', label: '浅色', icon: <Sun size={14} /> },
            { key: 'dark', label: '深色', icon: <Moon size={14} /> }
          ] as const
        ).map((m) => (
          <button
            key={m.key}
            className={`settings-dark-card ${settings.darkMode === m.key ? 'settings-dark-on' : ''}`}
            onClick={() => update({ darkMode: m.key })}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      <div className="settings-subtitle">列表密度</div>
      <SettingRow label="紧凑间距" hint="列表行和卡片更紧凑，一屏显示更多">
        <Switch
          checked={settings.rowDensity === 'compact'}
          onChange={(v) => update({ rowDensity: v ? 'compact' : 'comfortable' })}
        />
      </SettingRow>
    </div>
  )

  // 菜单栏组
  const menubar = (
    <div className="settings-group">
      <SettingRow label="显示菜单栏图标" hint="右上角顶栏的 Reopen 图标（点击弹快速启停面板）">
        <Switch checked={settings.trayEnabled} onChange={(v) => update({ trayEnabled: v })} />
      </SettingRow>

      <SettingRow label="图标样式" hint="黑白：自动适配深色顶栏；彩色：使用品牌色">
        <div className="settings-seg">
          <button
            className={`settings-seg-btn ${settings.trayIcon === 'mono' ? 'settings-seg-on' : ''}`}
            onClick={() => update({ trayIcon: 'mono' })}
          >
            黑白
          </button>
          <button
            className={`settings-seg-btn ${settings.trayIcon === 'color' ? 'settings-seg-on' : ''}`}
            onClick={() => update({ trayIcon: 'color' })}
          >
            彩色
          </button>
        </div>
      </SettingRow>
    </div>
  )

  // 快捷键组
  const shortcuts = (
    <div className="settings-group">
      <SettingRow
        label="全局唤起窗口"
        hint="在任何软件里按下，唤起/隐藏 Reopen 窗口（可改键随下一步实现）"
      >
        <span className="settings-kbd">{settings.hotkey}</span>
      </SettingRow>

      <SettingRow label="快捷启动项目" hint="给常用项目绑定组合键，一键启动（随下一步实现）">
        <span className="settings-static">暂未绑定</span>
      </SettingRow>

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
            <div key={p.id} className="settings-path-item" title={p.path}>
              <span>{p.name}</span>
              <code>{p.path}</code>
            </div>
          ))
        )}
      </div>

      <div className="settings-subtitle">数据备份</div>
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
  )

  // 关于组
  const about = (
    <div className="settings-group">
      <div className="settings-about-app">Reopen</div>
      <div className="settings-about-line">版本 0.1.0（VC复活点）</div>
      <div className="settings-about-line">Restart your Mac without losing your projects</div>
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
