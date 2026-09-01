// 进程启动模块：拉起/停止项目进程、端口健康检查、日志推送（PRD 八·技术方案 进程管理+端口检测）
import { execSync, spawn, ChildProcess } from 'child_process'
import { app, BrowserWindow, Notification, shell } from 'electron'
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync } from 'fs'
import { get } from 'http'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { connect } from 'net'
import type {
  LanMode,
  LaunchMode,
  Project,
  ProjectFix,
  ProjectStatus,
  ProjectStatusEvent,
  StartResult
} from '../shared/types'
import { isPureWeb } from '../shared/types'
import { getSettings, listProjects, touchLanSlug, touchLastPort, touchStartedAt } from './store'
import { getLanIp, probeLan } from './lan'
import { startWebServer } from './webServer'
import { makeLanSlug, scanJsRootPaths, scanLocalHostRefs } from './detect'
import {
  clearLeakPaths,
  getGatewayPort,
  registerRoute,
  setLeakListener,
  startGateway,
  stopGateway,
  unregisterRoute
} from './gateway'
import {
  probeNow,
  registerTarget,
  scheduleLeakRecheck,
  setRecheckAll,
  unregisterTarget
} from './mountProbe'

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
  /** 统一入口挂载状态（probing/route/route-rewrite/direct；emit 时带上，UI 据此显示访客地址） */
  lanMode?: LanMode
  /** 网页文件入口路径（单个文件登记时带文件名），右键"在浏览器打开"用 */
  entryPath?: string
  healthTimer?: NodeJS.Timeout
  healthStart: number
  /** 启动前检测到的同目录残留进程组（用户「终止残留并启动」按钮用） */
  residualPids?: number[]
  /** 本次启动不自动打开浏览器（自启拉起专用：即使项目勾了「启动后打开浏览器」也不开） */
  noOpenBrowser?: boolean
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

/** 项目是否正在运行（切换启动方式时判断：运行中=停掉按新方式重启；停止态=只改存档） */
export function isProjectRunning(id: string): boolean {
  const st = runtimes.get(id)?.status
  return st === 'running' || st === 'starting'
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
    lanMode: rt.lanMode,
    startedAt: status === 'running' ? Date.now() : undefined
  })
  // 统一入口挂载/摘除中枢：所有 running/stopped 路径都经过这里，一处挂一处摘
  void syncGatewayMount(rt, project)
}

// ---------- 统一入口挂载（方案一：IP + 路径） ----------

/** 统一入口路由名：档案里有就用；老数据惰性生成并写回（改名不改 slug，访客书签稳定） */
function ensureLanSlug(project: Project): string {
  if (project.lanSlug) return project.lanSlug
  const taken = new Set<string>()
  for (const p of listProjects()) {
    if (p.id !== project.id && p.lanSlug) taken.add(p.lanSlug)
  }
  const slug = makeLanSlug(project.name, taken)
  project.lanSlug = slug
  touchLanSlug(project.id, slug)
  return slug
}

/** 挂载状态变化 → 记运行时 + 推事件（UI 据此显示访客地址） */
function setLanMode(project: Project, mode: LanMode): void {
  const rt = getRuntime(project.id)
  rt.lanMode = mode
  emit({
    id: project.id,
    status: rt.status,
    port: rt.port,
    lanMode: mode,
    lanIp: getLanIp(),
    gatewayPort: getGatewayPort()
  })
}

/** 实测结果的日志说明（项目日志面板透明可见，不弹窗）。有预判时对比输出"确认/修正" */
function mountLog(project: Project, mode: LanMode, predicted?: LanMode): void {
  const ip = getLanIp()
  const gw = getGatewayPort()
  const route = `http://${ip}:${gw}/rp/${project.lanSlug}/`
  const direct = `http://${ip}:${project.port ?? ''}/`
  if (predicted) {
    if (mode === predicted) {
      emitLog(
        project.id,
        mode === 'route'
          ? `实测确认 ✓ 零改写直挂：${route}`
          : `实测确认 ✓ 自动改写（页面里的本机地址链接已翻译）：${route}`
      )
      return
    }
    emitLog(
      project.id,
      mode === 'direct'
        ? `实测修正：统一入口不可用，降级独立端口：${direct}`
        : `实测修正：${mode === 'route' ? '零改写直挂' : '自动改写'}：${route}`
    )
    return
  }
  if (mode === 'route') emitLog(project.id, `统一入口就绪：${route}`)
  else if (mode === 'route-rewrite')
    emitLog(project.id, `统一入口就绪（自动改写页面里的根路径引用）：${route}`)
  else if (mode === 'direct') emitLog(project.id, `统一入口降级为独立端口：${direct}`)
}

