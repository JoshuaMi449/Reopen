// 失败诊断引擎（纯函数）
//
// 输入一段日志 + 少量上下文，输出一条诊断：人话 + 定位 + 归属 + 可选动作。
// 设计约束：纯计算，不碰 fs / 网络 / Electron —— 这样能被 tests/diagnose.cjs 直接断言。
//
// 规则从 projectManager.ts 的 failWithLogHint 原样搬迁（顺序敏感、文案逐字保留）。
// 每条规则自带正则字面量：flag（m / s）跟着规则走，集中管理容易静默丢 flag。

import type { Culprit, ProjectFix } from '../shared/types'

export interface Diagnosis {
  /** 规则标识，写进 diagnosis.log 便于事后排查 */
  code: string
  /** 一句人话：进系统通知、列表 tooltip */
  title: string
  /** 定位到的具体对象（命令名 / 包名 / 端口之类），只进详情抽屉 */
  located?: string
  culprit: Culprit
  confidence: 'high' | 'low'
  /** 可执行的动作；缺省 = Reopen 帮不上忙 */
  fix?: ProjectFix
  /** Reopen 帮不上时的做法说明；有则界面出提示框而不是按钮 */
  guide?: string
}

export interface DiagnoseContext {
  /** 本次启动尝试的日志（调用方负责只传本尝试部分，别把上次失败的报错带进来） */
  logText: string
  /** 所有规则都没命中时的兜底文案 */
  fallback: string
  /** 上一次尝试已经自动补救过：用于降置信度，避免"已经修过了还说没修" */
  isRetry?: boolean
  /** 本次尝试存活了多久（毫秒）。只用于兜底时补一句方向感，不参与规则匹配 */
  durationMs?: number
}

/** 规则命中后要给出的内容 */
interface Hit {
  title: string
  located?: string
  fix?: ProjectFix
  guide?: string
}

interface Rule {
  code: string
  culprit: Culprit
  match: (text: string) => Hit | null
}

const NPM_INSTALL_FIX: ProjectFix = { kind: 'npm-install', label: '帮我装依赖' }

