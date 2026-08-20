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

/** 新手引导（PRD 3.9）：欢迎界面 → 主界面蒙层 → 分步引导，可跳过，仅首次显示 */
export function Onboarding({ onDone }: Props): React.JSX.Element {
  const [welcomeDone, setWelcomeDone] = useState(false)
  const [step, setStep] = useState(0)
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)

  // 高亮当前步骤指向的界面元素（蒙层变暗 + 目标元素浮起）
  useEffect(() => {
    if (!welcomeDone) return
    document.querySelectorAll('[data-tour]').forEach((el) => el.classList.remove('tour-highlight'))
    const el = document.querySelector(`[data-tour="${STEPS[step].target}"]`)
    el?.classList.add('tour-highlight')
    return () => el?.classList.remove('tour-highlight')
  }, [step, welcomeDone])

  // 引导卡定位在目标元素旁（rAF 里更新，避免 effect 内同步 setState）
  useEffect(() => {
    if (!welcomeDone) return
    const el = document.querySelector(`[data-tour="${STEPS[step].target}"]`)
    const id = requestAnimationFrame(() => {
      if (!el) {
        setPos(null)
        return
      }
      const r = el.getBoundingClientRect()
      const below = r.top < 280
      setPos({ x: r.left + r.width / 2, y: below ? r.bottom + 14 : r.top - 14, below })
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
          style={{
            left: pos.x,
            top: pos.y,
            transform: `translateX(-50%) translateY(${pos.below ? 0 : '-100%'})`
          }}
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