/** 项目 running → 挂上统一入口。JS 体检命中（拖入时或挂载时实时复扫）直接 direct 不实测（宁丢便利不丢正确）。
 *  每次挂载都复扫：项目重构建可能引入新病（SPA history 路由等），档案值只是拖入时的快照 */
async function mountProject(project: Project, port: number): Promise<void> {
  if (project.type === 'group') return
  const s = getSettings()
  if (!s.gatewayEnabled || !s.lanAccess) return
  const slug = ensureLanSlug(project)
  // 扫成品目录优先（preview 的 staticRoot 才是访客真正看到的内容）；老数据无档案值也靠这轮补判
  const staticRoot = project.launchModes?.find((m) => m.kind === 'preview')?.staticRoot
  const suspicious = project.lanSuspicious === true || scanJsRootPaths(staticRoot ?? project.path)
  if (suspicious) {
    registerRoute({ slug, name: project.name, port, mode: 'direct' })
    setLanMode(project, 'direct')
    emitLog(
      project.id,
      '体检发现 JS 写死根路径或 history 路由（子路径下会白屏），统一入口自动降级为独立端口访问'
    )
    return
  }
  registerRoute({ slug, name: project.name, port, mode: 'route' })
  registerTarget({ id: project.id, name: project.name, slug, port })
  // 预判（挂载即明牌，不等实测）：文件里写死本机 host:port 链接 → 改写模式；否则直挂。
  // 预判直接推给前端（卡片立刻显示统一入口地址），实测几秒内完成后再校正
  const predicted: LanMode = scanLocalHostRefs(staticRoot ?? project.path)
    ? 'route-rewrite'
    : 'route'
  setLanMode(project, predicted)
  emitLog(
    project.id,
    predicted === 'route-rewrite'
      ? `统一入口预判·改写模式（页面含写死本机地址链接，自动翻译）：http://${getLanIp()}:${getGatewayPort()}/rp/${slug}/，实测复核中…`
      : `统一入口预判·直挂模式：http://${getLanIp()}:${getGatewayPort()}/rp/${slug}/，实测复核中…`
  )
  await probeNow(project.id, (mode) => {
    setLanMode(project, mode)
    mountLog(project, mode, predicted)
  })
}

/** 项目停止/失败 → 摘除统一入口 */
function unmountProject(project: Project): void {
  unregisterTarget(project.id)
  if (project.lanSlug) unregisterRoute(project.lanSlug)
  const rt = getRuntime(project.id)
  if (rt.lanMode) {
    rt.lanMode = undefined
    // 通知 UI 清掉访客入口显示（lanMode 回到未探测态）
    emit({ id: project.id, status: rt.status, port: rt.port, lanMode: undefined })
  }
}

/** 状态中枢：running 且拿到端口 → 挂载；其余 → 摘除 */
function syncGatewayMount(rt: Runtime, project: Project): void {
  if (rt.status === 'running' && rt.port) {
    void mountProject(project, rt.port)
  } else {
    unmountProject(project)
  }
}

/** 网关漏网信号 → 防抖重测全部挂载项目（某个项目内页 JS 写死根路径跳转露馅 → 自动降级） */
export function reprobeAllMounted(): void {
  clearLeakPaths()
  for (const [id, rt] of runtimes) {
    if (rt.status !== 'running' || !rt.port) continue
    const project = listProjects().find((p) => p.id === id)
    if (project && !project.lanSuspicious && project.lanSlug) {
      const oldMode = rt.lanMode
      void probeNow(id, (mode) => {
        setLanMode(project, mode)
        if (mode !== oldMode) mountLog(project, mode)
      })
    }
  }
}

