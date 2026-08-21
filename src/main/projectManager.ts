// 进程启动模块：拉起/停止项目进程、端口健康检查、日志推送（PRD 八·技术方案 进程管理+端口检测）
import { execSync, spawn, ChildProcess } from 'child_process'
import { BrowserWindow, Notification, shell } from 'electron'
import { existsSync } from 'fs'
import { get } from 'http'
import { homedir } from 'os'
import { join } from 'path'
import { connect } from 'net'
import type {
  LaunchMode,
  Project,
  ProjectStatus,
  ProjectStatusEvent,
  StartResult
} from '../shared/types'
import { launchKindToType } from '../shared/types'
import { getSettings, listProjects, touchLastPort, touchStartedAt, updateProject } from './store'
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
  // 跨平台拷贝的依赖（2026-08-21 实测：Windows 项目整个拷到 Mac，node_modules 里是 Windows 二进制）
  if (
    /Permission denied/.test(text) ||
    /bad cpu type|exec format error|wrong architecture|not compatible/i.test(text)
  ) {
    fail(
      rt,
      project,
      '这个项目的依赖可能是从 Windows 电脑拷贝过来的，Mac 上跑不了——删掉项目里的 node_modules 重新 npm install 就行'
    )
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

/** 探测端口上是不是一个正在响应的网站（2xx/3xx 且是 HTML）。
 *  接管用（2026-08-21）：用户手动在 7100 跑的成品站，Reopen 不再另起炉灶，直接认领显示 */
function probeWebPort(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const req = get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
      res.resume()
      const code = res.statusCode ?? 0
      const contentType = String(res.headers['content-type'] ?? '')
      resolvePromise(
        code >= 200 && code < 400 && (contentType.includes('text/html') || contentType === '')
      )
    })
    req.once('timeout', () => {
      req.destroy()
      resolvePromise(false)
    })
    req.once('error', () => resolvePromise(false))
  })
}

// GUI 应用拿不到用户 shell 的 PATH（npm/node 常装在自定义位置），补上常见安装位置
function buildPath(): string {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.npm-global/bin')]
  return [...extra, process.env.PATH].filter(Boolean).join(':')
}

/** 项目的启动方式：指定 id > activeMode > 第一个；老数据无 launchModes 按 type 生成单方式（Phase B 兼容，2026-08-21） */
function resolveMode(project: Project, modeId?: string): LaunchMode | undefined {
  const modes = project.launchModes ?? []
  const mode = modes.find((m) => m.id === (modeId ?? project.activeMode)) ?? modes[0]
  if (mode) return mode
  if (project.type === 'web') {
    return { id: 'preview', kind: 'preview', label: '成品预览', entryPath: project.entryPath }
  }
  return {
    id: 'dev',
    kind: 'dev',
    label: '开发服务器',
    command: project.command,
    port: project.port
  }
}

export async function startProject(id: string, modeId?: string): Promise<StartResult> {
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
  // Phase B（2026-08-21）：按启动方式分发——preview=内置静态服务器、dev=开发服务器、
  // python-static=真实 python http.server、docker=docker compose up
  const mode = resolveMode(project, modeId)
  if (!mode) return { ok: false, reason: '该项目没有启动方式' }
  if (mode.kind === 'preview') return startWeb(project, rt, mode)
  if (mode.kind === 'docker') return startDocker(project, rt, mode)
  if (mode.kind === 'python-static') return startPythonStatic(project, rt, mode)
  return startService(project, rt, mode.command ?? project.command, mode.port ?? project.port)
}

async function startService(
  project: Project,
  rt: Runtime,
  command: string | undefined,
  port: number | undefined
): Promise<StartResult> {
  if (!command) return { ok: false, reason: '该项目没有启动命令' }

  // 端口已有服务在响应：大概率项目已经手动启动了——直接接管显示，不用先杀再开（用户 2026-08-20 拍板）
  if (port && (await checkPortOpen(port))) {
    rt.port = port
    setStatus(rt, project, 'running', port)
    touchStartedAt(project.id)
    touchLastPort(project.id, port)
    return { ok: true, reason: `检测到端口 ${port} 已有服务在响应，已直接显示为运行中` }
  }

  return spawnAndWatch(project, rt, command, project.path, port)
}

