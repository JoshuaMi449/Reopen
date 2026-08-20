import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsPage } from './components/SettingsPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsPage />
  </StrictMode>
)