/** 接线（index.ts 启动时调一次）：漏网信号 → 防抖重测 */
export function initGatewayHooks(): void {
  setLeakListener(() => scheduleLeakRecheck())
  setRecheckAll(() => reprobeAllMounted())
}

/** 统一入口开关/端口变化时调用（ipc settings:save 联动）：
 *  双开关任一关 → 停网关+摘除全部挂载；开 → 起网关+重新挂载所有 running 项目 */
export async function syncGateway(): Promise<void> {
  const s = getSettings()
  console.log(
    `[gateway] syncGateway 触发 enabled=${s.gatewayEnabled} lanAccess=${s.lanAccess} port=${s.gatewayPort}`
  )
  if (!s.gatewayEnabled || !s.lanAccess) {
    stopGateway()
    for (const [id, rt] of runtimes) {
      if (rt.status !== 'running') continue
      const project = listProjects().find((p) => p.id === id)
      if (project) unmountProject(project)
    }
    return
  }
  const port = await startGateway(s.gatewayPort)
  console.log(`[gateway] startGateway 返回 ${port}`)
  if (port === 0) {
    console.error('[gateway] 统一入口启动失败（端口连续被占）')
    return
  }
  if (port !== s.gatewayPort) {
    console.error(`[gateway] 设置的端口 ${s.gatewayPort} 被占用，改用 ${port}`)
  }
  for (const [id, rt] of runtimes) {
    if (rt.status === 'running' && rt.port) {
      const project = listProjects().find((p) => p.id === id)
      if (project) void mountProject(project, rt.port)
    }
  }
}

/** 局域网可达性探测+推送：lanAccess 开且拿得到本机 IP 才探。
 *  running 后稍等再探（服务刚就绪的瞬时抖动），失败 4 秒后重试一次再定论；
 *  接管的服务探测不通时日志给解法（由本应用托管重启才能对局域网开门）。
 *  spawned 标记服务是不是本应用自己拉起的（渲染层据此决定给按钮还是给提示） */
function probeAndEmitLan(rt: Runtime, project: Project, port: number): void {
  if (!getSettings().lanAccess) return
  const ip = getLanIp()
  if (!ip) return
  const tryProbe = (attempt: number): void => {
    probeLan(ip, port).then((ok) => {
      if (rt.status !== 'running') return
      emit({
        id: project.id,
        status: 'running',
        port: rt.port ?? port,
        lanIp: ip,
        lanReachable: ok,
        spawned: !!rt.child?.pid,
        lanMode: rt.lanMode,
        gatewayPort: getGatewayPort()
      })
      if (!ok && attempt === 0) {
        // 文案按服务出身区分：自己起的没托管按钮（加 --host 才行），接管的外部服务才有
        emitLog(
          project.id,
          rt.child?.pid
            ? `局域网探测失败：端口 ${port} 的服务只绑了本机，同一 Wi-Fi 的设备访问不了。这个服务是本应用启动的，在项目的启动命令里加 --host 0.0.0.0 才能局域网访问`
            : `局域网探测失败：端口 ${port} 的服务只绑了本机，同一 Wi-Fi 的设备访问不了。想局域网访问的话，点「由本应用托管」停掉它重新启动`
        )
        setTimeout(() => tryProbe(1), 4000)
      }
    })
  }
  setTimeout(() => tryProbe(0), 500)
}

/** 重探所有 running 项目的局域网可达性（开「允许局域网访问」/发现 IP 变化时调用） */
export function reprobeAllLan(): void {
  for (const [id, rt] of runtimes) {
    if (rt.status !== 'running' || !rt.port) continue
    const project = listProjects().find((p) => p.id === id)
    if (project) probeAndEmitLan(rt, project, rt.port)
  }
}

/** 查占用端口的外部进程 PID（手动起的服务）；没查到返回 null */
function findPidByPort(port: number): number | null {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf-8',
      timeout: 5000
    })
    const pid = Number(out.trim().split('\n')[0])
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/** 改由本应用托管（局域网打不开的补救）：停掉占着端口的旧服务（用户手动起的），
 *  用项目自己的启动方式重新起——本应用起的服务按「允许局域网访问」设置自动开门。
 *  只杀监听该端口的进程，其余一律不动 */