/** 按顺序匹配，命中即返回 —— 顺序即优先级，加规则请插到对应位置而不是重排 */
const RULES: Rule[] = [
  // macOS 隐私保护（TCC）：项目放在「下载 / 桌面 / 文稿」时，子进程连 getcwd 都可能被拒
  // ⚠️ 这条绝不能给 fix（一键装依赖）：在被挡住的目录里重跑 npm install 只会再次 EPERM，用户陷入死循环。
  //    必须排在原生模块那条之前 —— Downloads 下的 .node 缺失往往是 TCC 的下游症状，不是独立的编译问题。
  {
    code: 'macos-tcc-blocked',
    culprit: 'user-env',
    match: (text) => {
      const hit =
        /EPERM: process\.cwd failed/i.test(text) ||
        /getcwd: cannot access parent directories: Operation not permitted/i.test(text)
      if (!hit) return null
      return {
        title: 'macOS 挡住了这个项目所在的文件夹，程序连"自己在哪个目录"都读不到',
        located: '项目疑似放在「下载 / 桌面 / 文稿」里',
        guide:
          '把项目文件夹挪到这几个位置以外（比如在用户目录下新建一个 projects 放进去），或者打开「系统设置 → 隐私与安全性 → 文件与文件夹」给 Reopen 授权；改完点「启动」重试。这个毛病重装依赖治不好。'
      }
    }
  },
  // 端口被占（能从报错里抠出端口号）
  {
    code: 'port-busy-numbered',
    culprit: 'user-env',
    match: (text) => {
      const m = /EADDRINUSE[\s\S]*?port:\s*(\d+)/.exec(text)
      if (!m) return null
      return {
        title: `端口 ${m[1]} 已被占用——是不是这个项目之前已经手动启动了？先停掉旧的再启动`,
        located: `端口 ${m[1]}`
      }
    }
  },
  // 端口被占（Mac 版 Errno 48 / 抠不出端口号）
  {
    code: 'port-busy',
    culprit: 'user-env',
    match: (text) =>
      /EADDRINUSE|Errno 48|Address already in use/i.test(text)
        ? { title: '端口已被占用——是不是这个项目之前已经手动启动了？先停掉旧的再启动' }
        : null
  },
  // 跨平台拷贝的依赖（四个特征合为一条：拆开会改变命中顺序）
  // /22 实测：Windows 项目整个拷到 Mac——二进制不兼容 / 缺 Mac 平台组件 / 权限自动修复后仍有权限问题
  {
    code: 'cross-platform-deps',
    culprit: 'user-env',
    match: (text) => {
      const hit =
        /Permission denied/.test(text) ||
        /bad cpu type|exec format error|wrong architecture|not compatible/i.test(text) ||
        /Cannot find module @rollup\/rollup-darwin|npm has a bug related to optional dependencies/i.test(
          text
        ) ||
        // 原生模块是 Windows 二进制（my-app 实测：better-sqlite3 从 Windows 拷来，Mac 加载不了）
        /ERR_DLOPEN_FAILED|not valid mach-o file|is not a valid Win32 application/i.test(text)
      if (!hit) return null
      return {
        title:
          '这个项目的依赖没装好（从 Windows 电脑拷贝过来的常见问题）——删掉项目里的 node_modules 和 package-lock.json 重新安装。下面有「帮我装依赖」按钮，点一下就行',
        fix: NPM_INSTALL_FIX
      }
    }
  },
  // 原生模块没编译（better-sqlite3 实测：Node 版本变过，node_modules 里还是旧版本编译出来的 .node）
  // 排在 TCC 之后：Downloads 下的同类报错多半是权限的下游症状，不该让用户去点注定失败的重装
  {
    code: 'native-binding-missing',
    culprit: 'user-env',
    match: (text) => {
      const m = /Could not locate the bindings file[\s\S]*?([\w.-]+)\/build\//.exec(text)
      if (!m) return null
      return {
        title:
          '这个项目的原生模块没编译好（多半是 Node 版本变过，node_modules 里还是旧版本编出来的）',
        located: `模块 ${m[1]}`,
        fix: NPM_INSTALL_FIX
      }
    }
  },
  // 依赖根本没装 / 启动命令不存在（SCADA 实测：删了 node_modules 没重装 → vite: command not found）
  {
    code: 'command-not-found',
    culprit: 'user-env',
    match: (text) => {
      // 带 m flag：`^sh: .*: not found` 要按行首匹配 —— 不能改成集中式 test()，会丢 flag
      const m =
        /command not found|not recognized as an internal or external command|^sh: .*: not found/m.exec(
          text
        )
      if (!m) return null
      const name =
        /^sh: (\S+): not found/m.exec(text)?.[1] ??
        /(\S+): command not found/.exec(text)?.[1] ??
        /'([^']+)' is not recognized/.exec(text)?.[1]
      return {
        title: '这个项目的依赖没装好——点下面的「帮我装依赖」按钮自动安装，装完再点启动',
        located: name ? `缺少命令 ${name}` : undefined,
        fix: NPM_INSTALL_FIX
      }
    }
  },
  {
    code: 'missing-script',
    culprit: 'project',
    match: (text) =>
      /npm ERR! Missing script/.test(text)
        ? {
            title:
              '这个项目的 package.json 里没有对应的启动脚本——右键项目选「编辑」，检查启动命令对不对'
          }
        : null
  },
  {
    code: 'docker-daemon-down',
    culprit: 'user-env',
    match: (text) =>
      /Cannot connect to the Docker daemon|Is the docker daemon running/i.test(text)
        ? { title: 'Docker 没开——先打开 Docker Desktop，等它启动完成再点启动' }
        : null
  },
  {
    code: 'python-module-missing',
    culprit: 'user-env',
    match: (text) => {
      const m = /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/.exec(text)
      if (!m) return null
      return {
        title: `这个 Python 项目缺一个包「${m[1]}」——在项目文件夹的终端里跑 pip install ${m[1]} 装上再启动`,
        located: `缺少 Python 包 ${m[1]}`
      }
    }
  },
  {
    code: 'peer-dep-conflict',
    culprit: 'project',
    match: (text) =>
      /ERESOLVE|Could not resolve dependency|peer dep/i.test(text)
        ? { title: '依赖版本打架——在项目文件夹的终端里跑 npm install --legacy-peer-deps 再试' }
        : null
  },
  {
    code: 'network',
    culprit: 'user-env',
    match: (text) =>
      /ETIMEDOUT|ECONNRESET|getaddrinfo ENOTFOUND|network request failed/i.test(text)
        ? { title: '网络问题——下载依赖连不上软件源，检查网络或代理，或换个 npm 源再试' }
        : null
  },
  {
    code: 'env-missing',
    culprit: 'project',
    match: (text) =>
      /Missing environment variable|process\.env|\.env file/i.test(text)
        ? { title: '这个项目缺配置（密钥之类的 .env 文件）——看看项目说明文档，把配置补上再启动' }
        : null
  },
  {
    code: 'database-down',
    culprit: 'external',
    match: (text) => {
      // 带 s flag：跨行找 ECONNREFUSED 与端口号的组合 —— 同样不能丢
      const m = /ECONNREFUSED.*(5432|3306|27017|6379|5433)|connect ECONNREFUSED/s.exec(text)
      if (!m) return null
      // 端口单独抠：交替式里 `connect ECONNREFUSED` 那一支没有捕获组，m[1] 未必有值
      const port = /ECONNREFUSED[^\n]*?(5432|3306|27017|6379|5433)/.exec(text)?.[1]
      return {
        title: '数据库没启动——先把这个项目用的数据库服务跑起来（或检查数据库地址）',
        located: port ? `数据库端口 ${port}` : undefined
      }
    }
  },
  {
    code: 'disk-full',
    culprit: 'user-env',
    match: (text) =>
      /ENOSPC|no space left on device/i.test(text)
        ? { title: '磁盘满了——清理磁盘空间后再启动' }
        : null
  }
]

/** 规则按顺序匹配，命中即返回；都没命中给兜底（归属未知 + 低置信） */
export function diagnose(ctx: DiagnoseContext): Diagnosis {
  for (const rule of RULES) {
    const hit = rule.match(ctx.logText)
    if (hit) {
      return {
        code: rule.code,
        title: hit.title,
        located: hit.located,
        culprit: rule.culprit,
        confidence: ctx.isRetry ? 'low' : 'high',
        fix: hit.fix,
        guide: hit.guide
      }
    }
  }
  return {
    code: 'unknown',
    title: ctx.fallback + quickExitHint(ctx.durationMs),
    culprit: 'unknown',
    confidence: 'low'
  }
}

/** 兜底时补一句方向感。存活时长只做提示、不当判据：
 *  shell:true 下测到的是 shell 退出，中间还夹着 200~2000ms 的固定开销，分桶只能放宽。 */
function quickExitHint(ms: number | undefined): string {
  if (ms === undefined) return ''
  const s = (ms / 1000).toFixed(1)
  if (ms < 800) return `（启动后 ${s} 秒就退了——这么快通常是环境问题，不是项目代码的问题）`
  if (ms < 8000) return `（启动后 ${s} 秒就退了——多半是依赖或端口的问题）`
  return `（启动后 ${s} 秒才退出）`
}
