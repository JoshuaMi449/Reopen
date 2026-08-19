import { ElectronAPI } from '@electron-toolkit/preload'
import type { ReopenApi } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: ReopenApi
  }
}
