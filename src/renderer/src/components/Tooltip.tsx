import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface Props {
  /** 气泡说明文字 */
  text: string
  children: ReactNode
}

/** 悬停 1.5 秒弹出说明气泡（2026-08-20 拍板：工具栏 icon 全覆盖） */
export function Tooltip({ text, children }: Props): React.JSX.Element {
  const [show, setShow] = useState(false)
  const timer = useRef<number | null>(null)

  return (
    <span
      className="tip-wrap"
      onMouseEnter={() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setShow(true), 1500)
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