export async function rehostProject(id: string): Promise<StartResult> {
  const project = listProjects().find((p) => p.id === id)
  if (!project) return { ok: false, reason: '项目不存在' }
  const rt = getRuntime(id)
  if (rt.child?.pid) {
    return {
      ok: false,
      reason:
        '这个服务是本应用拉起的，改不了它开门方式——在项目命令里加 --host 0.0.0.0 才能局域网访问'
    }
  }
  const port = rt.port ?? project.port
  if (!port) return { ok: false, reason: '该项目没有端口' }
  const pid = findPidByPort(port)
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // 已退出
    }
    let released = false
    for (let i = 0; i < 50; i++) {
      if (!(await checkPortOpen(port))) {
        released = true
        break
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    if (!released) {
      return { ok: false, reason: `端口 ${port} 的旧服务没有停掉，请手动停掉后再试` }
    }
    // 清掉旧的运行态（否则 startProject 会拦「已经在运行了」）
    rt.status = 'stopped'
    rt.child = undefined
    emitLog(id, `已停掉手动起的旧服务，改用本应用启动（端口 ${port}，会自动对局域网开门）`)
  }
  return startProject(id)
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
 *  补齐 9 条高频病：依赖没装/端口占用 Mac 版/Docker 没开/python 缺包/
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
  // 跨平台拷贝的依赖（/22 实测：Windows 项目整个拷到 Mac——二进制不兼容 / 缺 Mac 平台组件 / 权限自动修复后仍有权限问题）
  if (
    /Permission denied/.test(text) ||
    /bad cpu type|exec format error|wrong architecture|not compatible/i.test(text) ||
    /Cannot find module @rollup\/rollup-darwin|npm has a bug related to optional dependencies/i.test(
      text
    ) ||
    // 原生模块是 Windows 二进制（my-app 实测：better-sqlite3 从 Windows 拷来，Mac 加载不了）
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
  // 依赖根本没装/启动命令不存在（SCADA 实测：删了 node_modules 没重装 → vite: command not found）
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

/** 最近日志里是否出现「跨平台拷贝依赖病」特征（静默自愈：
 *  Mac 收到 Windows 项目：原生模块 PE 二进制 / 缺 darwin 可选依赖 / 无执行位
 *  Windows 收到 Mac 项目：Mach-O 二进制报"not a valid Win32 application"/DLL 初始化失败 */
function hasCrossPlatformDeps(id: string): boolean {
  return /ERR_DLOPEN_FAILED|not valid mach-o file|is not a valid Win32 application|DLL initialization routine failed|bad cpu type|exec format error|wrong architecture|not compatible|Cannot find module @rollup\/rollup-darwin|npm has a bug related to optional dependencies/i.test(
    (recentLogs.get(id) ?? []).join('\n')
  )
}

/** 跨平台依赖病静默自愈（"静默直接做好"）：自动 npm install --force 重装依赖，
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

/** 权限病自动修复：补上执行位后自动重试一次，日志透明记录发生了什么 */
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
 *  只敲 127.0.0.1 会永远敲不开 → 误判启动失败（SCADA 事故） */
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
 *  接管用（用户手动在 7100 跑的成品站，Reopen 不再另起炉灶，直接认领显示。
 *  IPv4/IPv6 双栈并行探（同 checkPortOpen，SCADA 事故） */
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
  // 原样传给项目会让没装依赖的项目"借"到 Reopen 的 vite 假跑起来（SCADA 事故）
  const appRoot = app.getAppPath()
  const inherited = (process.env.PATH ?? '')
    .split(':')
    .filter((seg) => seg && !seg.startsWith(appRoot))
  return [...extra, ...inherited].join(':')
}

/** 项目的启动方式：指定 id > activeMode > 第一个；老数据无 launchModes 按 type 生成单方式（兼容）*/
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

export async function startProject(
  id: string,
  modeId?: string,
  opts?: { noOpenBrowser?: boolean }
): Promise<StartResult> {
  const project = listProjects().find((p) => p.id === id)
  if (!project) return { ok: false, reason: '项目不存在' }
  if (project.type === 'group') {
    return { ok: false, reason: '组不能直接启动——展开组，启动里面的子项' }
  }
  const rt = getRuntime(id)
  // 每次启动重设（自启拉起传 true；手动启动恢复跟随项目设置）
  rt.noOpenBrowser = opts?.noOpenBrowser ?? false
  if (rt.status === 'running' || rt.status === 'starting') {
    return { ok: false, reason: '已经在运行了' }
  }
  if (!existsSync(project.path)) {
    return { ok: false, reason: '项目路径不存在（可能被移动或删除了）' }
  }
  // （按启动方式分发——preview=内置静态服务器、dev=开发服务器、
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

  // 端口已有服务在响应：大概率项目已经手动启动了——直接接管显示，不用先杀再开。
  // 打日志说明发生了什么，否则「绿灯但没有日志」会让人以为启动坏了
  if (port && (await checkPortOpen(port))) {
    rt.port = port
    setStatus(rt, project, 'running', port)
    touchStartedAt(project.id)
    touchLastPort(project.id, port)
    emitLog(project.id, `端口 ${port} 已有服务在响应，直接显示为运行中（没有新开进程）`)
    probeAndEmitLan(rt, project, port)
    return { ok: true, reason: `检测到端口 ${port} 已有服务在响应，已直接显示为运行中` }
  }

  // 同目录残留检测：目录里已有 dev 进程在跑（比如改端口前旧实例没停），
  // 直接提示而不是再开一个——两个 dev 共享 .next 缓存会互相踩脚，CPU/内存被打爆（52GB 事故）
  const residual = findResidualDev(project.path)
  if (residual.length > 0) {
    rt.residualPids = residual.map((r) => r.pgid)
    emitLog(
      project.id,
      `检测到同目录残留进程：${residual.map((r) => `PID ${r.pid}`).join('、')}——不重复启动`
    )
    fail(
      rt,
      project,
      '这个项目已经在跑了（目录里有残留的开发进程）。再开一个会让两个开发服务器互相踩脚，CPU 和内存会被打爆——先终止残留，再启动',
      { kind: 'kill-residue', label: '终止残留并启动' }
    )
    return { ok: false, reason: '项目已经在跑了' }
  }

  return spawnAndWatch(project, rt, command, project.path, port)
}

/** 项目目录下的残留 dev 进程（用户启动前检测，防同目录双开 dev 共享 .next 缓存互相踩脚——next-server 52GB 事故）。
 *  一次 lsof 拿全量进程 cwd 对比项目目录；只认 dev 相关命令（node/next/vite/python 等），
 *  排除 shell 本身（用户 cd 进目录的终端不算）与 Reopen 自己管理的进程组（detached 子进程 pgid=child.pid） */
function findResidualDev(cwd: string): { pid: number; pgid: number }[] {
  try {
    const target = resolve(cwd)
    const out = execSync('lsof -a -d cwd -Fn', { encoding: 'utf-8', timeout: 8000 })
    const managed = new Set<number>()
    for (const rt of runtimes.values()) if (rt.child?.pid) managed.add(rt.child.pid)
    const found: { pid: number; pgid: number }[] = []
    let pid = 0
    for (const line of out.split('\n')) {
      if (line.startsWith('p')) {
        pid = Number(line.slice(1))
      } else if (pid && line.startsWith('n') && resolve(line.slice(1)) === target) {
        let pgid = 0
        let cmd = ''
        try {
          const ps = execSync(`ps -o pgid=,command= -p ${pid}`, { encoding: 'utf-8' }).trim()
          const m = ps.match(/^\s*(\d+)\s+(.*)$/)
          pgid = Number(m?.[1] ?? 0)
          cmd = m?.[2] ?? ''
        } catch {
          continue
        }
        if (!pgid || managed.has(pgid)) continue
        if (/(node|next|vite|tsx|bun|deno|python|uvicorn|flask|docker|npm|yarn|pnpm)/i.test(cmd)) {
          found.push({ pid, pgid })
        }
      }
    }
    return found
  } catch {
    return []
  }
}

/** 常见启动命令 → 依赖检查目标与安装指引（启动前预检，缺运行时直接人话提示，不用等进程报错） */
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

/** 命令是不是 vite 启动：字面含 vite 直接认；npm run X / yarn X / pnpm run X 包装的读
 *  cwd/package.json 的 scripts[X] 判定（读不到就按不是 vite 处理，宁可不加参数也别乱加） */
function isViteCommand(command: string, cwd: string): boolean {
  if (/\bvite\b/.test(command)) return true
  const m = command.match(/^(?:npm run|pnpm run|yarn)\s+(\S+)/)
  if (!m) return false
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    return /\bvite\b/.test(String(pkg.scripts?.[m[1]] ?? ''))
  } catch {
    return false
  }
}

