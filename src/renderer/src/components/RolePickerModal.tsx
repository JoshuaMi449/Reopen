// 角色选择弹窗：点设置里的预览图弹出（竖窄窗，宽 300）。
// 左侧两个书签：动图（GIF 角色）/ 图片（静态图片素材）；右侧竖排角色列表（icon+名字+当前打勾）；
// 列表底部「＋1只」从文件添加；最底部设置区：自动反转播放 / 速度正比CPU 开关 + 只因速无级滑杆（无数字）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { TrayCharacterItem } from '../../../shared/types'

export function RolePickerModal({
  currentPath,
  cpuFollow,
  autoReverse,
  speed,
  onSelect,
  onCpuFollow,
  onAutoReverse,
  onSpeed,
  onImport,
  onClose
}: {
  currentPath: string
  cpuFollow: boolean
  autoReverse: boolean
  speed: number
  onSelect(c: TrayCharacterItem): void
  onCpuFollow(v: boolean): void
  onAutoReverse(v: boolean): void
  onSpeed(v: number): void
  onImport(): Promise<void>
  onClose(): void
}): React.JSX.Element {
  const [tab, setTab] = useState<'gif' | 'image'>('gif')
  const [chars, setChars] = useState<TrayCharacterItem[]>([])
  const [speedDraft, setSpeedDraft] = useState<number | null>(null)
  const speedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadChars = useCallback(() => {
    void window.api.listTrayCharacters().then(setChars)
  }, [])
  useEffect(loadChars, [loadChars])

  const visible = tab === 'gif' ? chars.filter((c) => c.isGif) : chars.filter((c) => !c.isGif)

  const handleImport = async (): Promise<void> => {
    await onImport()
    loadChars()
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

  return (
    <div className="role-picker-overlay" onClick={onClose}>
      <div className="role-picker" onClick={(e) => e.stopPropagation()}>
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
            {visible.map((c) => (
              <div
                key={c.key}
                className={`role-picker-item ${c.path === currentPath ? 'role-picker-on' : ''}`}
                onClick={() => onSelect(c)}
              >
                <img className="role-picker-item-icon" src={c.dataUrl} alt={c.label} />
                <span className="role-picker-item-name">{c.label}</span>
                {c.path === currentPath && <Check size={12} className="role-picker-check" />}
              </div>
            ))}
            {visible.length === 0 && (
              <div className="role-picker-empty">{tab === 'gif' ? '还没有动图' : '还没有图片'}</div>
            )}
          </div>
        </div>
        <button className="role-picker-add" onClick={() => void handleImport()}>
          ＋1只
        </button>
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
              min={0.25}
              max={3}
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
      </div>
    </div>
  )
}
