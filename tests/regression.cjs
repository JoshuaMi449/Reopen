/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Node regression harness loads transpiled CommonJS with isolated dependencies. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const cp = require('node:child_process')
const ts = require('typescript')

function load(file, mocks) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInNewContext(
    code,
    {
      exports,
      require: (name) => mocks[name] ?? require(name),
      process,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Buffer
    },
    { filename: file }
  )
  return exports
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-regression-'))
  const types = load('src/shared/types.ts', {})
  const base = { path: temp, openBrowser: true, tags: [], note: '', createdAt: 0 }
  const preview = { id: 'preview', kind: 'preview' }
  const mixed = {
    ...base,
    id: 'mixed',
    type: 'web',
    launchModes: [preview, { id: 'dev', kind: 'dev' }],
    activeMode: 'preview'
  }
  const web = { ...base, id: 'web', type: 'web', launchModes: [preview] }
  const service = {
    ...base,
    id: 'service',
    name: 'fixture',
    type: 'service',
    command: 'npm run dev'
  }
  const group = { ...base, id: 'group', type: 'group' }
  assert.equal(types.projectCategory(mixed), 'service')
  assert.equal(types.projectCategory(web), 'web')
  assert.equal(types.projectCategory(group), 'group')
  assert.equal(types.projectCategory({ ...mixed, parentId: 'group' }), 'service')

  fs.writeFileSync(
    path.join(temp, 'package.json'),
    JSON.stringify({ name: 'log-fixture', version: '2.0.0', scripts: { dev: 'node server.js' } })
  )
  fs.writeFileSync(
    path.join(temp, 'server.js'),
    'process.stdout.write("startup line\\n"); process.stderr.write("error line\\n"); process.stdout.write("final without newline");'
  )
  const settings = {
    autoStartEnabled: true,
    autoStartIds: ['service'],
    lanAccess: false,
    gatewayEnabled: false
  }
  let projects = [mixed, web, service, group]
  const staticStarts = []
  const opened = []
  const noop = () => {}
  const manager = load('src/main/projectManager.ts', {
    electron: {
      app: { getAppPath: () => process.cwd(), getPath: () => temp },
      BrowserWindow: { getAllWindows: () => [] },
      shell: { openExternal: (url) => opened.push(url) },
      Notification: { isSupported: () => false }
    },
    child_process: {
      ...cp,
      execSync: (cmd, opts) => (cmd.startsWith('lsof ') ? '' : cp.execSync(cmd, opts))
    },
    '../shared/types': types,
    './store': {
      getSettings: () => settings,
      listProjects: () => projects,
      touchStartedAt: noop,
      touchLastPort: noop
    },
    './processLogs': load('src/main/processLogs.ts', {}),
    './lan': {},
    './detect': {},
    './gateway': { unregisterRoute: noop },
    './mountProbe': { unregisterTarget: noop },
    './webServer': {
      startWebServer: async () => {
        staticStarts.push(true)
        return { server: { close: noop }, port: 43219, entryPath: '/' }
      }
    }
  })
  try {
    // No renderer exists while the autostart npm process writes its launch banner.
    await manager.autoStartAll()
    for (let i = 0; i < 80 && manager.isProjectRunning(service.id); i++)
      await new Promise((r) => setTimeout(r, 50))
    const lines = manager
      .getLogHistory()
      .filter((e) => e.id === service.id)
      .map((e) => e.line)
    assert(lines.some((line) => line.includes('log-fixture@2.0.0 dev')))
    assert(lines.includes('startup line'))
    assert(lines.includes('error line'))
    assert(lines.includes('final without newline'))
    assert.equal(staticStarts.length, 1, 'pure websites must be hosted without joining service autostart')
    assert.equal(opened.length, 0, 'background startup must not open browser windows')
    assert.equal(manager.isProjectRunning(mixed.id), false)
    const events = manager.getLogHistory()
    assert.equal(new Set(events.map((e) => e.sequence)).size, events.length)
    const restarted = await manager.restartProject(web.id)
    assert.equal(restarted.ok, true)
    assert.equal(staticStarts.length, 2)
    assert.equal(opened.length, 1, 'manual restart follows browser preference')
    console.log(
      'PASS: capability classification, ungrouped classification, explicit autostart, no background browser, early npm logs, stderr, final partial line, ordered history, restart'
    )
  } finally {
    await manager.stopProject(web.id)
    await manager.stopProject(service.id)
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
