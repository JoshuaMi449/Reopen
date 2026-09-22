export const MENUBAR_THEME_GROUPS = [
  {
    label: 'CPU',
    colors: [
      { key: 'cpu-user', label: '用户', value: '#007aff' },
      { key: 'cpu-system', label: '系统', value: '#f346a2' },
      { key: 'cpu-idle', label: '空闲', value: '#66666b' }
    ]
  },
  {
    label: '内存',
    colors: [
      { key: 'memory-app', label: 'App内存', value: '#007aff' },
      { key: 'memory-wired', label: '联动内存', value: '#f346a2' },
      { key: 'memory-compressed', label: '已压缩', value: '#ffcc00' },
      { key: 'memory-available', label: '可用', value: '#5b5b60' }
    ]
  },
  {
    label: '储存',
    colors: [
      { key: 'storage-used', label: '已用', value: '#007aff' },
      { key: 'storage-free', label: '可用', value: '#5b5b60' }
    ]
  },
  {
    label: '电池',
    colors: [
      { key: 'battery-adapter', label: '适配器', value: '#007aff' },
      { key: 'battery-battery', label: '电池', value: '#f346a2' }
    ]
  },
  {
    label: '网络',
    colors: [
      { key: 'net-upload', label: '上传', value: '#8c96cb' },
      { key: 'net-download', label: '下载', value: '#e88fb4' }
    ]
  }
] as const
export type MenubarColorKey = (typeof MENUBAR_THEME_GROUPS)[number]['colors'][number]['key']
export type MenubarColors = Partial<Record<MenubarColorKey, string>>
export function allowsTransparentColor(key: MenubarColorKey): boolean {
  return ['cpu-idle', 'memory-available', 'storage-free'].includes(key)
}
export function menubarColor(
  colors: MenubarColors | undefined,
  key: MenubarColorKey,
  fallback: string
): string {
  const value = colors?.[key]
  return value && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value : fallback
}

export function colorParts(hex: string): { h: number; s: number; l: number; a: number } {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = rgb,
    max = Math.max(...rgb),
    min = Math.min(...rgb),
    d = max - min,
    l = (max + min) / 2
  let h = 0
  if (d)
    h =
      (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) *
      60
  return {
    h,
    s: d ? d / (1 - Math.abs(2 * l - 1)) : 0,
    l,
    a: hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1
  }
}
export function colorHex(h: number, s: number, l: number, a = 1): string {
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2
  const rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return (
    '#' +
    [...rgb.map((v) => v + m), a]
      .map((v) =>
        Math.round(Math.max(0, Math.min(1, v)) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}
function contrast(hex: string, dark: boolean): number {
  // Match the opaque inner surfaces used by the system-themed menu panel.
  const background = dark ? [0x2d, 0x2e, 0x31] : [0xf1, 0xf2, 0xf4],
    alpha = colorParts(hex).a
  const linear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const rgb = [1, 3, 5].map((i, channel) =>
    linear((parseInt(hex.slice(i, i + 2), 16) * alpha + background[channel] * (1 - alpha)) / 255)
  )
  const y = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722,
    bg = background.reduce((sum, channel, i) => sum + linear(channel / 255) * [0.2126, 0.7152, 0.0722][i], 0)
  return (Math.max(y, bg) + 0.05) / (Math.min(y, bg) + 0.05)
}
/** Bounds are calculated against the actual light/dark panel surfaces at minimum opacity. */
export function colorLimits(
  h: number,
  s: number,
  dark: boolean,
  minimumAlpha = 0.7,
  currentL = 0.5
): { minL: number; maxL: number; minA: number; maxA: number } {
  const floorA = Math.max(0, Math.min(1, minimumAlpha))
  const valid = Array.from({ length: 91 }, (_, i) => (i + 5) / 100).filter(
    (l) => contrast(colorHex(h, s, l, 1), dark) >= 3
  )
  const minL = valid[0] ?? 0.5, maxL = valid.at(-1) ?? 0.5
  const displayL = Math.max(minL, Math.min(maxL, currentL))
  const minA = floorA === 0 ? 0 :
    Array.from({ length: 101 - Math.ceil(floorA * 100) }, (_, i) =>
      (Math.ceil(floorA * 100) + i) / 100
    ).find((a) => contrast(colorHex(h, s, displayL, a), dark) >= 3) ?? 1
  return { minL, maxL, minA, maxA: 1 }
}
export function adaptedColor(hex: string, dark: boolean, minimumAlpha = 0.7): string {
  const { h, s, l, a } = colorParts(hex),
    limits = colorLimits(h, s, dark, minimumAlpha, l)
  return colorHex(
    h,
    s,
    Math.max(limits.minL, Math.min(limits.maxL, l)),
    Math.max(limits.minA, Math.min(1, a))
  )
}

export function menubarDark(
  settings: { darkMode: string; specialStyle?: string },
  systemDark: boolean
): boolean {
  if (settings.darkMode === 'special')
    return ['special-oceandark', 'special-forestdark', 'special-slatedark'].includes(
      settings.specialStyle ?? ''
    )
  return settings.darkMode === 'dark' || (settings.darkMode === 'system' && systemDark)
}
