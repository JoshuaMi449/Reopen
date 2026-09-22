const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const cp = require('node:child_process'), assert = require('node:assert/strict'), ts = require('typescript')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-log-lifetime-'))
fs.writeFileSync(path.join(temp, 'logs.cjs'), ts.transpileModule(fs.readFileSync('src/main/processLogs.ts', 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)
fs.writeFileSync(path.join(temp,'parent.cjs'), `
const {createProcessLogs}=require('./logs.cjs'); const {spawn}=require('child_process');
const logs=createProcessLogs(__dirname,()=>{});
const child=spawn(process.execPath,['-e','setInterval(()=>{console.log("alive");console.error("stderr-alive")},30)'],{detached:true,stdio:logs.stdio});
require('fs').writeFileSync(__dirname+'/pid',String(child.pid)); setInterval(()=>{},1000);
`)
const parent=cp.spawn(process.execPath,[path.join(temp,'parent.cjs')],{stdio:'ignore'})
const delay=ms=>new Promise(r=>setTimeout(r,ms))
;(async()=>{let pid;try {
 for(let i=0;i<100 && !fs.existsSync(path.join(temp,'pid'));i++) await delay(20)
 pid=Number(fs.readFileSync(path.join(temp,'pid'),'utf8'))
 await delay(200)
 const before=fs.statSync(path.join(temp,'stdout.log')).size
 parent.kill('SIGKILL'); await delay(400)
 process.kill(pid,0)
 assert(fs.statSync(path.join(temp,'stdout.log')).size>before,'child must keep logging after its parent dies')
 assert(!fs.readFileSync(path.join(temp,'stderr.log'),'utf8').includes('EPIPE'))
 console.log('PASS: service survives parent death and continues stdout/stderr without EPIPE')
} finally {try{parent.kill('SIGKILL')}catch{};if(pid)try{process.kill(-pid,'SIGTERM')}catch{}; await delay(50);fs.rmSync(temp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1})
