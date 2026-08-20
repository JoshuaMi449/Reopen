import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface Props {
  /** 气泡说明文字 */
  text: string
  children: ReactNode
}

/**
 * 悬停 0.6 秒弹出说明气泡（2026-08-20 拍板：工具栏 icon 全覆盖）。
 * 用原生 mouseenter/mouseleave 监听（React 合成事件对 select 等原生控件不触发，用户实测反馈）。
 */
export function Tooltip({ text, children }: Props): React.JSX.Element {
  const [show, setShow] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const enter = (): void => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setShow(true), 600)
    }
    const leave = (): void => {
      if (timer.current) clearTimeout(timer.current)
      setShow(false)
    }
    el.addEventListener('mouseenter', enter)
    el.addEventListener('mouseleave', leave)
    return () => {
      el.removeEventListener('mouseenter', enter)
      el.removeEventListener('mouseleave', leave)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [text])

  return (
    <span ref={wrapRef} className="tip-wrap">
      {children}
      {show && <span className="tip-bubble">{text}</span>}
    </span>
  )
}
