import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface Props {
  /** 气泡说明文字 */
  text: string
  children: ReactNode
}

/** 悬停 0.6 秒弹出说明气泡（2026-08-20 提速：1.5s 太慢，用户实测反馈） */
export function Tooltip({ text, children }: Props): React.JSX.Element {
  const [show, setShow] = useState(false)
  const timer = useRef<number | null>(null)

  return (
    <span
      className="tip-wrap"
      onMouseEnter={() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setShow(true), 600)
      }}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current)
        setShow(false)
      }}
    >
      {children}
      {show && <span className="tip-bubble">{text}</span>}
    </span>
  )
}
