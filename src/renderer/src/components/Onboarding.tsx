import { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'

interface TourStep {
  target: string
  title: string
  desc: string
}

// PRD 3.9：引导步骤（4 步 + 收尾）
const STEPS: TourStep[] = [
  {
    target: 'sidebar',
    title: '按类型和标签浏览',
    desc: '左侧分类栏：全部 / 最近使用 / 服务 / 网页，还有你打的彩色标签。'
  },
  {
    target: 'list',
    title: '启动和停止项目',
    desc: '点行尾按钮一键启停。点项目本身，右侧会滑出详情抽屉：端口、日志、重启都在里面。'
  },
  {
    target: 'add',
    title: '把项目拖进来',
    desc: '把项目文件夹或 html 文件直接拖进窗口，自动识别登记；也可以点「+」手动添加。'
  },
  {
    target: 'autostart',
    title: '自启项',
    desc: '点工具栏的闪电图标打开气泡面板，把项目拖进去——以后打开 Reopen 自动复活它们。'
  },
  {
    target: 'finish',
    title: '随时唤出',
    desc: '按 ⌥+R 可以在任何软件里唤出 Reopen。开始用吧！'
  }
]

interface Props {
  onDone(): void
}

/** 引导卡位置：x/y 是卡片定位点（按箭头方向分别取中心/顶边/底边），arrow 是箭头指向目标的方向 */
interface CardPos {
  x: number
  y: number
  arrow?: 'left' | 'right' | 'top' | 'bottom'
}

/** 新手引导（PRD 3.9）：欢迎界面 → 主界面蒙层 → 分步引导，可跳过，仅首次显示 */
export function Onboarding({ onDone }: Props): React.JSX.Element {
  const [welcomeDone, setWelcomeDone] = useState(false)
  const [step, setStep] = useState(0)
  const [pos, setPos] = useState<CardPos | null>(null)

  // 高亮当前步骤指向的界面元素（蒙层变暗 + 目标元素浮起）
  useEffect(() => {
    if (!welcomeDone) return
    document.querySelectorAll('[data-tour]').forEach((el) => el.classList.remove('tour-highlight'))
    const el = document.querySelector(`[data-tour="${STEPS[step].target}"]`)
    el?.classList.add('tour-highlight')
    return () => el?.classList.remove('tour-highlight')
  }, [step, welcomeDone])

  // 引导卡定位在目标元素旁（rAF 里更新，避免 effect 内同步 setState）
  // 2026-08-20 验收整改：卡片不遮挡正在介绍的区域，放在区域外 + 箭头指向
  useEffect(() => {
    if (!welcomeDone) return
    const el = document.querySelector(`[data-tour="${STEPS[step].target}"]`)
    const id = requestAnimationFrame(() => {
      if (!el) {
        // 兜底：目标找不到时卡片放窗口中央（收尾步无目标也走这里），保证引导永不卡死
        setPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 - 60 })
        return
      }
      const r = el.getBoundingClientRect()
      const GAP = 14
      const CARD_W = 320
      const CARD_H = 190
      const clampX = (x: number): number =>
        Math.min(Math.max(x, CARD_W / 2 + 8), window.innerWidth - CARD_W / 2 - 8)
      const clampY = (y: number): number =>
        Math.min(Math.max(y, CARD_H / 2 + 8), window.innerHeight - CARD_H / 2 - 8)

      if (r.height > 200) {
        // 大区域目标：卡片放在区域外面——左半屏目标放右侧，右半屏目标放左侧，垂直取区域上部
        if (r.left + r.width / 2 < window.innerWidth / 2) {
          setPos({ x: clampX(r.right + GAP + CARD_W / 2), y: clampY(r.top + 130), arrow: 'left' })
        } else {
          setPos({ x: clampX(r.left - GAP - CARD_W / 2), y: clampY(r.top + 130), arrow: 'right' })
        }
        return
      }
      // 小元素：优先放下方（箭头朝上），放不下放上方（箭头朝下）
      if (r.bottom + GAP + CARD_H < window.innerHeight) {
        setPos({ x: clampX(r.left + r.width / 2), y: r.bottom + GAP, arrow: 'top' })
      } else {
        setPos({ x: clampX(r.left + r.width / 2), y: r.top - GAP, arrow: 'bottom' })
      }
    })
    return () => cancelAnimationFrame(id)
  }, [step, welcomeDone])

  // 欢迎界面
  if (!welcomeDone) {
    return (
      <div className="welcome">
        <div className="welcome-icon">
          <Zap size={40} />
        </div>
        <h1>Reopen</h1>
        <p>
          重启 Mac，不丢项目。
          <br />
          登记你的项目，一键启动，打开 Reopen 自动复活。
        </p>
        <button className="btn-primary welcome-btn" onClick={() => setWelcomeDone(true)}>
          开始
        </button>
      </div>
    )
  }

  const s = STEPS[step]

  return (
    <>
      <div className="tour-overlay" />
      {pos && (
        <div
          className="tour-card"
          data-arrow={pos.arrow ?? 'none'}
          style={{ left: pos.x, top: pos.y }}
        >
          <div className="tour-step">
            第 {step + 1} / {STEPS.length} 步
          </div>
          <h3>{s.title}</h3>
          <p>{s.desc}</p>
          <div className="tour-actions">
            {step > 0 ? (
              <button className="btn-secondary" onClick={() => setStep(step - 1)}>
                上一步
              </button>
            ) : (
              <span />
            )}
            <button className="btn-secondary" onClick={onDone}>
              跳过
            </button>
            {step < STEPS.length - 1 ? (
              <button className="btn-primary" onClick={() => setStep(step + 1)}>
                下一步
              </button>
            ) : (
              <button className="btn-primary" onClick={onDone}>
                开始使用
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
