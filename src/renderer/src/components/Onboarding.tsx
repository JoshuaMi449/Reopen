import { useEffect, useState } from 'react'
import { Bell, CheckCircle2 } from 'lucide-react'
import logo from '../assets/reopen-logo.png'

interface TourStep {
  target: string
  title: string
  desc: string
}

// 引导步骤：6 步 + 收尾幕（收尾幕与欢迎幕同款大幕，背景半透明）
const STEPS: TourStep[] = [
  {
    target: 'sidebar',
    title: '分类、组和标签',
    desc: '左侧按类型浏览：全部 / 服务 / 网页。\n项目多了，框选右键「添加成组」收成文件夹，再贴彩色标签。'
  },
  {
    target: 'log-panel',
    title: '启动、停下、看日志',
    desc: '卡片左下角启动或停止，运行状态和端口一眼可见；\n点卡片打开右侧详情，日志实时输出。'
  },
  {
    target: 'lan-link',
    title: '局域网分享',
    desc: '点 localhost 地址直接打开；\n局域网地址点一下即复制，同一 Wi-Fi 的手机电脑都能访问。'
  },
  {
    target: 'pin',
    title: '置顶常用项目',
    desc: '点卡片右上角的图钉，项目会固定在主界面「置顶」区；\n菜单栏面板最上方也会出现它，随时点开。'
  },
  {
    target: 'autostart',
    title: '自启项',
    desc: '点工具栏闪电图标打开面板，把项目拖进去；\n打开 Reopen 它们会自动激活，重启 Mac 也不丢。'
  },
  {
    target: 'add',
    title: '把项目拖进来',
    desc: '把项目文件夹或 html 文件直接拖进窗口，自动识别登记；\n也可以点右上角「添加项目」手动选。'
  }
]

interface Props {
  onDone(): void
  /** 当前步骤上报给 App（引导期 demo 卡片随步骤演示运行状态/局域网地址） */
  onStepChange(step: number): void
}

/** 引导卡位置：x/y 是卡片定位点（按箭头方向分别取中心/顶边/底边），arrow 是箭头指向目标的方向 */
interface CardPos {
  x: number
  y: number
  arrow?: 'left' | 'right' | 'top' | 'bottom'
}

