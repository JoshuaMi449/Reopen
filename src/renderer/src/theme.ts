import type { Settings } from '../../shared/types'

/** 特殊风格 id → 亮暗（六套主题：前三浅后三深；CSS 用 data-mode 判定设置卡片样式） */
const DARK_SPECIAL = new Set(['special-oceandark', 'special-forestdark', 'special-slatedark'])

/** 应用主题到根元素：data-theme（风格）+ .dark class（亮暗）+ data-mode（亮暗标记，特殊风格时 .dark 不在但需要判暗）（PRD 3.8） */
export function applyTheme(
  theme: Settings['theme'],
  darkMode: Settings['darkMode'],
  systemDark: boolean,
  specialStyle: string = ''
): void {
  const root = document.documentElement
  if (darkMode === 'special' && specialStyle) {
    // 特殊风格自带完整配色（含亮暗），直接切换
    root.dataset.theme = specialStyle
    root.classList.remove('dark')
    root.dataset.mode = DARK_SPECIAL.has(specialStyle) ? 'dark' : 'light'
    return
  }
  root.dataset.theme = theme
  const isDark = darkMode === 'dark' || (darkMode === 'system' && systemDark)
  root.classList.toggle('dark', isDark)
  root.dataset.mode = isDark ? 'dark' : 'light'
}
