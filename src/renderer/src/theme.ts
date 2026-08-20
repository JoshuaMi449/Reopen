import type { Settings } from '../../shared/types'

/** 应用主题到根元素：data-theme（风格）+ .dark class（亮暗）+ data-density（列表密度）（PRD 3.8） */
export function applyTheme(
  theme: Settings['theme'],
  darkMode: Settings['darkMode'],
  systemDark: boolean,
  density: Settings['rowDensity'] = 'comfortable',
  specialStyle: string = ''
): void {
  const root = document.documentElement
  root.dataset.density = density
  if (darkMode === 'special' && specialStyle) {
    // 特殊风格自带完整配色（含亮暗），直接切换
    root.dataset.theme = specialStyle
    root.classList.remove('dark')
    return
  }
  root.dataset.theme = theme
  const isDark = darkMode === 'dark' || (darkMode === 'system' && systemDark)
  root.classList.toggle('dark', isDark)
}
