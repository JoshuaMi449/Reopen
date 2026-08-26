// 角色选择弹窗：点设置里的预览图弹出，面板锚定在预览图正下方（放不下则向上翻）。
// 左侧动图/图片书签；右侧竖排角色列表——选中项 icon 放大 1.5 倍+主色描边、未选中缩小（照参考实现）；
// 选中的自定义素材显示铅笔可改名；最底部添加入口（虚线空框+选择GIF.../选择图片...）；
// 设置区：自动反转播放/速度正比CPU 开关 + 只因速无级滑杆（0~1 无数字）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Pencil } from 'lucide-react'
import type { TrayCharacterItem } from '../../../shared/types'

const PANEL_W = 300

export function RolePickerModal({
  currentPath,
  cpuFollow,
  autoReverse,
  speed,
  anchor,
  onSelect,
  onCpuFollow,
  onAutoReverse,
  onSpeed,
  onImport,
  onRename,
  onClose
}: {
  currentPath: string
  cpuFollow: boolean
  autoReverse: boolean
  speed: number
  anchor: { x: number; y: number; width: number } | null
  onSelect(c: TrayCharacterItem): void
  onCpuFollow(v: boolean): void
  onAutoReverse(v: boolean): void
  onSpeed(v: number): void
  onImport(filter: 'gif' | 'image'): Promise<void>
  onRename(newPath: string): void
  onClose(): void
}): React.JSX.Element {
  const [tab, setTab] = useState<'gif' | 'image'>('gif')
  const [chars, setChars] = useState<TrayCharacterItem[]>([])
  /** 当前选中角色（本地镜像：点选/改名即时反映，不用等设置回传） */
  const [current, setCurrent] = useState(currentPath)
  /** 正在改名的素材 path（名字变输入框） */
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [speedDraft, setSpeedDraft] = useState<number | null>(null)
  const speedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadChars = useCallback(() => {
    void window.api.listTrayCharacters().then(setChars)
  }, [])
  useEffect(loadChars, [loadChars])

  const visible = tab === 'gif' ? chars.filter((c) => c.isGif) : chars.filter((c) => !c.isGif)

  const handleImport = async (): Promise<void> => {
    await onImport(tab)
    loadChars()
  }

  const doRename = async (c: TrayCharacterItem, name: string): Promise<void> => {
    setEditingPath(null)
    try {
      const np = await window.api.renameTrayIcon(c.path, name)
      if (np) {
        setCurrent(np)
        onRename(np)
        loadChars()
      }
    } catch (err) {
      console.error(err)
    }
  }

  // 只因速：拖动实时显示，写盘 200ms 防抖（拖动中只落最后一次），松手立即提交
  const scheduleSpeed = (v: number): void => {
    if (speedTimer.current) clearTimeout(speedTimer.current)
    speedTimer.current = setTimeout(() => {
      speedTimer.current = null
      onSpeed(v)
    }, 200)
  }
  const flushSpeed = (): void => {
    if (speedTimer.current) {
      clearTimeout(speedTimer.current)
      speedTimer.current = null
      if (speedDraft !== null && speedDraft !== speed) onSpeed(speedDraft)
    }
    setSpeedDraft(null)
  }

  // 面板定位：锚在预览图正下方居中；下方放不下（<200px）则向上翻
  const panelStyle = (() => {
    if (!anchor) return undefined
    const left = Math.min(
      Math.max(anchor.x + anchor.width / 2 - PANEL_W / 2, 8),
      window.innerWidth - PANEL_W - 8
    )
    const spaceBelow = window.innerHeight - anchor.y - 16
    if (spaceBelow >= 200) {
      return { left, top: anchor.y + 8, maxHeight: Math.min(520, spaceBelow) }
    }
    const h = Math.min(520, Math.max(200, anchor.y - 24))
    return { left, top: anchor.y - h - 8, maxHeight: h }
  })()

  return (
    <div className="role-picker-overlay" onClick={onClose}>
      <div className="role-picker" style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div className="role-picker-body">
          <aside className="role-picker-tabs">
            <button
              className={`role-picker-tab ${tab === 'gif' ? 'role-picker-tab-on' : ''}`}
              onClick={() => setTab('gif')}
            >
              动图
            </button>
            <button
              className={`role-picker-tab ${tab === 'image' ? 'role-picker-tab-on' : ''}`}
              onClick={() => setTab('image')}
            >
              图片
            </button>
          </aside>
          <div className="role-picker-list">
            {visible.map((c) => {
              const selected = c.path === current
              return (
                <div
                  key={c.key}
                  className={`role-picker-item ${selected ? 'role-picker-on' : ''}`}
                  onClick={() => {
                    setCurrent(c.path)
                    onSelect(c)
                  }}
                >
                  <img className="role-picker-item-icon" src={c.dataUrl} alt={c.label} />
                  {editingPath === c.path ? (
                    <input
                      className="role-picker-rename-input"
                      defaultValue={c.label}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')
                          void doRename(c, (e.target as HTMLInputElement).value)
                        if (e.key === 'Escape') setEditingPath(null)
                      }}
                      onBlur={() => setEditingPath(null)}
                    />
                  ) : (
                    <span className="role-picker-item-name">{c.label}</span>
                  )}
                  {selected && !c.builtin && (
                    <button
                      className="role-picker-edit"
                      title="改名"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingPath(c.path)
                      }}
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                  {selected && <Check size={12} className="role-picker-check" />}
                </div>
              )
            })}
            {visible.length === 0 && (
              <div className="role-picker-empty">{tab === 'gif' ? '还没有动图' : '还没有图片'}</div>
            )}
          </div>
        </div>
        <div className="role-picker-settings">
          <div className="role-picker-setting-row">
            <span className="role-picker-setting-label">自动反转播放</span>
            <button
              className={`settings-switch ${autoReverse ? 'settings-switch-on' : ''}`}
              onClick={() => onAutoReverse(!autoReverse)}
            >
              <span className="settings-switch-knob" />
            </button>
          </div>
          <div className="role-picker-setting-row">
            <span className="role-picker-setting-label">速度正比CPU</span>
            <button
              className={`settings-switch ${cpuFollow ? 'settings-switch-on' : ''}`}
              onClick={() => onCpuFollow(!cpuFollow)}
            >
              <span className="settings-switch-knob" />
            </button>
          </div>
          <div className="role-picker-setting-row">
            <span className="role-picker-setting-label">只因速</span>
            <input
              type="range"
              className="settings-slider"
              min={0}
              max={1}
              step={0.01}
              value={speedDraft ?? speed}
              onChange={(e) => {
                const v = Number(e.target.value)
                setSpeedDraft(v)
                scheduleSpeed(v)
              }}
              onPointerUp={flushSpeed}
              onKeyUp={flushSpeed}
              onBlur={flushSpeed}
            />
          </div>
        </div>
        <button className="role-picker-add" onClick={() => void handleImport()}>
          <span className="role-picker-add-box" />
          <span className="role-picker-add-text">
            {tab === 'gif' ? '选择GIF...' : '选择图片...'}
          </span>
        </button>
      </div>
    </div>
  )
}
