import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          // 主窗口 + 托盘面板两个入口
          index: resolve('src/renderer/index.html'),
          tray: resolve('src/renderer/tray.html')
        }
      }
    }
  }
})
