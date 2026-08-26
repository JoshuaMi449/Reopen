// 角色选择弹窗：点设置里的预览图弹出。
// 列出全部可用角色（内置 + 用户导入），动图/图片都带预览和名字，点选切换；
// 底部「随 CPU 变速」「左右翻转」两个开关（图片角色不受影响）。
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import type { TrayCharacterItem } from '../../../shared/types'

export function RolePickerModal({
  currentPath,
  cpuFollow,
  autoReverse,
  onSelect,
  onCpuFollow,
  onAutoReverse,
  onClose
}: {
  currentPath: string
  cpuFollow: boolean
  autoReverse: boolean
  onSelect(c: TrayCharacterItem): void
  onCpuFollow(v: boolean): void
  onAutoReverse(v: boolean): void
  onClose(): void
}): React.JSX.Element {
  const [chars, setChars] = useState<TrayCharacterItem[]>([])
  useEffect(() => {
    void window.api.listTrayCharacters().then(setChars)
  }, [])

  return (
    <div className="role-picker-overlay" onClick={onClose}>
      <div className="role-picker" onClick={(e) => e.stopPropagation()}>
        <div className="role-picker-title">选择角色</div>
        <div className="role-picker-grid">
          {chars.map((c) => (
            <div
              key={c.key}
              className={`role-picker-item ${c.path === currentPath ? 'role-picker-on' : ''}`}
              onClick={() => onSelect(c)}
            >
              <div className="role-picker-preview">
                <img src={c.dataUrl} alt={c.label} />
                {c.path === currentPath && <Check className="role-picker-check" size={12} />}
              </div>
              <div className="role-picker-name">{c.label}</div>
            </div>
          ))}
        </div>
        <div className="role-picker-footer">
          <span className="role-picker-switch-label">随 CPU 变速</span>
          <button
            className={`settings-switch ${cpuFollow ? 'settings-switch-on' : ''}`}
            onClick={() => onCpuFollow(!cpuFollow)}
          >
            <span className="settings-switch-knob" />
          </button>
          <span className="role-picker-switch-label">左右翻转</span>
          <button
            className={`settings-switch ${autoReverse ? 'settings-switch-on' : ''}`}
            onClick={() => onAutoReverse(!autoReverse)}
          >
            <span className="settings-switch-knob" />
          </button>
        </div>
      </div>
    </div>
  )
}
