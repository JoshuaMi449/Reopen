const assert = require('node:assert/strict')
const fs = require('node:fs')

const source = fs.readFileSync('src/renderer/src/App.tsx', 'utf8')
const handlerStart = source.indexOf('const handleItemContextMenu')
const handlerEnd = source.indexOf('/** 批量：', handlerStart)
const handler = source.slice(handlerStart, handlerEnd)
assert(handlerStart >= 0 && handlerEnd > handlerStart)
assert(!handler.includes('setSelectedId('), 'right-click must not open or replace the log drawer')

const menuStart = source.indexOf('const menuItems =')
const menuEnd = source.indexOf('const handleRelocate', menuStart)
const menu = source.slice(menuStart, menuEnd)
for (const label of ['在浏览器打开', '编辑', '重新定位…', '访问项目原目录', '删除'])
  assert(menu.includes(`label: '${label}'`), `missing project context action: ${label}`)
assert(!menu.includes("label: '启动'"), 'single-project context menu must not contain Start')
assert(!menu.includes("label: '停止'"), 'single-project context menu must not contain Stop')

console.log('PASS: right-click keeps the log drawer closed and exposes only project-management actions')
