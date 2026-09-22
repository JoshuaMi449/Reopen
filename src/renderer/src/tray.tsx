import {
  MENUBAR_THEME_GROUPS,
  allowsTransparentColor,
  menubarColor,
  adaptedColor
} from '../../shared/menubarTheme'
import type { Settings } from '../../shared/types'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TrayPanel, TrayHistoryWindow } from './components/TrayPanel'

// 面板是系统菜单栏 UI 的一部分：深浅只跟系统外观走（暗色系统=白字），
// 不套用主窗口的 Reopen 主题设置（莫兰迪/海洋/自定义亮暗等是应用内风格）
const darkQuery = matchMedia('(prefers-color-scheme: dark)')
let currentSettings: Settings | undefined
let previewColors: Settings['menubarColors'] | null = null

const applyMenubarColors = (settings: Settings): void => {
  const dark = darkQuery.matches
  for (const group of MENUBAR_THEME_GROUPS)
    for (const color of group.colors)
      document.documentElement.style.setProperty(
        `--theme-${color.key}`,
        adaptedColor(
          menubarColor(previewColors ?? settings.menubarColors, color.key, color.value),
          dark,
          allowsTransparentColor(color.key) ? 0 : 0.7
        )
      )
}

const syncSystemDark = (): void => {
  document.documentElement.classList.toggle('dark', darkQuery.matches)
  document.documentElement.dataset.mode = darkQuery.matches ? 'dark' : 'light'
  if (currentSettings) applyMenubarColors(currentSettings)
}
syncSystemDark()
darkQuery.addEventListener('change', syncSystemDark)

function applyMenubarTheme(settings: Settings): void {
  currentSettings = settings
  syncSystemDark()
}
window.api.onSettingsChanged(applyMenubarTheme)
window.api.onMenubarColorsPreview((colors) => {
  previewColors = colors
  if (currentSettings) applyMenubarColors(currentSettings)
})
void window.api.getSettings().then(applyMenubarTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('history') ? <TrayHistoryWindow /> : <TrayPanel />}
  </StrictMode>
)
