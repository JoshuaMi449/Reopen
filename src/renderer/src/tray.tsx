import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TrayPanel } from './components/TrayPanel'

// 面板是系统菜单栏 UI 的一部分：深浅只跟系统外观走（暗色系统=白字），
// 不套用主窗口的 Reopen 主题设置（莫兰迪/海洋/自定义亮暗等是应用内风格）
const darkQuery = matchMedia('(prefers-color-scheme: dark)')
const syncSystemDark = (): void => {
  document.documentElement.classList.toggle('dark', darkQuery.matches)
}
syncSystemDark()
darkQuery.addEventListener('change', syncSystemDark)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TrayPanel />
  </StrictMode>
)
