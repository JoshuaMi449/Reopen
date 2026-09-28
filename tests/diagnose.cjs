// 诊断引擎单测：黄金文本
//
// 存在的意义：把 projectManager.ts 里 failWithLogHint 的 12 条文案逐字抄成期望值。
// 规则搬迁进 diagnose.ts 之后，这份测试是唯一能证明「行为没变」的东西 —— 全绿才算搬对了。
// 样本全部内联（不读 ~/Library，不可移植），后续加规则时把线上真实日志摘一段贴进来即可。
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript')

const context = { exports: {} }
vm.createContext(context)
vm.runInContext(
  ts.transpileModule(fs.readFileSync('src/main/diagnose.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  context
)
const { diagnose } = context.exports

const FALLBACK = '进程提前退出（退出码 1）'
const run = (log, extra) => diagnose({ logText: log, fallback: FALLBACK, ...extra })

const CASES = [
  {
    name: '端口被占（能抠出端口号）',
    code: 'port-busy-numbered',
    culprit: 'user-env',
    title: '端口 3000 已被占用——是不是这个项目之前已经手动启动了？先停掉旧的再启动',
    log: `Error: listen EADDRINUSE: address already in use :::3000
    at Server.setupListenHandle [as _listen2] (node:net:1904:16)
  errno: -48,
  code: 'EADDRINUSE',
  syscall: 'listen',
  address: '::',
  port: 3000`
  },
  {
    name: '端口被占（抠不出端口号走通用文案）',
    code: 'port-busy',
    culprit: 'user-env',
    title: '端口已被占用——是不是这个项目之前已经手动启动了？先停掉旧的再启动',
    log: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:5173'
  },
  {
    name: '跨平台拷贝依赖（rollup 可选依赖特征）',
    code: 'cross-platform-deps',
    culprit: 'user-env',
    fix: 'npm-install',
    title:
      '这个项目的依赖没装好（从 Windows 电脑拷贝过来的常见问题）——删掉项目里的 node_modules 和 package-lock.json 重新安装。下面有「帮我装依赖」按钮，点一下就行',
    log: `Error: Cannot find module @rollup/rollup-darwin-arm64
Require stack:
- /Users/x/app/node_modules/vite/dist/node/index.js`
  },
  {
    name: '跨平台拷贝依赖（原生模块是 Windows 二进制）',
    code: 'cross-platform-deps',
    culprit: 'user-env',
    fix: 'npm-install',
    title:
      '这个项目的依赖没装好（从 Windows 电脑拷贝过来的常见问题）——删掉项目里的 node_modules 和 package-lock.json 重新安装。下面有「帮我装依赖」按钮，点一下就行',
    log: `Error: dlopen(/Users/x/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node, 0x0001): tried: '/Users/x/...' (not a mach-o file)
  code: 'ERR_DLOPEN_FAILED'`
  },
  {
    name: '命令不存在（sh: xxx: not found，验证 m flag 没丢）',
    code: 'command-not-found',
    culprit: 'user-env',
    fix: 'npm-install',
    located: '缺少命令 vite',
    title: '这个项目的依赖没装好——点下面的「帮我装依赖」按钮自动安装，装完再点启动',
    log: `> app@1.0.0 dev
> vite

sh: vite: not found`
  },
  {
    name: 'package.json 缺启动脚本',
    code: 'missing-script',
    culprit: 'project',
    title: '这个项目的 package.json 里没有对应的启动脚本——右键项目选「编辑」，检查启动命令对不对',
    log: 'npm ERR! Missing script: "dev"'
  },
  {
    name: 'Docker 没启动',
    code: 'docker-daemon-down',
    culprit: 'user-env',
    title: 'Docker 没开——先打开 Docker Desktop，等它启动完成再点启动',
    log: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'
  },
  {
    name: 'Python 缺包（带包名定位）',
    code: 'python-module-missing',
    culprit: 'user-env',
    located: '缺少 Python 包 flask',
    title: '这个 Python 项目缺一个包「flask」——在项目文件夹的终端里跑 pip install flask 装上再启动',
    log: `Traceback (most recent call last):
  File "app.py", line 3, in <module>
    from flask import Flask
ModuleNotFoundError: No module named 'flask'`
  },
  {
    name: '依赖版本打架',
    code: 'peer-dep-conflict',
    culprit: 'project',
    title: '依赖版本打架——在项目文件夹的终端里跑 npm install --legacy-peer-deps 再试',
    log: `npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree`
  },
  {
    name: '网络问题',
    code: 'network',
    culprit: 'user-env',
    title: '网络问题——下载依赖连不上软件源，检查网络或代理，或换个 npm 源再试',
    log: `npm ERR! code ETIMEDOUT
npm ERR! network request to https://registry.npmjs.org/vite failed`
  },
  {
    name: '缺 .env 配置',
    code: 'env-missing',
    culprit: 'project',
    title: '这个项目缺配置（密钥之类的 .env 文件）——看看项目说明文档，把配置补上再启动',
    log: 'Error: Missing environment variable: DATABASE_URL'
  },
  {
    name: '数据库没启动（验证 s flag 没丢，带端口定位）',
    code: 'database-down',
    culprit: 'external',
    located: '数据库端口 5432',
    title: '数据库没启动——先把这个项目用的数据库服务跑起来（或检查数据库地址）',
    log: `Error: connect ECONNREFUSED 127.0.0.1:5432
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)`
  },
  {
    name: '磁盘满',
    code: 'disk-full',
    culprit: 'user-env',
    title: '磁盘满了——清理磁盘空间后再启动',
    log: 'Error: ENOSPC: no space left on device, write'
  },
  {
    // 真实样本：本机 service-logs/2b4bf33e（项目在 ~/Downloads 里）
    name: 'macOS TCC 挡住项目目录',
    code: 'macos-tcc-blocked',
    culprit: 'user-env',
    guide: true,
    noFix: true, // 这条绝不能给「帮我装依赖」——在被挡住的目录里重装只会再次失败
    title: 'macOS 挡住了这个项目所在的文件夹，程序连"自己在哪个目录"都读不到',
    located: '项目疑似放在「下载 / 桌面 / 文稿」里',
    log: `shell-init: error retrieving current directory: getcwd: cannot access parent directories: Operation not permitted
Error: EPERM: process.cwd failed with error operation not permitted, uv_cwd
    at process.wrappedCwd (node:internal/bootstrap/switches/does_own_process_state:142:28)
    at process.cwd (/usr/local/lib/node_modules/npm/node_modules/graceful-fs/polyfills.js:10:19)`
  },
  {
    // 真实样本：本机 service-logs/444bce7e（better-sqlite3，报错 19471 行）
    name: '原生模块没编译',
    code: 'native-binding-missing',
    culprit: 'user-env',
    fix: 'npm-install',
    located: '模块 better-sqlite3',
    title: '这个项目的原生模块没编译好（多半是 Node 版本变过，node_modules 里还是旧版本编出来的）',
    log: ` ⨯ Error: Could not locate the bindings file. Tried:
 → /Users/x/my-app/node_modules/better-sqlite3/build/better_sqlite3.node
 → /Users/x/my-app/node_modules/better-sqlite3/build/Debug/better_sqlite3.node
 → /Users/x/my-app/node_modules/better-sqlite3/lib/binding/node-v137-darwin-arm64/better_sqlite3.node
    at bindings (/Users/x/my-app/node_modules/bindings/bindings.js:126:9)`
  },
  {
    name: '兜底：认不出来的错误',
    code: 'unknown',
    culprit: 'unknown',
    title: FALLBACK,
    log: `Error: something weird happened
    at foo (bar.js:1:1)`
  }
]

for (const c of CASES) {
  const d = run(c.log)
  assert.equal(d.code, c.code, `[${c.name}] code 不符\n  期望 ${c.code}\n  实际 ${d.code}`)
  assert.equal(d.title, c.title, `[${c.name}] 文案被改动了（黄金文本）\n  期望 ${c.title}\n  实际 ${d.title}`)
  assert.equal(d.culprit, c.culprit, `[${c.name}] culprit 不符\n  期望 ${c.culprit}\n  实际 ${d.culprit}`)
  assert.equal(d.fix ? d.fix.kind : undefined, c.fix, `[${c.name}] fix 不符`)
  if (c.located) assert.equal(d.located, c.located, `[${c.name}] located 不符`)
  if (c.guide) assert.ok(d.guide && d.guide.length > 10, `[${c.name}] 应给出做法说明（guide）`)
  if (c.noFix) assert.equal(d.fix, undefined, `[${c.name}] 这条绝不能给一键修复按钮`)
}

const byCode = (code) => CASES.find((c) => c.code === code)

// 兜底必须是低置信，命中规则默认高置信
assert.equal(run(byCode('unknown').log).confidence, 'low', '兜底应为低置信')
assert.equal(run(byCode('port-busy-numbered').log).confidence, 'high', '命中规则应为高置信')

// isRetry：上一次已经自动补救过 → 降置信（文案暂时不变，供后续按 isRetry 分叉用）
assert.equal(run(byCode('port-busy-numbered').log, { isRetry: true }).confidence, 'low', 'isRetry 应降为低置信')

// 顺序安全性：同时含 TCC 与原生模块特征时必须判成 TCC —— 判错就会给用户一个注定失败的重装按钮
const both = run(byCode('macos-tcc-blocked').log + '\n' + byCode('native-binding-missing').log)
assert.equal(both.code, 'macos-tcc-blocked', 'TCC 必须排在原生模块之前')
assert.equal(both.fix, undefined, 'TCC 判定下不能出现一键修复按钮')

// 存活时长：只给兜底补方向感；命中具体规则时不掺进文案
const fallback = byCode('unknown')
assert.equal(
  run(fallback.log, { durationMs: 300 }).title,
  fallback.title + '（启动后 0.3 秒就退了——这么快通常是环境问题，不是项目代码的问题）',
  '秒退应补"环境问题"方向提示'
)
assert.equal(
  run(fallback.log, { durationMs: 30000 }).title,
  fallback.title + '（启动后 30.0 秒才退出）',
  '长时退出应报出实际时长'
)
assert.equal(
  run(byCode('port-busy-numbered').log, { durationMs: 300 }).title,
  byCode('port-busy-numbered').title,
  '命中规则时时长不掺进文案'
)

console.log(`PASS: 诊断引擎 ${CASES.length} 条黄金文本 + 置信度 + 顺序安全 + 时长提示全部一致`)
