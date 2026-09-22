import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { adaptedColor, colorHex, colorLimits, colorParts } from '../../../shared/menubarTheme'

const HUES = Array.from({ length: 12 }, (_, i) => {
  const centerAngle = i * 30 - 74
  return (360 - centerAngle + 360) % 360
})
const CENTER = 140
const OUTER_RADIUS = 126
const INNER_RADIUS = 83
const CONTROL_RADIUS = 70
const CONTROL_SPAN = 150
const wheelLightness = (radius: number): number =>
  0.88 - clamp((radius - INNER_RADIUS) / (OUTER_RADIUS - INNER_RADIUS), 0, 1) * 0.38
const point = (r: number, angle: number): [number, number] => [
  CENTER + r * Math.cos((angle * Math.PI) / 180),
  CENTER + r * Math.sin((angle * Math.PI) / 180)
]
const arc = (r: number, start: number, end: number): string => {
  const a = point(r, start), b = point(r, end)
  return `M${a} A${r},${r} 0 ${end - start > 180 ? 1 : 0} 1 ${b}`
}
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const sector = (start: number): string => {
  const end = start + 28, corner = 7
  return `M${point(OUTER_RADIUS, start + 3.2)} A${OUTER_RADIUS},${OUTER_RADIUS} 0 0 1 ${point(OUTER_RADIUS, end - 3.2)} Q${point(OUTER_RADIUS, end)} ${point(OUTER_RADIUS - corner, end)} L${point(INNER_RADIUS + corner, end)} Q${point(INNER_RADIUS, end)} ${point(INNER_RADIUS, end - 4.8)} A${INNER_RADIUS},${INNER_RADIUS} 0 0 0 ${point(INNER_RADIUS, start + 4.8)} Q${point(INNER_RADIUS, start)} ${point(INNER_RADIUS + corner, start)} L${point(OUTER_RADIUS - corner, start)} Q${point(OUTER_RADIUS, start)} ${point(OUTER_RADIUS, start + 3.2)} Z`
}
const slice = (start: number, end: number): string =>
  `M${point(OUTER_RADIUS, start)} A${OUTER_RADIUS},${OUTER_RADIUS} 0 0 1 ${point(OUTER_RADIUS, end)} L${point(INNER_RADIUS, end)} A${INNER_RADIUS},${INNER_RADIUS} 0 0 0 ${point(INNER_RADIUS, start)} Z`
function loadColors(key: string): Array<string | null> {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.from({ length: 7 }, (_, i) => typeof saved[i] === 'string' ? saved[i] : null)
  } catch {
    return Array.from({ length: 7 }, () => null)
  }
}

