// 网页文件临时服务：静态文件 http 服务，端口自动分配（PRD 3.1 网页文件类型）
import { createReadStream, existsSync, statSync } from 'fs'
import { createServer, Server } from 'http'
import { basename, dirname, extname, resolve, sep } from 'path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json'
}

export interface WebServeResult {
  server: Server
  port: number
  /** 打开浏览器时用的入口路径（单个文件登记时带文件名） */
  entryPath: string
}

/** 起临时 http 服务：path 是文件则 serve 所在目录并默认打开该文件；是文件夹则 serve 该目录 */
export function startWebServer(projectPath: string, port?: number): Promise<WebServeResult> {
  const isFile = existsSync(projectPath) && statSync(projectPath).isFile()
  const rootDir = isFile ? dirname(projectPath) : projectPath
  const entryName = isFile ? basename(projectPath) : ''

  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
    const target =
      urlPath === '/' && entryName ? entryName : urlPath === '/' ? 'index.html' : urlPath
    const filePath = resolve(rootDir, `.${target}`)
    // 防目录穿越：解析后的路径必须在服务根目录内
    if (filePath !== rootDir && !filePath.startsWith(rootDir + sep)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    })
    createReadStream(filePath).pipe(res)
  })

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    // 端口 0 = 让系统分配一个空闲端口；指定了端口则用指定的
    server.listen(port ?? 0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('端口分配失败'))
        return
      }
      resolvePromise({
        server,
        port: addr.port,
        entryPath: entryName ? `/${encodeURIComponent(entryName)}` : '/'
      })
    })
  })
}
