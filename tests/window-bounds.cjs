// 窗口位置记忆的回落规则。
// 存在的意义：外接屏拔掉 / 分辨率变小后，保存的坐标可能落在不存在的屏幕上——
// 没有回落的话窗口恢复后打不开，用户会当成 app 崩了。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-window-bounds-'))
fs.writeFileSync(
  path.join(temp, 'mod.cjs'),
  ts.transpileModule(fs.readFileSync('src/shared/windowBounds.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
)
const { clampWindowBounds } = require(path.join(temp, 'mod.cjs'))

const min = { width: 1200, height: 620 }
const fallback = { x: 560, y: 280, width: 1408, height: 880 }
const main = {
  bounds: { x: 0, y: 0, width: 2560, height: 1440 },
  workArea: { x: 0, y: 25, width: 2560, height: 1415 }
}
const second = {
  bounds: { x: 2560, y: 0, width: 1920, height: 1080 },
  workArea: { x: 2560, y: 25, width: 1920, height: 1055 }
}

const clamp = (saved, displays) => clampWindowBounds(saved, displays, min, fallback)

try {
  // 没有保存过 → 用默认位置
  assert.deepEqual(clamp(undefined, [main]), fallback)

  // 正常位置原样恢复
  assert.deepEqual(clamp({ x: 100, y: 100, width: 1400, height: 900 }, [main]), {
    x: 100,
    y: 100,
    width: 1400,
    height: 900
  })

  // 保存的屏幕不在了（外接屏被拔）→ 回落主屏默认位置
  assert.deepEqual(clamp({ x: 5000, y: 100, width: 1400, height: 900 }, [main]), fallback)

  // 比最小尺寸还小 → 抬到最小尺寸
  assert.deepEqual(clamp({ x: 100, y: 100, width: 800, height: 400 }, [main]), {
    x: 100,
    y: 100,
    width: 1200,
    height: 620
  })

  // 比屏幕还大且坐标为负 → 缩到工作区并拉回左上角
  assert.deepEqual(clamp({ x: -100, y: -100, width: 3000, height: 2000 }, [main]), {
    x: 0,
    y: 25,
    width: 2560,
    height: 1415
  })

  // 双屏时留在第二屏，不强行搬回主屏
  assert.deepEqual(clamp({ x: 2700, y: 100, width: 1400, height: 900 }, [main, second]), {
    x: 2700,
    y: 100,
    width: 1400,
    height: 900
  })

  // 右缘越界 → x 夹回屏幕内（宽度不变）
  assert.deepEqual(clamp({ x: 1500, y: 100, width: 1400, height: 900 }, [main]), {
    x: 1160,
    y: 100,
    width: 1400,
    height: 900
  })
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}

console.log('PASS: window bounds always land on a visible display')
