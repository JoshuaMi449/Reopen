// 进程启动模块：拉起/停止项目进程、端口健康检查、日志推送（PRD 八·技术方案 进程管理+端口检测）
import { execSync, spawn, ChildProcess } from 'child_process'
import { app, BrowserWindow, Notification, shell } from 'electron'
import { chmodSync, existsSync, lstatSync, readdirSync } from 'fs'
import { get } from 'http'
import { homedir } from 'os'
import { join } from 'path'
import { connect } from 'net'
import type {
  LaunchMode,
  Project,
  ProjectFix,
  ProjectStatus,
  ProjectStatusEvent,
  StartResult
} from '../shared/types'
import { isPureWeb } from '../shared/types'
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

function fail(rt: Runtime, project: Project, reason: string, fix?: ProjectFix): void {
  emit({ id: project.id, status: 'failed', port: rt.port, reason, fix })
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

/** 失败兜底：日志里有常见错误特征时，翻译成人话原因（PRD 3.4：通知带失败原因）。
 *  2026-08-24 补齐 9 条高频病：依赖没装/端口占用 Mac 版/Docker 没开/python 缺包/
 *  npm 版本打架/网络/缺 .env/数据库没开/磁盘满 */
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
  if (/EADDRINUSE|Errno 48|Address already in use/i.test(text)) {
    fail(rt, project, '端口已被占用——是不是这个项目之前已经手动启动了？先停掉旧的再启动')
    return
  }
  // 跨平台拷贝的依赖（2026-08-21/22 实测：Windows 项目整个拷到 Mac——二进制不兼容 / 缺 Mac 平台组件 / 权限自动修复后仍有权限问题）
  if (
    /Permission denied/.test(text) ||
    /bad cpu type|exec format error|wrong architecture|not compatible/i.test(text) ||
    /Cannot find module @rollup\/rollup-darwin|npm has a bug related to optional dependencies/i.test(
      text
    ) ||
    // 原生模块是 Windows 二进制（2026-08-24 my-app 实测：better-sqlite3 从 Windows 拷来，Mac 加载不了）
    /ERR_DLOPEN_FAILED|not valid mach-o file|is not a valid Win32 application/i.test(text)
  ) {
    fail(
      rt,
      project,
      '这个项目的依赖没装好（从 Windows 电脑拷贝过来的常见问题）——删掉项目里的 node_modules 和 package-lock.json 重新安装。下面有「帮我装依赖」按钮，点一下就行',
      { kind: 'npm-install', label: '帮我装依赖' }
    )
    return
  }
  // 依赖根本没装/启动命令不存在（2026-08-24 SCADA 实测：删了 node_modules 没重装 → vite: command not found）
  if (
    /command not found|not recognized as an internal or external command|^sh: .*: not found/m.test(
      text
    )
  ) {
    fail(rt, project, '这个项目的依赖没装好——点下面的「帮我装依赖」按钮自动安装，装完再点启动', {
      kind: 'npm-install',
      label: '帮我装依赖'
    })
    return
  }
  if (/npm ERR! Missing script/.test(text)) {
    fail(
      rt,
      project,
      '这个项目的 package.json 里没有对应的启动脚本——右键项目选「编辑」，检查启动命令对不对'
    )
    return
  }
  if (/Cannot connect to the Docker daemon|Is the docker daemon running/i.test(text)) {
    fail(rt, project, 'Docker 没开——先打开 Docker Desktop，等它启动完成再点启动')
    return
  }
  const pyMissing = text.match(/ModuleNotFoundError: No module named ['"]([^'"]+)['"]/)
  if (pyMissing) {
    fail(
      rt,
      project,
      `这个 Python 项目缺一个包「${pyMissing[1]}」——在项目文件夹的终端里跑 pip install ${pyMissing[1]} 装上再启动`
    )
    return
  }
  if (/ERESOLVE|Could not resolve dependency|peer dep/i.test(text)) {
    fail(rt, project, '依赖版本打架——在项目文件夹的终端里跑 npm install --legacy-peer-deps 再试')
    return
  }
  if (/ETIMEDOUT|ECONNRESET|getaddrinfo ENOTFOUND|network request failed/i.test(text)) {
    fail(rt, project, '网络问题——下载依赖连不上软件源，检查网络或代理，或换个 npm 源再试')
    return
  }
  if (/Missing environment variable|process\.env|\.env file/i.test(text)) {
    fail(rt, project, '这个项目缺配置（密钥之类的 .env 文件）——看看项目说明文档，把配置补上再启动')
    return
  }
  if (/ECONNREFUSED.*(5432|3306|27017|6379|5433)|connect ECONNREFUSED/s.test(text)) {
    fail(rt, project, '数据库没启动——先把这个项目用的数据库服务跑起来（或检查数据库地址）')
    return
  }
  if (/ENOSPC|no space left on device/i.test(text)) {
    fail(rt, project, '磁盘满了——清理磁盘空间后再启动')
    return
  }
  fail(rt, project, fallback)
}

