import { Monitor, Moon, Sun } from 'lucide-react'
import type { Settings } from '../../../shared/types'

interface Props {
  theme: Settings['theme']
  darkMode: Settings['darkMode']
  onChange(patch: Partial<Settings>): void
  onClose(): void
}

/** 外观快速面板（PRD 3.8 三风格 × 亮暗；后续并入偏好设置"外观"组） */
export function ThemeQuickPanel({ theme, darkMode, onChange, onClose }: Props): React.JSX.Element {
  const styles: { key: Settings['theme']; name: string; swatch: string }[] = [
    { key: 'morandi', name: '莫兰迪', swatch: '#c0a29a' },
    { key: 'ocean', name: '海洋', swatch: '#408abf' },
    { key: 'slate', name: '石墨', swatch: '#4a4a45' }
  ]

  return (
    <>
      <div className="autostart-backdrop" onClick={onClose} />
      <div className="theme-panel">
        <div className="theme-panel-title">外观</div>

        <div className="theme-styles">
          {styles.map((s) => (
            <button
              key={s.key}
              className={`theme-style ${theme === s.key ? 'theme-style-on' : ''}`}
              onClick={() => onChange({ theme: s.key })}
            >
              <span className="theme-swatch" style={{ background: s.swatch }} />
              {s.name}
            </button>
          ))}
        </div>

        <div className="theme-darkmodes">
          {(
            [
              { key: 'system', label: '跟随系统', icon: <Monitor size={14} /> },
              { key: 'light', label: '浅色', icon: <Sun size={14} /> },
              { key: 'dark', label: '深色', icon: <Moon size={14} /> }
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              className={`theme-dark ${darkMode === m.key ? 'theme-dark-on' : ''}`}
              onClick={() => onChange({ darkMode: m.key })}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
