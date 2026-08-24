// 网页文件临时服务：静态文件 http 服务，端口自动分配（PRD 3.1 网页文件类型）
import { createReadStream, existsSync, statSync } from 'fs'
import { createServer, Server } from 'http'
import { basename, dirname, extname, join, resolve, sep } from 'path'

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

/** 起临时 http 服务：path 是文件则 serve 所在目录并默认打开该文件；是文件夹则 serve 该目录。
 *  entryPath（S3）：识别时找到的入口文件相对路径（如 /supos-case-anjia.html），请求 / 时优先返回它 */
export function startWebServer(
  projectPath: string,
  port?: number,
  entryPath?: string
): Promise<WebServeResult> {
  const isFile = existsSync(projectPath) && statSync(projectPath).isFile()
  const rootDir = isFile ? dirname(projectPath) : projectPath
  // 入口优先级：识别出的 entryPath > 单个文件登记时用文件名 > 文件夹默认 index.html
  const entryName = entryPath?.replace(/^\//, '') ?? (isFile ? basename(projectPath) : 'index.html')

  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
    const target = urlPath === '/' ? entryName : urlPath
    let filePath = resolve(rootDir, `./${target}`)
    // 防目录穿越：解析后的路径必须在服务根目录内
    if (filePath !== rootDir && !filePath.startsWith(rootDir + sep)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    // 目录 → 自动补 index.html（站内子页面导航如 /factory/ 或 /integrator/，2026-08-21 实测）
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html')
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      // 404 时把实际找的路径打到主进程日志，排查"打开是空的"这类问题不用盲猜（2026-08-21 教训）
      console.error('[webServer] 404:', filePath)
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
    /** 监听：指定端口被占（EADDRINUSE）→ 自动让系统分配空闲端口重试一次（2026-08-24：
     *  用户拖入 html 报 50882 被占标红——纯网页登记是自动上线的，不该因端口冲突失败） */
    const tryListen = (portToTry: number | undefined, usedFallback: boolean): void => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && !usedFallback) {
          tryListen(0, true)
          return
        }
        reject(err)
      })
      // 端口 0 = 让系统分配一个空闲端口；指定了端口则用指定的
      server.listen(portToTry ?? 0, '127.0.0.1', () => {
        const addr = server.address()
        if (!addr || typeof addr === 'string') {
          reject(new Error('端口分配失败'))
          return
        }
        resolvePromise({
          server,
          port: addr.port,
          entryPath: entryPath ? encodeURI(entryPath) : `/${encodeURIComponent(entryName)}`
        })
      })
    }
    tryListen(port, false)
  })
}
