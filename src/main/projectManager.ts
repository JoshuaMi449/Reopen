// 进程启动模块：拉起/停止项目进程、端口健康检查、日志推送（PRD 八·技术方案 进程管理+端口检测）
import { execSync, spawn, ChildProcess } from 'child_process'
import { BrowserWindow, Notification, shell } from 'electron'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { connect } from 'net'
import type { Project, ProjectStatus, ProjectStatusEvent, StartResult } from '../shared/types'
import { getSettings, listProjects, touchLastPort, touchStartedAt } from './store'
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
  /** 网页文件入口路径（单个文件登记时带文件名），右键"在浏览器打开"用 */
  entryPath?: string
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
  // 设置开着"启动失败通知"时发系统通知（PRD 3.6 通知方式）
  if (getSettings().notifyOnFail) {
    new Notification({
      title: 'Reopen',
      body: `「${project.name}」启动失败：${reason}`
    }).show()
  }
}

// 每个项目最近 200 行日志（失败时翻译成大白话用）
const recentLogs = new Map<string, string[]>()

/** 失败兜底：日志里有常见错误特征时，翻译成人话原因（PRD 3.4：通知带失败原因） */
function failWithLogHint(rt: Runtime, project: Project, fallback: string): void {
  const text = (recentLogs.get(project.id) ?? []).join('\n')
  const portBusy = text.match(/EADDRINUSE[\s\S]*?port:\s*(\d+)/)
  if (portBusy) {
    fail(
      rt,
      project,
      `端口 ${portBusy[1]} 已被占用——是不是这个项目之前已经手动启动了？先停掉旧的再启动`
    )
    return
  }
  if (/EADDRINUSE/.test(text)) {
    fail(rt, project, '端口已被占用——是不是这个项目之前已经手动启动了？先停掉旧的再启动')
    return
  }
  fail(rt, project, fallback)
}

/** 日志按行拆完再推给界面 */
function pipeLog(id: string, chunk: string): void {
  const buf = (lineBuffers.get(id) ?? '') + chunk
  const lines = buf.split('\n')
  lineBuffers.set(id, lines.pop() ?? '')
  const recent = recentLogs.get(id) ?? []
  recent.push(...lines)
  if (recent.length > 200) recent.splice(0, recent.length - 200)
  recentLogs.set(id, recent)
  for (const line of lines) emitLog(id, line)
}