export function ArcColorPicker({ value, confirmedValue, label, onChange, dark, allowTransparent, arrow, left, top }: {
  value: string
  confirmedValue: string
  label: string
  onChange: (value: string) => void
  dark: boolean
  allowTransparent: boolean
  arrow: number
  left: number
  top: number
}): React.JSX.Element {
  const idPrefix = useId().replaceAll(':', '')
  const patternId = `${idPrefix}-checker`
  const minimumAlpha = allowTransparent ? 0 : 0.7
  const display = adaptedColor(value, dark, minimumAlpha)
  const parts = colorParts(display)
  const limits = colorLimits(parts.h, parts.s, dark, minimumAlpha, parts.l)
  const wheelGradients = useMemo(() => HUES.flatMap((_, segment) =>
    Array.from({ length: 8 }, (_, part) => {
      const angle = segment * 30 - 88 + ((part + 0.5) * 28) / 8
      const hue = (360 - angle + 360) % 360
      return <radialGradient key={`${segment}-${part}`} id={`${idPrefix}-wheel-${segment}-${part}`} gradientUnits="userSpaceOnUse" cx="140" cy="140" r="126">
        {Array.from({ length: 9 }, (_, step) => {
          const radius = INNER_RADIUS + (step / 8) * (OUTER_RADIUS - INNER_RADIUS)
          return <stop key={step} offset={radius / OUTER_RADIUS}
            stopColor={adaptedColor(colorHex(hue, 1, wheelLightness(radius), 1), dark, minimumAlpha)} />
        })}
      </radialGradient>
    })
  ), [dark, idPrefix, minimumAlpha])
  const [savedColors, setSavedColors] = useState<Array<string | null>>(() => loadColors('reopen-menubar-saved-colors'))
  const [confirmedColors] = useState<Array<string | null>>(() => {
    const initial = adaptedColor(confirmedValue, dark, minimumAlpha)
    const saved = loadColors('reopen-menubar-confirmed-colors')
    const next = [initial, ...saved.filter((item) => item && item !== initial)].slice(0, 7)
    return Array.from({ length: 7 }, (_, i) => next[i] ?? null)
  })
  const [dragColor, setDragColor] = useState<string | null>(null)
  const [wheelPoint, setWheelPoint] = useState<[number, number] | null>(null)
  const wheelDragging = useRef(false)
  const latestDisplay = useRef(display)
  useEffect(() => { latestDisplay.current = display }, [display])

  useEffect(() => {
    localStorage.setItem('reopen-menubar-confirmed-colors', JSON.stringify(confirmedColors))
    return () => {
      const finalColor = latestDisplay.current
      const current = loadColors('reopen-menubar-confirmed-colors')
      const next = [finalColor, ...current.filter((item) => item && item !== finalColor)].slice(0, 7)
      localStorage.setItem('reopen-menubar-confirmed-colors', JSON.stringify(next))
    }
  }, [confirmedColors])

  const persistSaved = (next: Array<string | null>): void => {
    const seven = Array.from({ length: 7 }, (_, i) => next[i] ?? null)
    setSavedColors(seven)
    localStorage.setItem('reopen-menubar-saved-colors', JSON.stringify(seven))
  }
  const pickScreenColor = async (): Promise<void> => {
    try {
      const sampled = await window.api.pickScreenColor()
      if (sampled) { setWheelPoint(null); onChange(adaptedColor(sampled, dark, minimumAlpha)) }
    } catch { /* cancelled */ }
  }
  const changeControl = (field: 'a' | 'l', value: number): void => {
    setWheelPoint(null)
    onChange(colorHex(
      parts.h,
      parts.s,
      field === 'l' ? clamp(value, limits.minL, limits.maxL) : parts.l,
      field === 'a' ? clamp(value, limits.minA, 1) : parts.a
    ))
  }
  const wheelCoordinates = (event: React.PointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * 280) / rect.width - CENTER
    const y = ((event.clientY - rect.top) * 280) / rect.height - CENTER
    return { x, y }
  }
  const chooseWheelPoint = (event: React.PointerEvent<SVGSVGElement>): void => {
    const { x, y } = wheelCoordinates(event)
    const radius = Math.hypot(x, y)
    const lightness = wheelLightness(radius)
    let angle = (Math.atan2(y, x) * 180) / Math.PI
    if (angle < 0) angle += 360
    const hue = (360 - angle) % 360
    setWheelPoint(point(clamp(radius, INNER_RADIUS + 3, OUTER_RADIUS - 3), angle))
    onChange(adaptedColor(colorHex(hue, 1, lightness, parts.a), dark, minimumAlpha))
  }
  const ringRadius = clamp(INNER_RADIUS + ((0.88 - parts.l) / 0.38) * (OUTER_RADIUS - INNER_RADIUS), INNER_RADIUS + 4, OUTER_RADIUS - 4)
  const ringMarker = wheelPoint ?? point(ringRadius, (360 - parts.h) % 360)

  return <div
    style={{ '--arrow-x': `${arrow}px`, '--picker-surface': colorHex(parts.h, 0.14, dark ? 0.23 : 0.92), left, top } as React.CSSProperties}
    className={`arc-picker ${dark ? 'arc-dark' : 'arc-light'} ${dragColor ? 'is-dragging-color' : ''}`}
    role="dialog" aria-label={`${label}配色`}
  >
    <svg className="arc-dock-pointer" viewBox="0 0 48 18" aria-hidden="true">
      <path className="arc-dock-pointer-fill" d="M0 18 C10 18 13 8 20 3 Q24 -1 28 3 C35 8 38 18 48 18 Z" />
      <path className="arc-dock-pointer-highlight" d="M0 18 C10 18 13 8 20 3 Q24 -1 28 3 C35 8 38 18 48 18" />
    </svg>
    <button className="arc-eyedropper" aria-label="从屏幕吸取颜色" title="从屏幕吸取颜色" onClick={() => void pickScreenColor()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19 3 2 2-5.3 5.3 1 1-2.1 2.1-4-4 2.1-2.1 1 1L19 3ZM9.6 10.4l4 4-6.8 6.1H3.5v-3.3l6.1-6.8Z" /></svg>
    </button>
    <svg className="arc-wheel" viewBox="0 0 280 280"
      onPointerDown={(event) => {
        const { x, y } = wheelCoordinates(event)
        const radius = Math.hypot(x, y)
        if (radius < 35 || radius > OUTER_RADIUS + 2) return
        wheelDragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        chooseWheelPoint(event)
      }}
      onPointerMove={(event) => { if (wheelDragging.current) chooseWheelPoint(event) }}
      onPointerUp={() => { wheelDragging.current = false }}
      onPointerCancel={() => { wheelDragging.current = false }}>
      <defs>
        <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#bbb" /><path d="M0 0h4v4H0zM4 4h4v4H4z" fill="#fff" /></pattern>
        {wheelGradients}
        {HUES.map((_, i) => <clipPath id={`${idPrefix}-clip-${i}`} key={i}><path d={sector(i * 30 - 88)} /></clipPath>)}
      </defs>
      <circle cx={CENTER} cy={CENTER} r={OUTER_RADIUS + 2} fill="transparent" />
      {HUES.map((_, i) => {
        const start = i * 30 - 88
        return <g key={i} clipPath={`url(#${idPrefix}-clip-${i})`}>{Array.from({ length: 8 }, (_, part) => {
          const partStart = start + (part * 28) / 8
          return <path key={part} d={slice(partStart, partStart + 28 / 8 + 0.15)} fill={`url(#${idPrefix}-wheel-${i}-${part})`} />
        })}</g>
      })}
      <path d={arc((OUTER_RADIUS + INNER_RADIUS) / 2, 0, 359.99)} className="arc-wheel-hit" role="slider" tabIndex={0} aria-label="连续选择颜色" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(parts.h)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
          event.preventDefault()
          const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1
          setWheelPoint(null)
          onChange(adaptedColor(colorHex((parts.h + delta + 360) % 360, parts.s, parts.l, parts.a), dark, minimumAlpha))
        }} fill="none" stroke="transparent" strokeWidth={OUTER_RADIUS - INNER_RADIUS} />
      <circle className="arc-wheel-marker-shadow" cx={ringMarker[0] + 1.5} cy={ringMarker[1] + 2} r="6" />
      <circle className="arc-wheel-marker" cx={ringMarker[0]} cy={ringMarker[1]} r="5" fill={display} />
      {(['a', 'l'] as const).map((field) => {
        const start = field === 'a' ? 195 : 15
        const min = field === 'a' ? limits.minA : limits.minL
        const max = field === 'a' ? 1 : limits.maxL
        const controlValue = parts[field]
        const knob = point(CONTROL_RADIUS, start + clamp(controlValue, 0, 1) * CONTROL_SPAN)
        const pointer = (event: React.PointerEvent<SVGGElement>): void => {
          const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect()
          let degrees = (Math.atan2(((event.clientY - rect.top) * 280) / rect.height - CENTER, ((event.clientX - rect.left) * 280) / rect.width - CENTER) * 180) / Math.PI
          if (degrees < 0) degrees += 360
          let relative = degrees - start
          if (relative < -90) relative += 360
          changeControl(field, clamp(relative / CONTROL_SPAN, 0, 1))
        }
        return <g key={field} role="slider" tabIndex={0} aria-label={field === 'a' ? '透明度' : '明度'} aria-valuemin={Math.round(min * 100)} aria-valuemax={Math.round(max * 100)} aria-valuenow={Math.round(controlValue * 100)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            changeControl(field, event.key === 'Home' ? min : event.key === 'End' ? max : controlValue + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -0.01 : 0.01))
          }}
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); pointer(event) }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pointer(event) }}>
          <path d={arc(CONTROL_RADIUS, start, start + CONTROL_SPAN)} className="arc-disabled" strokeWidth="6" fill="none" />
          {Array.from({ length: 44 }, (_, i) => {
            const valueAtPoint = min + (i / 44) * (max - min)
            const nextValue = min + ((i + 1) / 44) * (max - min)
            return <path key={i} d={arc(CONTROL_RADIUS, start + valueAtPoint * CONTROL_SPAN, start + nextValue * CONTROL_SPAN)} stroke={colorHex(parts.h, parts.s, field === 'l' ? valueAtPoint : parts.l, field === 'a' ? valueAtPoint : 1)} strokeWidth="6" fill="none" />
          })}
          {[min, max].map((limit) => {
            const angle = start + limit * CONTROL_SPAN
            const inner = point(CONTROL_RADIUS - 5, angle), outer = point(CONTROL_RADIUS + 5, angle)
            return <g key={limit}><path d={`M${inner} L${outer}`} className="arc-stop-shadow" /><path d={`M${inner} L${outer}`} className="arc-stop-core" /></g>
          })}
          <circle cx={knob[0] + 1.5} cy={knob[1] + 2} r="7" className="arc-control-knob-shadow" />
          <circle cx={knob[0]} cy={knob[1]} r="6" fill={`url(#${patternId})`} />
          <circle cx={knob[0]} cy={knob[1]} r="6" fill={display} className="arc-knob" />
          <path d={arc(CONTROL_RADIUS, start, start + CONTROL_SPAN)} stroke="transparent" strokeWidth="14" fill="none" />
        </g>
      })}
    </svg>
    <button className="arc-center-color" aria-label="当前颜色，可拖到上排待用色板" title={display.toUpperCase()} style={{ '--center-color': display } as React.CSSProperties}
      onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragColor(display) }}
      onPointerUp={(event) => {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-saved-color-index]')
        if (target) {
          const index = Number(target.dataset.savedColorIndex)
          if (Number.isInteger(index) && index >= 0 && index < 7) {
            const next = [...savedColors]
            next[index] = display
            persistSaved(next)
          }
        }
        setDragColor(null)
      }}
      onPointerCancel={() => setDragColor(null)} />
    <div className="arc-palette-row arc-saved-colors" aria-label="待用颜色">
      {savedColors.map((color, i) => <button key={i} data-saved-color-index={i} className={`arc-palette-color arc-saved-color ${color ? '' : 'is-empty'}`} aria-label={color ? `待用颜色 ${i + 1}` : `空的待用颜色 ${i + 1}`} title={color ? color.toUpperCase() : '拖入当前颜色'} style={color ? { '--swatch-color': color } as React.CSSProperties : undefined}
        onClick={() => { if (color) { setWheelPoint(null); onChange(adaptedColor(color, dark, minimumAlpha)) } }} />)}
    </div>
    <div className="arc-palette-row arc-confirmed-colors" aria-label="确认使用颜色">
      {confirmedColors.map((color, i) => <button key={i} className={`arc-palette-color arc-confirmed-color ${color ? '' : 'is-empty'} ${color === display ? 'is-active' : ''}`} aria-label={color ? `选择已确认颜色 ${i + 1}` : `空的已确认颜色 ${i + 1}`} title={color ? color.toUpperCase() : ''} style={color ? { '--swatch-color': color } as React.CSSProperties : undefined} disabled={!color} onClick={() => { if (color) { setWheelPoint(null); onChange(adaptedColor(color, dark, minimumAlpha)) } }} />)}
    </div>
  </div>
}