/** 挑一个当前空闲的 TCP 端口（一次 lsof 拿全量占用）。
 *  从 5174 开始扫：跳过 5173（vite 默认）、3000/8080（Mineradio 等写死端口的 app 常驻地址）
 *  ——写死端口的 app 没跑时这些端口是空闲的，从它们开始挑必撞。
 *  给「档案没配端口」的 vite 项目兜底 */
function pickFreePortSync(): number | undefined {
  const used = new Set<number>()
  try {
    const out = execSync('lsof -nP -iTCP -sTCP:LISTEN -F n', { encoding: 'utf8', timeout: 5000 })
    for (const line of out.split('\n')) {
      const m = line.match(/n\*:(\d+)/)
      if (m) used.add(Number(m[1]))
    }
  } catch {
    // 查不到占用列表就不过滤（仍给固定区间）
  }
  for (let p = 5174; p < 5174 + 100; p++) {
    if (!used.has(p)) return p
  }
  return undefined
}

/** 起子进程（dev/python/docker 共用）：日志管道 + 退出处理 + 端口健康检查（无端口则存活即运行） */
function spawnAndWatch(
  project: Project,
  rt: Runtime,
  command: string,
  cwd: string,
  port: number | undefined,
  missingHint?: string,
  isRetry?: boolean
): StartResult {
  // 依赖预检（"是不是要装 npm/node/python"）：spawn 之前先查运行时，缺了直接人话提示+安装指引
  const depHint = missingDependencyHint(command)
  if (depHint) {
    fail(rt, project, depHint)
    return { ok: false, reason: depHint }
  }
  setStatus(rt, project, 'starting')
  // vite 不认 PORT/HOST 环境变量，只认 CLI 参数（vite 默认只绑 localhost，
  // 对外要 --host；默认端口 5173 会与开发环境撞车/与档案端口不符，要 --port）。
  // 启动命令适配：vite 命令按需追加参数；npm/yarn/pnpm 包装的命令用 -- 透传。
  // 包装命令（npm run dev）的字面不含 vite——穿透读 package.json scripts 判定
  const isVite = isViteCommand(command, cwd)
  const wrapped = /^(npm run \S+|yarn \S+|pnpm run \S+)\b/.test(command)
  // vite 项目档案没配端口：自动挑一个当前空闲的端口（默认 5173 人人都抢，必撞）
  const effectivePort = isVite && !port ? pickFreePortSync() : port
  if (effectivePort && !port) {
    emitLog(project.id, `档案没配端口，自动挑了一个空闲端口 ${effectivePort}`)
  }
  let finalCommand = command
  if (isVite) {
    const flags = [
      getSettings().lanAccess ? '--host' : '',
      effectivePort ? `--port ${effectivePort}` : ''
    ]
      .filter(Boolean)
      .join(' ')
    if (flags) finalCommand = `${command}${wrapped ? ' -- ' : ' '}${flags}`
  }
  const child = spawn(finalCommand, {
    cwd,
    shell: true,
    detached: true, // 独立进程组：停止时整树终止
    env: {
      ...process.env,
      PATH: buildPath(),
      // 表单端口真正生效：注入 PORT，Next.js 等认这个变量的框架就真绑表单端口；
      // vite 等不认的框架忽略（已用 --port 参数接管），无害
      ...(effectivePort ? { PORT: String(effectivePort) } : {})
    }
  })
  rt.child = child
  rt.port = effectivePort

  child.stdout?.on('data', (d: Buffer) => pipeLog(project.id, d.toString()))
  child.stderr?.on('data', (d: Buffer) => pipeLog(project.id, d.toString()))

  child.on('error', (err) => {
    // 命令不存在（python3/docker 没装）→ 用大白话提示（跨平台失败翻译）
    const code = (err as NodeJS.ErrnoException).code
    const enoent = code === 'ENOENT'
    // 直接执行无权限的可执行文件（罕见，一般走 exit 分支的 npm 路径）
    if (
      code === 'EACCES' &&
      tryFixAndRetry(project, rt, command, cwd, effectivePort, missingHint, isRetry)
    ) {
      return
    }
    fail(rt, project, enoent && missingHint ? missingHint : `启动进程失败：${err.message}`)
  })
  child.on('exit', (code, signal) => {
    if (rt.healthTimer) clearInterval(rt.healthTimer)
    rt.child = undefined
    if (rt.status === 'starting') {
      // 权限病自动修复：日志出现 Permission denied → 补执行位自动重试一次
      if (
        hasPermissionDenied(project.id) &&
        tryFixAndRetry(project, rt, command, cwd, effectivePort, missingHint, isRetry)
      ) {
        return
      }
      // 跨平台依赖病静默自愈（"静默直接做好"）：自动重装依赖+重启
      if (
        hasCrossPlatformDeps(project.id) &&
        tryReinstallAndRetry(project, rt, command, cwd, effectivePort, missingHint, isRetry)
      ) {
        return
      }
      // 健康检查没过就退了 = 启动失败（不重试，PRD 3.4）
      failWithLogHint(rt, project, `进程提前退出（退出码 ${code ?? signal}）`)
    } else if (rt.status === 'running') {
      setStatus(rt, project, 'stopped')
    }
  })

  if (effectivePort) {
    // 端口健康检查：轮询直到就绪或超时
    rt.healthStart = Date.now()
    rt.healthTimer = setInterval(() => {
      const checkPort = rt.port ?? effectivePort
      checkPortOpen(checkPort).then((open) => {
        if (rt.status !== 'starting') return
        if (open) {
          // 项目日志打了另一个端口（框架端口被占自动漂移，open 撞车破案）：
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
          probeAndEmitLan(rt, project, checkPort)
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
                  probeAndEmitLan(rt, project, d)
                }
              })
            }
          }, 3000)
          if (project.openBrowser && !rt.noOpenBrowser) {
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
            // 进程可能还活着：启动被判失败也不能留僵尸占端口（SCADA 事故：误判后僵尸越点越多）
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

/** python-static 方式：真实跑 python3 -m http.server（静态根=成品目录），内置预览的替代 */
async function startPythonStatic(
  project: Project,
  rt: Runtime,
  mode: LaunchMode
): Promise<StartResult> {
  // 老数据（前登记）python-static 没存 staticRoot：兜底到 preview 方式的静态根（同一份成品），而不是项目根源码目录
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
      probeAndEmitLan(rt, project, port)
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

/** docker 方式：docker compose up，无端口则进程存活即运行 */
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
  // 端口稳定（网站常驻）：没指定端口时沿用上次实际端口（重启后地址不变）
  let wantPort = modePort ?? project.lastPort
  if (wantPort && (await checkPortOpen(wantPort))) {
    // 端口被占：先探测是不是一个已经跑着的网站（用户手动起在 7100 的成品站等）——是则直接接管，不再另起炉灶（实测）
    if (await probeWebPort(wantPort)) {
      rt.port = wantPort
      setStatus(rt, project, 'running', wantPort)
      touchStartedAt(project.id)
      touchLastPort(project.id, wantPort)
      emitLog(project.id, `端口 ${wantPort} 已有网站在运行，直接接管`)
      probeAndEmitLan(rt, project, wantPort)
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
    probeAndEmitLan(rt, project, port)
    if (project.openBrowser && !rt.noOpenBrowser) {
      // SPA 路由只认根路径：/index.html 归一为 /（登记即上线自动打开与右键打开同一规则，
      // 带 index.html 打开会白屏——用户「删掉 index 才能看」就是这条路的漏网）
      openUrl(`http://localhost:${port}${servedEntry === '/index.html' ? '/' : servedEntry}`)
    }
    return { ok: true }
  } catch (err) {
    fail(rt, project, `临时服务启动失败：${err instanceof Error ? err.message : String(err)}`)
    return { ok: false }
  }
}

/** 接管显示：端口有服务在响应 → 标记运行中（不启动任何东西）。
 *  幂等重复 emit（修复）：渲染层加载完成后调用一次兜底——若之前的 emit 因时序竞争丢失
 *  （StrictMode 双跑/订阅未就绪），rt 已 running 也重新推一次状态，界面才能从灰色恢复绿点 */
export async function adoptRunning(project: Project): Promise<void> {
  if (project.type === 'group') return // 组没有端口，跳过（项目组）
  const rt = getRuntime(project.id)
  if (rt.status === 'starting') return // 自己正在启动中（健康检查在跑），不插手
  // 端口优先用登记值，其次上次实际运行端口（web 自动分配/端口写错时也能找回）
  const port = project.port ?? project.lastPort
  if (!port) return
  if (await checkPortOpen(port)) {
    rt.port = port
    setStatus(rt, project, 'running', port)
    probeAndEmitLan(rt, project, port)
  }
}

/** 打开应用时对全部项目做一次接管检测（重启 Reopen 后状态不丢） */
export async function adoptAllRunning(): Promise<void> {
  for (const project of listProjects()) {
    await adoptRunning(project)
  }
}

/** 打开 Reopen 时自动拉起自启项（PRD 3.5：软件层自动启动；失败静默，界面上标红可见）
 *  组在自启里 = 只拉组内成品子项（web 类型），开发子项保留手动启动 */
export async function autoStartAll(): Promise<void> {
  const { autoStartEnabled, autoStartIds } = getSettings()
  if (!autoStartEnabled || autoStartIds.length === 0) return
  const projects = listProjects()
  for (const id of autoStartIds) {
    const project = projects.find((p) => p.id === id)
    if (!project) continue
    try {
      if (project.type === 'group') {
        // 组自启只拉成品（有「成品预览」方式的子项按 preview 启动；
        // 老数据（无 launchModes）按 type=web 兼容
        for (const child of projects.filter((p) => {
          if (p.parentId !== id) return false
          return (
            (p.launchModes ?? []).some((m) => m.kind === 'preview') ||
            (p.launchModes === undefined && p.type === 'web')
          )
        })) {
          await startProject(child.id, 'preview', { noOpenBrowser: true })
        }
      } else {
        await startProject(id, undefined, { noOpenBrowser: true })
      }
    } catch {
      // 单个项目失败不影响其他
    }
  }
}

/** 一键安装依赖（失败提示区的"帮我装依赖"按钮）：
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

/** 打开链接：用户设了默认浏览器 → open -a 指定浏览器；否则系统默认（"偏好设置里选浏览器"） */
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
 *  entry=入口文件相对路径（多入口列表点哪个开哪个）
 *  纯网页（登记即在线）：没运行/启动中 → 自动拉起等就绪再开（用户实测"打开是空的"） */
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
    // /index.html 归一为 /（Vite 单页应用的路由只认 /，
    // 带 /index.html 打开显示不对；静态多页项目的主页同理）
    const target = entry ?? rt.entryPath ?? '/'
    openUrl(`http://localhost:${rt.port}${target === '/index.html' ? '/' : target}`)
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

/** 「终止残留并启动」：杀掉启动前检测到的同目录残留进程组，稍等后重新启动项目 */
export async function killResidualAndStart(id: string): Promise<StartResult> {
  const rt = getRuntime(id)
  const groups = rt.residualPids ?? []
  rt.residualPids = undefined
  for (const pgid of groups) {
    try {
      process.kill(-pgid, 'SIGTERM')
    } catch {
      try {
        process.kill(pgid, 'SIGTERM')
      } catch {
        // 已退出
      }
    }
  }
  await new Promise((r) => setTimeout(r, 1500))
  for (const pgid of groups) {
    try {
      process.kill(-pgid, 'SIGKILL')
    } catch {
      // 已退出
    }
  }
  const project = listProjects().find((p) => p.id === id)
  if (project) emitLog(id, `已终止 ${groups.length} 个残留进程，重新启动`)
  return startProject(id)
}

/** 退出应用时停掉所有正在运行的项目（⌘Q 确认后调用——不留下孤儿进程占端口） */
export function stopAllRuntimes(): void {
  for (const id of [...runtimes.keys()]) {
    void stopProject(id).catch(() => undefined)
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
