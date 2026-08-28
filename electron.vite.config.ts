import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // 专属端口：用户项目（vite 系）默认端口都是 5173，开发环境若也用 5173 会撞车——
    // 用户的 vite 项目抢到 5173 后，托盘面板/主窗口请求会串到用户项目页面（事故）
    server: {
      port: 5420
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          // 主窗口 + 托盘面板 + 偏好设置三个入口
          index: resolve('src/renderer/index.html'),
          tray: resolve('src/renderer/tray.html'),
          settings: resolve('src/renderer/settings.html')
        }
      }
    }
  }
})
