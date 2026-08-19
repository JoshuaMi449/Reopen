// 进程启动模块：拉起/停止项目进程、端口健康检查、日志推送（PRD 八·技术方案 进程管理+端口检测）
import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow, shell } from 'electron'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { connect } from 'net'
import type { Project, ProjectStatus, ProjectStatusEvent, StartResult } from '../shared/types'
import { listProjects, touchStartedAt } from './store'
import { startWebServer } from './webServer'

/** 健康检查：30 秒内端口就绪（验收标准 2），每 500ms 轮询一次 */
const HEALTH_TIMEOUT_MS = 30_000
const HEALTH_INTERVAL_MS = 500
/** 停止后宽限期：3 秒没退就强杀 */
const KILL_GRACE_MS = 3_000

interface Runtime {
  child?: ChildProcess
  server?: import('http').Server
  status: ProjectStatus
  port?: number
  healthTimer?: NodeJS.Timeout
  healthStart: number
}

const runtimes = new Map<string, Runtime>()
// 按行拆日志的缓冲（chunk 可能把一行劈开）
const lineBuffers = new Map<string, string>()

function getRuntime(id: string): Runtime {
  let rt = runtimes.get(id)
  if (!rt) {
    rt = { status: 'stopped', healthStart: 0 }
    runtimes.set(id, rt)
  }
  return rt
}

function emit(event: ProjectStatusEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('project:status', event)
  }
}

function emitLog(id: string, line: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('project:log', { id, line })
  }
}

function setStatus(rt: Runtime, project: Project, status: ProjectStatus, port?: number): void {
  rt.status = status
  if (port !== undefined) rt.port = port
  emit({
    id: project.id,
    status,
    port: rt.port,
    startedAt: status === 'running' ? Date.now() : undefined
  })
}

function fail(rt: Runtime, project: Project, reason: string): void {
  emit({ id: project.id, status: 'failed', port: rt.port, reason })
  rt.status = 'failed'
}

/** 日志按行拆完再推给界面 */
function pipeLog(id: string, chunk: string): void {
  const buf = (lineBuffers.get(id) ?? '') + chunk
  const lines = buf.split('\n')
  lineBuffers.set(id, lines.pop() ?? '')
  for (const line of lines) emitLog(id, line)
}

/** 端口是否已被占用（能连上 = 占用） */
function checkPortOpen(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const sock = connect({ port, host: '127.0.0.1' })
    sock.setTimeout(800)
    sock.once('connect', () => {
      sock.destroy()
      resolvePromise(true)
    })
    sock.once('timeout', () => {
      sock.destroy()
      resolvePromise(false)
    })
    sock.once('error', () => resolvePromise(false))
  })
}

// GUI 应用拿不到用户 shell 的 PATH（npm/node 常装在自定义位置），补上常见安装位置
function buildPath(): string {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.npm-global/bin')]
  return [...extra, process.env.PATH].filter(Boolean).join(':')
}

export async function startProject(id: string): Promise<StartResult> {
  const project = listProjects().find((p) => p.id === id)
  if (!project) return { ok: false, reason: '项目不存在' }
  const rt = getRuntime(id)
  if (rt.status === 'running' || rt.status === 'starting') {
    return { ok: false, reason: '已经在运行了' }
  }
  if (!existsSync(project.path)) {
    return { ok: false, reason: '项目路径不存在（可能被移动或删除了）' }
  }
  return project.type === 'web' ? startWeb(project, rt) : startService(project, rt)
}

async function startService(project: Project, rt: Runtime): Promise<StartResult> {
  if (!project.command) return { ok: false, reason: '该项目没有启动命令' }

  // 端口占用预检（PRD 3.4：如"端口3459已被占用"）
  if (project.port && (await checkPortOpen(project.port))) {
    return { ok: false, reason: `端口 ${project.port} 已被占用` }
  }

  setStatus(rt, project, 'starting')
  const child = spawn(project.command, {
    cwd: project.path,
    shell: true,
    detached: true, // 独立进程组：停止时整树终止
    env: { ...process.env, PATH: buildPath() }
  })
  rt.child = child
  rt.port = project.port

  child.stdout?.on('data', (d: Buffer) => pipeLog(project.id, d.toString()))
  child.stderr?.on('data', (d: Buffer) => pipeLog(project.id, d.toString()))

  child.on('error', (err) => {
    fail(rt, project, `启动进程失败：${err.message}`)
  })
  child.on('exit', (code, signal) => {
    if (rt.healthTimer) clearInterval(rt.healthTimer)
    rt.child = undefined
    if (rt.status === 'starting') {
      // 健康检查没过就退了 = 启动失败（不重试，PRD 3.4）
      fail(rt, project, `进程提前退出（退出码 ${code ?? signal}）`)
    } else if (rt.status === 'running') {
      setStatus(rt, project, 'stopped')
    }
  })

  if (project.port) {
    // 端口健康检查：轮询直到就绪或超时
    rt.healthStart = Date.now()
    rt.healthTimer = setInterval(() => {
      checkPortOpen(project.port!).then((open) => {
        if (rt.status !== 'starting') return
        if (open) {
          clearInterval(rt.healthTimer)
          setStatus(rt, project, 'running', project.port)
          touchStartedAt(project.id)
          if (project.openBrowser) {
            shell.openExternal(`http://localhost:${project.port}`)
          }
        } else if (Date.now() - rt.healthStart > HEALTH_TIMEOUT_MS) {
          clearInterval(rt.healthTimer)
          fail(rt, project, `30 秒内端口 ${project.port} 没有就绪（日志面板有完整输出）`)
        }
      })
    }, HEALTH_INTERVAL_MS)
  } else {
    // 没填端口：退化为进程存活即算运行
    setStatus(rt, project, 'running')
    touchStartedAt(project.id)
  }

  return { ok: true }
}

async function startWeb(project: Project, rt: Runtime): Promise<StartResult> {
  setStatus(rt, project, 'starting')
  try {
    const { server, port, entryPath } = await startWebServer(project.path)
    rt.server = server
    setStatus(rt, project, 'running', port)
    touchStartedAt(project.id)
    emitLog(project.id, `临时服务已就绪：http://localhost:${port}${entryPath}`)
    if (project.openBrowser) {
      shell.openExternal(`http://localhost:${port}${entryPath}`)
    }
    return { ok: true }
  } catch (err) {
    fail(rt, project, `临时服务启动失败：${err instanceof Error ? err.message : String(err)}`)
    return { ok: false }
  }
}

export async function stopProject(id: string): Promise<void> {
  const project = listProjects().find((p) => p.id === id)
  const rt = runtimes.get(id)
  if (!rt || !project) return

  if (rt.server) {
    // 网页文件：关掉临时服务
    rt.server.close()
    rt.server = undefined
    setStatus(rt, project, 'stopped')
    return
  }

  if (rt.child && rt.child.pid) {
    // 服务类：杀整个进程组（整树终止），3 秒没退就强杀
    try {
      process.kill(-rt.child.pid, 'SIGTERM')
    } catch {
      try {
        rt.child.kill('SIGTERM')
      } catch {
        // 进程已退出
      }
    }
    const pid = rt.child.pid
    setTimeout(() => {
      if (rt.status === 'running' || rt.status === 'starting') {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          // 进程已退出
        }
      }
    }, KILL_GRACE_MS)
    // exit 事件里会推送 stopped
  }
}
