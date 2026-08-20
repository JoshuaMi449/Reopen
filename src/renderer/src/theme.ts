import type { Settings } from '../../shared/types'

/** 应用主题到根元素：data-theme（风格）+ .dark class（亮暗）（PRD 3.8 六套主题） */
export function applyTheme(
  theme: Settings['theme'],
  darkMode: Settings['darkMode'],
  systemDark: boolean
): void {
  const root = document.documentElement
  root.dataset.theme = theme
  const isDark = darkMode === 'dark' || (darkMode === 'system' && systemDark)
  root.classList.toggle('dark', isDark)
}