/** 最近日志里是否出现过 Permission denied（npm 调无执行位脚本的典型输出） */
function hasPermissionDenied(id: string): boolean {
  return /Permission denied/i.test((recentLogs.get(id) ?? []).join('\n'))
}

/** 最近日志里是否出现「跨平台拷贝依赖病」特征（2026-08-24 静默自愈：
 *  Mac 收到 Windows 项目：原生模块 PE 二进制 / 缺 darwin 可选依赖 / 无执行位
 *  Windows 收到 Mac 项目：Mach-O 二进制报"not a valid Win32 application"/DLL 初始化失败 */
function hasCrossPlatformDeps(id: string): boolean {
  return /ERR_DLOPEN_FAILED|not valid mach-o file|is not a valid Win32 application|DLL initialization routine failed|bad cpu type|exec format error|wrong architecture|not compatible|Cannot find module @rollup\/rollup-darwin|npm has a bug related to optional dependencies/i.test(
    (recentLogs.get(id) ?? []).join('\n')
  )
}

/** 跨平台依赖病静默自愈（2026-08-24 用户拍板"静默直接做好"）：自动 npm install --force 重装依赖，
 *  装完自动重启项目；装失败才弹人话+「再试一次」按钮。只自动一次（isRetry 不重复） */
function tryReinstallAndRetry(
  project: Project,
  rt: Runtime,
  command: string,
  cwd: string,
  port: number | undefined,
  missingHint: string | undefined,
  isRetry: boolean | undefined
): boolean {
  if (isRetry) return false
  emitLog(
    project.id,
    '检测到依赖是另一台系统的版本（Windows/Mac 拷贝的通病）——正在自动重新安装依赖，装完自动重启项目'
  )
  const child = spawn('npm install --force', {
    cwd,
    shell: true,
    detached: true,
    env: { ...process.env, PATH: buildPath() }
  })
  child.stdout?.on('data', (d: Buffer) => pipeLog(project.id, d.toString()))
  child.stderr?.on('data', (d: Buffer) => pipeLog(project.id, d.toString()))
  child.on('exit', (code) => {
    if (rt.status !== 'starting') return
    if (code === 0) {
      emitLog(project.id, '依赖装好了，自动重启项目')
      spawnAndWatch(project, rt, command, cwd, port, missingHint, true)
    } else {
      fail(
        rt,
        project,
        '依赖自动重装没成功（网络或权限问题）——点下面的「再试一次」重装，或看日志手动处理',
        { kind: 'npm-install', label: '再试一次' }
      )
    }
  })
  return true
}

/** 给 node_modules/.bin 下没有执行位的脚本补执行位（Windows/网盘拷贝项目的通病），返回修复个数 */
function fixBinPermissions(cwd: string): number {
  try {
    const names = readdirSync(join(cwd, 'node_modules', '.bin'))
    let fixed = 0
    for (const name of names) {
      const p = join(cwd, 'node_modules', '.bin', name)
      const st = lstatSync(p)
      if (st.isFile() && (st.mode & 0o111) === 0) {
        chmodSync(p, st.mode | 0o111)
        fixed++
      }
    }
    return fixed
  } catch {
    return 0
  }
}

/** 权限病自动修复（2026-08-22 用户拍板）：补上执行位后自动重试一次，日志透明记录发生了什么 */
function tryFixAndRetry(
  project: Project,
  rt: Runtime,
  command: string,
  cwd: string,
  port: number | undefined,
  missingHint: string | undefined,
  isRetry: boolean | undefined
): boolean {
  if (isRetry) return false
  const fixed = fixBinPermissions(cwd)
  if (fixed === 0) return false
  emitLog(
    project.id,
    `检测到依赖脚本没有执行权限（从 Windows/网盘拷贝项目的通病）——已自动补上 ${fixed} 个脚本的执行权限，重试启动`
  )
  spawnAndWatch(project, rt, command, cwd, port, missingHint, true)
  return true
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
  // 从后往前：日志是追加的，最新一次启动打的实际端口在最后（旧行里可能还躺着上次的端口）
  const lines = recentLogs.get(id) ?? []
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/localhost:(\d{2,5})/)
    if (m) return Number(m[1])
  }
  return undefined
}

