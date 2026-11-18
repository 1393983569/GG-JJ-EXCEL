export type FilterKind = 'ascii' | 'dither'
export type PaletteName = 'original' | 'meadow' | 'blue' | 'amber' | 'lavender' | 'mono'
export type InkTone = 'shadows' | 'highlights'

export interface EffectSettings {
  filter: FilterKind
  mask: number
  palette: PaletteName
  inkTone: InkTone
  strength: number
  size: number
  spacing: number
}

export const RECOMMENDED: Record<FilterKind, EffectSettings> = {
  ascii: {
    filter: 'ascii',
    mask: 90,
    palette: 'original',
    inkTone: 'shadows',
    strength: 100,
    size: 37,
    spacing: 0,
  },
  dither: {
    filter: 'dither',
    mask: 88,
    palette: 'original',
    inkTone: 'shadows',
    strength: 100,
    size: 15,
    spacing: 0,
  },
}

export const PALETTES: Record<Exclude<PaletteName, 'original'>, [string, string, string, string]> = {
  meadow: ['#2B361F', '#677D45', '#AEBA78', '#E5E1BD'],
  blue: ['#192A4D', '#326AC5', '#A2C2F1', '#EDF3FC'],
  amber: ['#3C200F', '#A74C15', '#EF9A46', '#F7E7CA'],
  lavender: ['#292144', '#6552AB', '#B3A5E4', '#F0ECFB'],
  mono: ['#151515', '#575757', '#A6A6A6', '#ECECEC'],
}

export const PALETTE_ORDER: PaletteName[] = ['original', 'meadow', 'blue', 'amber', 'lavender', 'mono']

const PALETTE_POSITIONS = [0, 0.4, 0.74, 1]

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))

export const range = (v: number, a: number, b: number) => a + (b - a) * v / 100

export const smoothstep = (v: number) => {
  const t = clamp(v)
  return t * t * (3 - 2 * t)
}

export const luminance = (r: number, g: number, b: number) =>
  (0.299 * r + 0.587 * g + 0.114 * b) / 255

const hexToRgb = (hex: string): [number, number, number] => {
  const value = hex.replace('#', '')
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ]
}

export function buildPaletteLut(name: Exclude<PaletteName, 'original'>): Uint8ClampedArray {
  const stops = PALETTES[name].map(hexToRgb)
  const lut = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let seg = 0
    while (seg < PALETTE_POSITIONS.length - 2 && t > PALETTE_POSITIONS[seg + 1]) seg++
    const p0 = PALETTE_POSITIONS[seg]
    const p1 = PALETTE_POSITIONS[seg + 1]
    const local = clamp((t - p0) / (p1 - p0))
    for (let c = 0; c < 3; c++) {
      lut[i * 3 + c] = stops[seg][c] + (stops[seg + 1][c] - stops[seg][c]) * local
    }
  }
  return lut
}

function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / d + 2)
    else h = 60 * ((rn - gn) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ]
}

export function liftInk(r: number, g: number, b: number, s: number, tone: number) {
  const hsv = rgbToHsv(r, g, b)
  const v = clamp(hsv.v + (1 - hsv.v) * (0.24 + 0.18 * s + 0.24 * tone))
  const sat = clamp(hsv.s * (1 + 0.16 + 0.2 * s))
  return hsvToRgb(hsv.h, sat, v)
}