/** 新手引导：欢迎界面 → 主界面蒙层 → 分步引导，可跳过，仅首次显示 */
export function Onboarding({ onDone, onStepChange }: Props): React.JSX.Element {
  const [welcomeDone, setWelcomeDone] = useState(false)
  const [welcomeLeaving, setWelcomeLeaving] = useState(false)
  const [step, setStep] = useState(0)
  /** 当前平台是不是 Mac（未知时先按 Mac 渲染权限幕，检测完非 Mac 自动跳过） */
  const [isMac, setIsMac] = useState<boolean | null>(null)
  /** 权限幕状态：requested=已触发系统授权弹窗+测试通知（通知无检测 API，以测试通知送达为准） */
  const [perm, setPerm] = useState<{ requested: boolean }>({ requested: false })
  /** 权限幕已结束（继续/跳过/非 Mac 平台自动） */
  const [permDone, setPermDone] = useState(false)
  const [pos, setPos] = useState<CardPos | null>(null)

  // 平台检测：非 Mac 没有这两项权限，自动跳过权限幕
  useEffect(() => {
    void window.api.getPlatform().then((p) => {
      setIsMac(p === 'darwin')
      if (p !== 'darwin') setPermDone(true)
    })
  }, [])

  // 高亮当前步骤指向的界面元素（同一步可以圈多个，如 localhost 链接 + 局域网链接）：
  // 目标元素浮起到蒙层上 + 描边框合并成包围盒；引导卡定位在包围盒旁。
  // 查询放在 rAF 里——demo 卡片状态随步骤在 App 侧切换，effect 运行时新元素可能还没渲染，
  // 下一帧再查才可靠；窗口尺寸变化时重算（fixed 框不重算会跟目标错位变形）
  useEffect(() => {
    if (!welcomeDone || step >= STEPS.length) return
    const clearHighlight = (): void => {
      document
        .querySelectorAll('[data-tour]')
        .forEach((el) => el.classList.remove('tour-highlight'))
    }
    const recompute = (): void => {
      clearHighlight()
      const els = Array.from(document.querySelectorAll(`[data-tour="${STEPS[step].target}"]`))
      els.forEach((el) => el.classList.add('tour-highlight'))
      if (els.length === 0) {
        // 兜底：目标找不到时卡片放窗口中央，保证引导永不卡死
        setPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 - 60 })
        return
      }
      // 多个目标合并成包围盒，一起圈住；外扩 5px 后收进窗口内（侧栏贴左缘，不收会被裁掉）
      const rects = els.map((el) => el.getBoundingClientRect())
      const box = {
        left: Math.min(...rects.map((x) => x.left)),
        top: Math.min(...rects.map((x) => x.top)),
        right: Math.max(...rects.map((x) => x.right)),
        bottom: Math.max(...rects.map((x) => x.bottom))
      }
      const bw = box.right - box.left
      const bh = box.bottom - box.top
      const GAP = 14
      const CARD_W = 320
      const CARD_H = 200
      const clampX = (x: number): number =>
        Math.min(Math.max(x, CARD_W / 2 + 8), window.innerWidth - CARD_W / 2 - 8)
      const clampY = (y: number): number =>
        Math.min(Math.max(y, CARD_H / 2 + 8), window.innerHeight - CARD_H / 2 - 8)

      // 第 4 步自启：面板从右侧滑出，卡片放包围盒左侧、且不越过面板左缘（224px）——
      // 否则卡片压在刚滑出的面板上挡住演示脚本的字
      if (STEPS[step].target === 'autostart') {
        const panelLeft = window.innerWidth - 224
        setPos({
          x: clampX(Math.min(box.left, panelLeft) - GAP - CARD_W / 2),
          y: clampY(box.top + bh / 2),
          arrow: 'right'
        })
        return
      }

      if (bh > 200 || bw > 420) {
        // 大区域目标（侧栏/列表/抽屉日志区）：卡片放目标的另一侧贴边——放同侧会压住内容（挡字）
        const onRightSide = box.left + bw / 2 > window.innerWidth * 0.6
        if (onRightSide) {
          setPos({
            x: clampX(Math.max(box.left - GAP - CARD_W / 2, CARD_W / 2 + 12)),
            y: clampY(box.top + 140),
            arrow: 'right'
          })
        } else {
          setPos({
            x: clampX(Math.min(box.right + GAP + CARD_W / 2, window.innerWidth - CARD_W / 2 - 12)),
            y: clampY(box.top + 140),
            arrow: 'left'
          })
        }
        return
      }
      // 小元素：优先放下方（箭头朝上），放不下放上方（箭头朝下）
      if (box.bottom + GAP + CARD_H < window.innerHeight) {
        setPos({ x: clampX(box.left + bw / 2), y: box.bottom + GAP, arrow: 'top' })
      } else {
        setPos({ x: clampX(box.left + bw / 2), y: box.top - GAP, arrow: 'bottom' })
      }
    }
    // 每幕引导前等布局过渡（抽屉开/合 300ms、demo 卡状态切换）完成后再重新计算位置——
    // 否则高亮框和引导卡会先出现在过渡中的错误位置再跳正，就是闪一下
    const timer = setTimeout(() => {
      requestAnimationFrame(recompute)
    }, 350)
    window.addEventListener('resize', recompute)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', recompute)
      clearHighlight()
    }
  }, [step, welcomeDone])

  // 权限幕（第 5 步之后、收尾幕之前）：macOS 显示；非 Mac 平台自动跳过进收尾幕。
  // 只剩通知一项：「去开启」=发测试通知触发系统授权弹窗+打开系统设置通知页；
  // 没有检测 API，以测试通知送达为准（文件夹访问不引导——拖拽/面板选择即授权，系统弹窗自然出现）
  if (welcomeDone && step >= STEPS.length && isMac !== false && !permDone) {
    const doRequest = async (): Promise<void> => {
      await window.api.requestPermissions()
      // 引导里点授权 = 用户愿意收通知：顺手把「启动失败通知」打开（用户拍板 2026-09-02）
      void window.api.saveSettings({ notifyOnFail: true })
      setPerm({ requested: true })
    }
    return (
      <>
        <div className="tour-overlay" />
        <div className="perm-panel">
          <h3 className="perm-title">开启通知</h3>
          <p className="perm-sub">一项可选权限，授权后体验更完整，也可以先跳过</p>
          <div className="perm-cards">
            <div className={`perm-card ${perm.requested ? 'perm-card-ok' : ''}`}>
              <Bell className="perm-card-icon" size={20} />
              <div className="perm-card-title">通知</div>
              <div className="perm-card-desc">
                {perm.requested
                  ? '已发送测试通知——看到系统通知即已开启'
                  : '项目启动失败、断线时发系统通知提醒你'}
              </div>
              {perm.requested && <CheckCircle2 className="perm-card-check" size={16} />}
            </div>
          </div>
          <div className="perm-actions">
            <button className="btn-secondary" onClick={() => setPermDone(true)}>
              跳过
            </button>
            {perm.requested ? (
              <button className="perm-btn-system" onClick={() => setPermDone(true)}>
                继续
              </button>
            ) : (
              <button className="perm-btn-system" onClick={() => void doRequest()}>
                去开启
              </button>
            )}
          </div>
        </div>
      </>
    )
  }

  // 收尾幕：与欢迎幕同款大幕，背景半透明（背后主界面可见）；
  // 不放大按钮——「点击进入」小字提示，点画面任何地方都进入
  if (welcomeDone && step >= STEPS.length) {
    return (
      <div className="welcome welcome-done" onClick={onDone}>
        <img className="welcome-logo" src={logo} alt="Reopen" draggable={false} />
        <h1 className="welcome-line1">随时唤出</h1>
        <p className="welcome-line2">按 ⌥+R 在任何软件里唤出 Reopen</p>
        <p className="welcome-enter">点击进入</p>
      </div>
    )
  }

  // 欢迎界面（点「开始」先淡出，再进第一步，避免生硬切换）
  if (!welcomeDone) {
    return (
      <div className={`welcome ${welcomeLeaving ? 'welcome-leaving' : ''}`}>
        <img className="welcome-logo" src={logo} alt="Reopen" draggable={false} />
        <h1 className="welcome-line1">你的本地项目陈列架</h1>
        <p className="welcome-line2">重启 Mac 之后，项目、端口和网页都还在原处</p>
        <div className="welcome-pills">
          <span>截图卡片</span>
          <span>分组收纳</span>
          <span>置顶常驻</span>
          <span>局域网分享</span>
          <span>菜单栏面板</span>
        </div>
        <button
          className="btn-primary welcome-btn"
          onClick={() => {
            setWelcomeLeaving(true)
            setTimeout(() => setWelcomeDone(true), 260)
          }}
        >
          开始使用
        </button>
      </div>
    )
  }

  const s = STEPS[step]

  // 切步：同时上报 App（demo 卡片演示状态跟随步骤，同一批渲染里就位）；
  // 清掉上一幕的位置——新一幕等布局稳定后重新计算，旧位置不残留（避免闪一下）
  const goStep = (next: number): void => {
    setStep(next)
    onStepChange(next)
    setPos(null)
  }

  return (
    <>
      <div className="tour-overlay" />
      {pos && (
        <div
          key={step}
          className="tour-card"
          data-arrow={pos.arrow ?? 'none'}
          style={{ left: pos.x, top: pos.y }}
        >
          <div className="tour-head">
            <div className="tour-dots">
              {STEPS.map((_, i) => (
                <span key={i} className={i === step ? 'is-on' : i < step ? 'is-done' : ''} />
              ))}
            </div>
            <div className="tour-step">
              {step + 1} / {STEPS.length}
            </div>
          </div>
          <h3>{s.title}</h3>
          <p>{s.desc}</p>
          <div className="tour-actions">
            {step > 0 ? (
              <button className="btn-secondary" onClick={() => goStep(step - 1)}>
                上一步
              </button>
            ) : (
              <span />
            )}
            <button className="btn-secondary" onClick={onDone}>
              跳过
            </button>
            <button className="btn-primary" onClick={() => goStep(step + 1)}>
              下一步
            </button>
          </div>
        </div>
      )}
    </>
  )
}