/** 端口是否已被占用（能连上 = 占用）。
 *  IPv4/IPv6 双栈并行敲：vite 等框架默认监听 localhost（macOS 解析成 ::1），
 *  只敲 127.0.0.1 会永远敲不开 → 误判启动失败（2026-08-24 SCADA 事故） */
function checkPortOpen(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    let opened = false
    let failed = 0
    for (const host of ['127.0.0.1', '::1']) {
      const sock = connect({ port, host })
      sock.setTimeout(800)
      sock.once('connect', () => {
        sock.destroy()
        if (!opened) {
          opened = true
          resolvePromise(true)
        }
      })
      sock.once('timeout', () => {
        sock.destroy()
        finishFail()
      })
      sock.once('error', () => {
        sock.destroy()
        finishFail()
      })
    }
    function finishFail(): void {
      failed++
      if (!opened && failed >= 2) resolvePromise(false)
    }
  })
}

/** 探测端口上是不是一个正在响应的网站（2xx/3xx 且是 HTML）。
 *  接管用（2026-08-21）：用户手动在 7100 跑的成品站，Reopen 不再另起炉灶，直接认领显示。
 *  IPv4/IPv6 双栈并行探（同 checkPortOpen，2026-08-24 SCADA 事故） */
function probeWebPort(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    let answered = false
    let failed = 0
    for (const host of ['127.0.0.1', '::1']) {
      const req = get({ host, port, path: '/', timeout: 1500 }, (res) => {
        res.resume()
        if (answered) return
        const code = res.statusCode ?? 0
        const contentType = String(res.headers['content-type'] ?? '')
        if (
          code >= 200 &&
          code < 400 &&
          (contentType.includes('text/html') || contentType === '')
        ) {
          answered = true
          resolvePromise(true)
        } else {
          finishFail()
        }
      })
      req.once('timeout', () => {
        req.destroy()
        finishFail()
      })
      req.once('error', () => {
        req.destroy()
        finishFail()
      })
    }
    function finishFail(): void {
      failed++
      if (!answered && failed >= 2) resolvePromise(false)
    }
  })
}