/** 起子进程（dev/python/docker 共用，Phase B 2026-08-21）：日志管道 + 退出处理 + 端口健康检查（无端口则存活即运行） */
function spawnAndWatch(
  project: Project,
  rt: Runtime,
  command: string,
  cwd: string,
  port: number | undefined,
  missingHint?: string
): StartResult {
  setStatus(rt, project, 'starting')
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true, // 独立进程组：停止时整树终止
    env: { ...process.env, PATH: buildPath() }
  })
  rt.child = child
  rt.port = port

  child.stdout?.on('data', (d: Buffer) => pipeLog(project.id, d.toString()))
  child.stderr?.on('data', (d: Buffer) => pipeLog(project.id, d.toString()))

  child.on('error', (err) => {
    // 命令不存在（python3/docker 没装）→ 用大白话提示（2026-08-21 跨平台失败翻译）
    const enoent = (err as NodeJS.ErrnoException).code === 'ENOENT'
    fail(rt, project, enoent && missingHint ? missingHint : `启动进程失败：${err.message}`)
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

  if (port) {
    // 端口健康检查：轮询直到就绪或超时
    rt.healthStart = Date.now()
    rt.healthTimer = setInterval(() => {
      const checkPort = rt.port ?? port
      checkPortOpen(checkPort).then((open) => {
        if (rt.status !== 'starting') return
        if (open) {
          clearInterval(rt.healthTimer)
          setStatus(rt, project, 'running', checkPort)
          touchStartedAt(project.id)
          touchLastPort(project.id, checkPort)
          if (project.openBrowser) {
            shell.openExternal(`http://127.0.0.1:${checkPort}`)
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

/** python-static 方式（Phase B 2026-08-21）：真实跑 python3 -m http.server（静态根=成品目录），内置预览的替代 */
async function startPythonStatic(
  project: Project,
  rt: Runtime,
  mode: LaunchMode
): Promise<StartResult> {
  // 老数据（Phase B 前登记）python-static 没存 staticRoot：兜底到 preview 方式的静态根（同一份成品），而不是项目根源码目录
  const root =
    mode.staticRoot ??
    project.launchModes?.find((m) => m.kind === 'preview')?.staticRoot ??
    project.path
  const port = mode.port ?? project.port ?? 8000 // python http.server 默认端口
  if (await checkPortOpen(port)) {
    // 端口被占：和成品预览同款逻辑——上面是个网站就直接接管
    if (await probeWebPort(port)) {
      rt.port = port
      setStatus(rt, project, 'running', port)
      touchStartedAt(project.id)
      touchLastPort(project.id, port)
      emitLog(project.id, `端口 ${port} 已有网站在运行，直接接管`)
      return { ok: true }
    }
    return { ok: false, reason: `端口 ${port} 已被占用` }
  }
  return spawnAndWatch(
    project,
    rt,
    `python3 -m http.server ${port}`,
    root,
    port,
    '电脑没装 python3——换回「成品预览」方式（内置服务器零依赖），或在终端里装一下 python3'
  )
}

/** docker 方式（Phase B 2026-08-21 拍板）：docker compose up，无端口则进程存活即运行 */
async function startDocker(project: Project, rt: Runtime, mode: LaunchMode): Promise<StartResult> {
  return spawnAndWatch(
    project,
    rt,
    mode.command ?? 'docker compose up',
    project.path,
    undefined,
    '电脑没装 Docker——装好 Docker Desktop 后再用这个方式，或换回「成品预览」'
  )
}

async function startWeb(project: Project, rt: Runtime, mode: LaunchMode): Promise<StartResult> {
  const staticRoot = mode.staticRoot ?? project.path
  const entryPath = mode.entryPath ?? project.entryPath
  const modePort = mode.port ?? project.port
  // 端口稳定（2026-08-21 网站常驻）：没指定端口时沿用上次实际端口（重启后地址不变）
  let wantPort = modePort ?? project.lastPort
  if (wantPort && (await checkPortOpen(wantPort))) {
    // 端口被占：先探测是不是一个已经跑着的网站（用户手动起在 7100 的成品站等）——是则直接接管，不再另起炉灶（2026-08-21 实测）
    if (await probeWebPort(wantPort)) {
      rt.port = wantPort
      setStatus(rt, project, 'running', wantPort)
      touchStartedAt(project.id)
      touchLastPort(project.id, wantPort)
      emitLog(project.id, `端口 ${wantPort} 已有网站在运行，直接接管`)
      return { ok: true }
    }
    // 不是网站：显式填的端口报占用；沿用 lastPort 的交给系统自动分配
    if (modePort) {
      return { ok: false, reason: `端口 ${modePort} 已被占用` }
    }
    wantPort = undefined
  }
  setStatus(rt, project, 'starting')
  try {
    const {
      server,
      port,
      entryPath: servedEntry
    } = await startWebServer(staticRoot, wantPort, entryPath)
    rt.server = server
    rt.entryPath = servedEntry
    setStatus(rt, project, 'running', port)
    touchStartedAt(project.id)
    touchLastPort(project.id, port)
    emitLog(project.id, `临时服务已就绪：http://127.0.0.1:${port}${servedEntry}`)
    if (project.openBrowser) {
      shell.openExternal(`http://127.0.0.1:${port}${servedEntry}`)
    }
    return { ok: true }
  } catch (err) {
    fail(rt, project, `临时服务启动失败：${err instanceof Error ? err.message : String(err)}`)
    return { ok: false }
  }
}

/** 切换启动方式（Phase B 2026-08-21 拍板）：运行中先停 → 记录新方式+同步类型 → 原来在跑则按新方式重启 */
export async function switchLaunchMode(id: string, modeId: string): Promise<StartResult> {
  const project = listProjects().find((p) => p.id === id)
  if (!project) return { ok: false, reason: '项目不存在' }
  const modes = project.launchModes ?? []
  const mode = modes.find((m) => m.id === modeId)
  if (!mode) return { ok: false, reason: '没有这个启动方式' }
  const rt = runtimes.get(id)
  const wasRunning = rt !== undefined && (rt.status === 'running' || rt.status === 'starting')
  if (wasRunning) await stopProject(id)
  updateProject(id, { ...project, activeMode: modeId, type: launchKindToType(mode.kind) })
  return wasRunning ? startProject(id) : { ok: true }
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
        // 组自启只拉成品（2026-08-21 拍板）：有「成品预览」方式的子项按 preview 启动；
        // 老数据（无 launchModes）按 type=web 兼容
        for (const child of projects.filter((p) => {
          if (p.parentId !== id) return false
          return (
            (p.launchModes ?? []).some((m) => m.kind === 'preview') ||
            (p.launchModes === undefined && p.type === 'web')
          )
        })) {
          await startProject(child.id, 'preview')
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
    shell.openExternal(`http://127.0.0.1:${rt.port}${rt.entryPath ?? '/'}`)
  } else {
    const port = rt.port ?? project.port
    if (!port) return { ok: false, reason: '该项目没有端口，不知道打开哪个地址' }
    shell.openExternal(`http://127.0.0.1:${port}`)
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