/** S8：从最近日志里找框架打印的实际端口（vite/next 端口被占自动 +1 时日志会打新的 localhost 地址） */
function parseLogPort(id: string): number | undefined {
  for (const line of recentLogs.get(id) ?? []) {
    const m = line.match(/localhost:(\d{2,5})/)
    if (m) return Number(m[1])
  }
  return undefined
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
  if (project.type === 'group') {
    return { ok: false, reason: '组不能直接启动——展开组，启动里面的子项' }
  }
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

  // 端口已有服务在响应：大概率项目已经手动启动了——直接接管显示，不用先杀再开（用户 2026-08-20 拍板）
  if (project.port && (await checkPortOpen(project.port))) {
    rt.port = project.port
    setStatus(rt, project, 'running', project.port)
    touchStartedAt(project.id)
    touchLastPort(project.id, project.port)
    return { ok: true, reason: `检测到端口 ${project.port} 已有服务在响应，已直接显示为运行中` }
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
      failWithLogHint(rt, project, `进程提前退出（退出码 ${code ?? signal}）`)
    } else if (rt.status === 'running') {
      setStatus(rt, project, 'stopped')
    }
  })

  if (project.port) {
    // 端口健康检查：轮询直到就绪或超时
    rt.healthStart = Date.now()
    rt.healthTimer = setInterval(() => {
      const checkPort = rt.port ?? project.port!
      checkPortOpen(checkPort).then((open) => {
        if (rt.status !== 'starting') return
        if (open) {
          clearInterval(rt.healthTimer)
          setStatus(rt, project, 'running', checkPort)
          touchStartedAt(project.id)
          touchLastPort(project.id, checkPort)
          if (project.openBrowser) {
            shell.openExternal(`http://localhost:${checkPort}`)
          }
        } else {
          // S8：端口漂移（vite 端口被占自动 +1）——日志里出现实际端口就切换检查目标
          const drifted = parseLogPort(project.id)
          if (drifted && drifted !== rt.port) {
            rt.port = drifted
            setStatus(rt, project, 'starting', drifted)
          } else if (Date.now() - rt.healthStart > HEALTH_TIMEOUT_MS) {
            clearInterval(rt.healthTimer)
            failWithLogHint(rt, project, `30 秒内端口 ${checkPort} 没有就绪（日志面板有完整输出）`)
          }
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
  // 端口占用预检（用户可在表单指定端口，留空则自动分配）
  if (project.port && (await checkPortOpen(project.port))) {
    return { ok: false, reason: `端口 ${project.port} 已被占用` }
  }
  // 端口稳定（2026-08-21 网站常驻）：没指定端口时沿用上次实际端口（重启后地址不变）；被占则交给系统自动分配
  let wantPort = project.port
  if (!wantPort && project.lastPort && !(await checkPortOpen(project.lastPort))) {
    wantPort = project.lastPort
  }
  setStatus(rt, project, 'starting')
  try {
    const { server, port, entryPath } = await startWebServer(
      project.path,
      wantPort,
      project.entryPath
    )
    rt.server = server
    rt.entryPath = entryPath
    setStatus(rt, project, 'running', port)
    touchStartedAt(project.id)
    touchLastPort(project.id, port)
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

/** 接管显示：端口有服务在响应 → 标记运行中（不启动任何东西）。
 *  幂等重复 emit（2026-08-21 修复）：渲染层加载完成后调用一次兜底——若之前的 emit 因时序竞争丢失
 *  （StrictMode 双跑/订阅未就绪），rt 已 running 也重新推一次状态，界面才能从灰色恢复绿点 */
export async function adoptRunning(project: Project): Promise<void> {
  if (project.type === 'group') return // 组没有端口，跳过（2026-08-21 项目组）
  const rt = getRuntime(project.id)
  if (rt.status === 'starting') return // 自己正在启动中（健康检查在跑），不插手
  // 端口优先用登记值，其次上次实际运行端口（web 自动分配/端口写错时也能找回，2026-08-20）
  const port = project.port ?? project.lastPort
  if (!port) return
  if (await checkPortOpen(port)) {
    rt.port = port
    setStatus(rt, project, 'running', port)
  }
}

/** 打开应用时对全部项目做一次接管检测（重启 Reopen 后状态不丢） */
export async function adoptAllRunning(): Promise<void> {
  for (const project of listProjects()) {
    await adoptRunning(project)
  }
}

/** 打开 Reopen 时自动拉起自启项（PRD 3.5：软件层自动启动；失败静默，界面上标红可见）
 *  2026-08-21 拍板：组在自启里 = 只拉组内成品子项（web 类型），开发子项保留手动启动 */
export async function autoStartAll(): Promise<void> {
  const { autoStartEnabled, autoStartIds } = getSettings()
  if (!autoStartEnabled || autoStartIds.length === 0) return
  const projects = listProjects()
  for (const id of autoStartIds) {
    const project = projects.find((p) => p.id === id)
    if (!project) continue
    try {
      if (project.type === 'group') {
        for (const child of projects.filter((p) => p.parentId === id && p.type === 'web')) {
          await startProject(child.id)
        }
      } else {
        await startProject(id)
      }
    } catch {
      // 单个项目失败不影响其他
    }
  }
}

/** 右键"在浏览器打开"：项目运行中则弹默认浏览器（PRD 3.3 右键菜单） */
export async function openProjectBrowser(id: string): Promise<StartResult> {
  const project = listProjects().find((p) => p.id === id)
  if (!project) return { ok: false, reason: '项目不存在' }
  const rt = runtimes.get(id)
  if (!rt || rt.status !== 'running') {
    return { ok: false, reason: '项目还没启动，先点启动' }
  }
  if (project.type === 'web') {
    shell.openExternal(`http://localhost:${rt.port}${rt.entryPath ?? '/'}`)
  } else {
    const port = rt.port ?? project.port
    if (!port) return { ok: false, reason: '该项目没有端口，不知道打开哪个地址' }
    shell.openExternal(`http://localhost:${port}`)
  }
  return { ok: true }
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

  // 接管显示的项目（不是 Reopen 启动的）：杀掉监听端口的进程
  if (!rt.child && rt.port) {
    try {
      const out = execSync(`lsof -ti tcp:${rt.port} -sTCP:LISTEN`, { encoding: 'utf-8' })
      const pid = Number(out.trim().split('\n')[0])
      if (pid > 0) {
        process.kill(pid, 'SIGTERM')
        // 等端口真正释放（最多 6 秒）
        const start = Date.now()
        while (Date.now() - start < 6_000) {
          if (!(await checkPortOpen(rt.port))) break
          await new Promise((r) => setTimeout(r, 500))
        }
      }
    } catch {
      // 查不到占用者就算了
    }
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