// GUI 应用拿不到用户 shell 的 PATH（npm/node 常装在自定义位置），补上常见安装位置
function buildPath(): string {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.npm-global/bin')]
  // 剔除 Reopen 自己的 node_modules/.bin：dev 模式下它被 electron-vite 注入主进程 PATH，
  // 原样传给项目会让没装依赖的项目"借"到 Reopen 的 vite 假跑起来（2026-08-24 SCADA 事故）
  const appRoot = app.getAppPath()
  const inherited = (process.env.PATH ?? '')
    .split(':')
    .filter((seg) => seg && !seg.startsWith(appRoot))
  return [...extra, ...inherited].join(':')
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

/** 常见启动命令 → 依赖检查目标与安装指引（2026-08-24：启动前预检，缺运行时直接人话提示，不用等进程报错） */
const DEP_RULES: { pattern: RegExp; candidates: string[]; hint: string }[] = [
  {
    pattern: /^(npm|npx|yarn|pnpm|node|tsx|ts-node)$/,
    candidates: ['npm', 'node'],
    hint: '这台电脑没装 Node.js，但这个项目要用 npm 启动。去 nodejs.org 下载安装，装完重启 Reopen 再点启动'
  },
  {
    pattern: /^(python3|python|py)$/,
    candidates: ['python3', 'python'],
    hint: '这台电脑没装 Python，但这个项目要用 python 启动。去 python.org 下载安装，装完重启 Reopen 再点启动'
  },
  {
    pattern: /^docker$/,
    candidates: ['docker'],
    hint: '这台电脑没装 Docker，但这个项目用 Docker 启动。去 docker.com 装 Docker Desktop，装完重启 Reopen 再点启动'
  },
  {
    pattern: /^(bun|bunx)$/,
    candidates: ['bun'],
    hint: '这台电脑没装 Bun，但这个项目用 bun 启动。去 bun.sh 安装，装完重启 Reopen 再点启动'
  },
  {
    pattern: /^deno$/,
    candidates: ['deno'],
    hint: '这台电脑没装 Deno，但这个项目用 deno 启动。去 deno.com 安装，装完重启 Reopen 再点启动'
  }
]

/** 命令是否可执行（Windows 用 where，macOS/Linux 用 which） */
function commandExists(cmd: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  try {
    execSync(`${probe} ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** 启动命令缺依赖 → 返回安装指引文案；依赖齐 → null（自定义脚本交给 shell 报错，不预检） */
function missingDependencyHint(command: string): string | null {
  const token = command.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const rule = DEP_RULES.find((r) => r.pattern.test(token))
  if (!rule) return null
  return rule.candidates.some(commandExists) ? null : rule.hint
}

/** 起子进程（dev/python/docker 共用，Phase B 2026-08-21）：日志管道 + 退出处理 + 端口健康检查（无端口则存活即运行） */
function spawnAndWatch(
  project: Project,
  rt: Runtime,
  command: string,
  cwd: string,
  port: number | undefined,
  missingHint?: string,
  isRetry?: boolean
): StartResult {
  // 依赖预检（2026-08-24 拍板"是不是要装 npm/node/python"）：spawn 之前先查运行时，缺了直接人话提示+安装指引
  const depHint = missingDependencyHint(command)
  if (depHint) {
    fail(rt, project, depHint)
    return { ok: false, reason: depHint }
  }
  setStatus(rt, project, 'starting')
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true, // 独立进程组：停止时整树终止
    env: {
      ...process.env,
      PATH: buildPath(),
      // 局域网访问开 → 塞 HOST 让 vite 等框架也对外接待（不认这个变量的框架需要项目里自己配，2026-08-24）
      ...(getSettings().lanAccess ? { HOST: '0.0.0.0' } : {})
    }
  })
  rt.child = child
  rt.port = port

  child.stdout?.on('data', (d: Buffer) => pipeLog(project.id, d.toString()))
  child.stderr?.on('data', (d: Buffer) => pipeLog(project.id, d.toString()))

  child.on('error', (err) => {
    // 命令不存在（python3/docker 没装）→ 用大白话提示（2026-08-21 跨平台失败翻译）
    const code = (err as NodeJS.ErrnoException).code
    const enoent = code === 'ENOENT'
    // 直接执行无权限的可执行文件（罕见，一般走 exit 分支的 npm 路径）
    if (
      code === 'EACCES' &&
      tryFixAndRetry(project, rt, command, cwd, port, missingHint, isRetry)
    ) {
      return
    }
    fail(rt, project, enoent && missingHint ? missingHint : `启动进程失败：${err.message}`)
  })
  child.on('exit', (code, signal) => {
    if (rt.healthTimer) clearInterval(rt.healthTimer)
    rt.child = undefined
    if (rt.status === 'starting') {
      // 权限病自动修复（2026-08-22 用户拍板）：日志出现 Permission denied → 补执行位自动重试一次
      if (
        hasPermissionDenied(project.id) &&
        tryFixAndRetry(project, rt, command, cwd, port, missingHint, isRetry)
      ) {
        return
      }
      // 跨平台依赖病静默自愈（2026-08-24 用户拍板"静默直接做好"）：自动重装依赖+重启
      if (
        hasCrossPlatformDeps(project.id) &&
        tryReinstallAndRetry(project, rt, command, cwd, port, missingHint, isRetry)
      ) {
        return
      }
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
          // 项目日志打了另一个端口（框架端口被占自动漂移，2026-08-24 open suposs 撞车破案）：
          // 配置端口通 ≠ 项目通（占着的可能是别人）——信日志端口，切过去等它确认
          const drifted = parseLogPort(project.id)
          if (drifted && drifted !== checkPort) {
            rt.port = drifted
            setStatus(rt, project, 'starting', drifted)
            return
          }
          clearInterval(rt.healthTimer)
          setStatus(rt, project, 'running', checkPort)
          touchStartedAt(project.id)
          touchLastPort(project.id, checkPort)
          // 保险：3 秒后日志若打出另一个端口且开放 → 纠正显示（vite 日志晚于健康检查判定的场景）
          const myPort = checkPort
          setTimeout(() => {
            if (rt.status !== 'running' || rt.port !== myPort) return
            const d = parseLogPort(project.id)
            if (d && d !== myPort) {
              checkPortOpen(d).then((openDrifted) => {
                if (openDrifted && rt.status === 'running' && rt.port === myPort) {
                  rt.port = d
                  setStatus(rt, project, 'running', d)
                  touchLastPort(project.id, d)
                }
              })
            }
          }, 3000)
          if (project.openBrowser) {
            openUrl(`http://localhost:${checkPort}`)
          }
        } else {
          // S8：端口漂移（vite 端口被占自动 +1）——日志里出现实际端口就切换检查目标
          const drifted = parseLogPort(project.id)
          if (drifted && drifted !== rt.port) {
            rt.port = drifted
            setStatus(rt, project, 'starting', drifted)
          } else if (Date.now() - rt.healthStart > HEALTH_TIMEOUT_MS) {
            clearInterval(rt.healthTimer)
            // 进程可能还活着：启动被判失败也不能留僵尸占端口（2026-08-24 SCADA 事故：误判后僵尸越点越多）
            killTree(rt)
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
    } = await startWebServer(
      staticRoot,
      wantPort,
      entryPath,
      getSettings().lanAccess ? '0.0.0.0' : '127.0.0.1'
    )
    rt.server = server
    rt.entryPath = servedEntry
    setStatus(rt, project, 'running', port)
    touchStartedAt(project.id)
    touchLastPort(project.id, port)
    emitLog(project.id, `临时服务已就绪：http://127.0.0.1:${port}${servedEntry}`)
    if (project.openBrowser) {
      openUrl(`http://localhost:${port}${servedEntry}`)
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

/** 一键安装依赖（2026-08-24 拍板：失败提示区的"帮我装依赖"按钮）：
 *  在项目目录跑 npm install，输出实时推项目日志面板，装完打收尾日志，用户自己再点启动 */
export function installProjectDeps(id: string): void {
  const project = listProjects().find((p) => p.id === id)
  if (!project) return
  emitLog(id, '开始安装依赖：npm install（可能要几分钟，装完会告诉你）')
  const child = spawn('npm install', {
    cwd: project.path,
    shell: true,
    detached: true,
    env: { ...process.env, PATH: buildPath() }
  })
  child.stdout?.on('data', (d: Buffer) => pipeLog(id, d.toString()))
  child.stderr?.on('data', (d: Buffer) => pipeLog(id, d.toString()))
  child.on('exit', (code) => {
    emitLog(
      id,
      code === 0
        ? '依赖装好了——回到 Reopen 点「启动」试试'
        : `安装失败（退出码 ${code}），原因看上面日志`
    )
  })
}

/** 打开链接：用户设了默认浏览器 → open -a 指定浏览器；否则系统默认（2026-08-24 拍板"偏好设置里选浏览器"） */
function openUrl(url: string): void {
  const browser = getSettings().defaultBrowser
  if (browser) {
    spawn('open', ['-a', browser, url], { detached: true }).unref()
  } else {
    shell.openExternal(url)
  }
}

/** 等一个项目跑到 running（最多 ms 毫秒，150ms 一问） */
async function waitRunning(id: string, ms: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const rt = runtimes.get(id)
    if (rt?.status === 'running') return true
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}

/** 右键"在浏览器打开"：项目运行中则弹默认浏览器（PRD 3.3 右键菜单）
 *  entry=入口文件相对路径（多入口列表点哪个开哪个，2026-08-24 拍板）
 *  纯网页（登记即在线）：没运行/启动中 → 自动拉起等就绪再开（2026-08-24 用户实测"打开是空的"） */
export async function openProjectBrowser(id: string, entry?: string): Promise<StartResult> {
  const project = listProjects().find((p) => p.id === id)
  if (!project) return { ok: false, reason: '项目不存在' }
  let rt = runtimes.get(id)
  if (!rt || rt.status !== 'running') {
    if (isPureWeb(project)) {
      if (rt?.status === 'starting') {
        // 正在自动上线中：等它就好
        if (!(await waitRunning(id, 8000))) {
          return { ok: false, reason: '网页服务还没起来，稍等几秒再点' }
        }
      } else {
        await startProject(id, 'preview')
        if (!(await waitRunning(id, 8000))) {
          return { ok: false, reason: '网页服务还没起来，稍等几秒再点' }
        }
      }
      rt = runtimes.get(id)
    } else {
      return { ok: false, reason: '项目还没启动，先点启动' }
    }
  }
  if (!rt) return { ok: false, reason: '网页服务还没起来，稍等几秒再点' }
  if (project.type === 'web') {
    openUrl(`http://localhost:${rt.port}${entry ?? rt.entryPath ?? '/'}`)
  } else {
    const port = rt.port ?? project.port
    if (!port) return { ok: false, reason: '该项目没有端口，不知道打开哪个地址' }
    openUrl(`http://localhost:${port}${entry ?? ''}`)
  }
  return { ok: true }
}

/** 杀整个进程组（整树终止），3 秒没退就强杀；已退/不存在静默。停止与启动失败清理共用 */
function killTree(rt: Runtime): void {
  const pid = rt.child?.pid
  if (!pid) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      rt.child?.kill('SIGTERM')
    } catch {
      // 进程已退出
    }
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // 进程已退出
    }
  }, KILL_GRACE_MS)
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
    // 服务类：杀整个进程组（整树终止），3 秒没退就强杀；exit 事件里会推送 stopped
    killTree(rt)
  }
}
