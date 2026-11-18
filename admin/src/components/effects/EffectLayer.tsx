import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import {
  buildPaletteLut,
  clamp,
  liftInk,
  luminance,
  range,
  smoothstep,
  type EffectSettings,
} from './effectSettings'

const CHARS = '  .,:;-=+xX08S#&@'
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

type SampleResult = {
  canvas: HTMLCanvasElement
  data: Uint8ClampedArray
  width: number
  height: number
  low: number
  high: number
}

type FadeState = { image: HTMLCanvasElement; start: number }

interface EffectLayerProps {
  children: ReactNode
  settings: EffectSettings
  radius?: number
  dark?: boolean
  animated?: boolean
  className?: string
  style?: CSSProperties
}

export default function EffectLayer({
  children,
  settings,
  radius = 0,
  dark = false,
  animated = false,
  className,
  style,
}: EffectLayerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const blockCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const sampleResultRef = useRef<SampleResult | null>(null)
  const drawRef = useRef<() => void>(() => {})
  const fadeRef = useRef<FadeState | null>(null)
  const fadeRafRef = useRef<number | null>(null)
  const prevKeyRef = useRef('')
  const visibleRef = useRef(true)
  const animateVisibleRef = useRef(true)
  const phaseRef = useRef(0)
  const videoRafRef = useRef<number | null>(null)
  const cancelVideoRef = useRef<() => void>(() => {})

  useEffect(() => {
    const wrapper = wrapperRef.current
    const canvas = canvasRef.current
    if (!wrapper || !canvas) return
    if (animated) sampleResultRef.current = null

    const getMedia = () => wrapper.querySelector('img, video') as HTMLImageElement | HTMLVideoElement | null

    const ensureSampleCanvas = () => {
      if (!sampleCanvasRef.current) sampleCanvasRef.current = document.createElement('canvas')
      return sampleCanvasRef.current
    }

    const ensureBlockCanvas = () => {
      if (!blockCanvasRef.current) blockCanvasRef.current = document.createElement('canvas')
      return blockCanvasRef.current
    }

    const compositePixel = (data: Uint8ClampedArray, w: number, h: number, u: number, v: number) => {
      const x = clamp(Math.floor(u * w), 0, w - 1)
      const y = clamp(Math.floor(v * h), 0, h - 1)
      const i = (y * w + x) * 4
      const a = data[i + 3] / 255
      return {
        r: data[i] * a + 255 * (1 - a),
        g: data[i + 1] * a + 255 * (1 - a),
        b: data[i + 2] * a + 255 * (1 - a),
      }
    }

    const sample = (): SampleResult | null => {
      const media = getMedia()
      if (!media) return null
      const sw = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
      const sh = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
      if (!sw || !sh) return null
      const rect = wrapper.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))

      const targetAspect = w / h
      const sourceAspect = sw / sh
      let sx = 0
      let sy = 0
      let cropW = sw
      let cropH = sh
      if (sourceAspect > targetAspect) {
        cropW = sh * targetAspect
        sx = (sw - cropW) / 2
      } else {
        cropH = sw / targetAspect
        sy = (sh - cropH) / 2
      }

      const sampleW = w >= h ? 480 : Math.max(1, Math.round(480 * w / h))
      const sampleH = h >= w ? 480 : Math.max(1, Math.round(480 * h / w))
      const sampleCanvas = ensureSampleCanvas()
      sampleCanvas.width = sampleW
      sampleCanvas.height = sampleH
      const sctx = sampleCanvas.getContext('2d', { willReadFrequently: true })!
      sctx.drawImage(media, sx, sy, cropW, cropH, 0, 0, sampleW, sampleH)

      const imageData = sctx.getImageData(0, 0, sampleW, sampleH)
      if (settings.palette !== 'original') {
        const lut = buildPaletteLut(settings.palette)
        const d = imageData.data
        for (let i = 0; i < d.length; i += 4) {
          const idx = clamp(Math.round(luminance(d[i], d[i + 1], d[i + 2]) * 255), 0, 255) * 3
          d[i] = lut[idx]
          d[i + 1] = lut[idx + 1]
          d[i + 2] = lut[idx + 2]
        }
        sctx.putImageData(imageData, 0, 0)
      }

      const cols = 160
      const rows = 75
      const values: number[] = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const px = compositePixel(imageData.data, sampleW, sampleH, (c + 0.5) / cols, (r + 0.5) / rows)
          values.push(luminance(px.r, px.g, px.b))
        }
      }
      values.sort((a, b) => a - b)
      return {
        canvas: sampleCanvas,
        data: imageData.data,
        width: sampleW,
        height: sampleH,
        low: values[Math.floor(values.length * 0.08)],
        high: values[Math.floor(values.length * 0.92)],
      }
    }

    const drawMask = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const bases = dark ? [44, 20, 50] : [54, 20, 38]
      const v = settings.mask
      const alpha = (base: number) => {
        const stop = v <= 50
          ? base * Math.pow(v / 50, 1.08)
          : base + (100 - base) * Math.pow((v - 50) / 50, 1.08)
        return clamp(stop / 100, 0, 1)
      }
      const rgb = dark ? '0,0,0' : '255,255,255'
      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, `rgba(${rgb},${alpha(bases[0])})`)
      grad.addColorStop(0.42, `rgba(${rgb},${alpha(bases[1])})`)
      grad.addColorStop(1, `rgba(${rgb},${alpha(bases[2])})`)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    }

    const drawAscii = (ctx: CanvasRenderingContext2D, sampled: SampleResult, w: number, h: number) => {
      const s = settings.strength / 100
      const time = animated ? phaseRef.current : 0
      const driftX = Math.sin(time * 0.55) * 0.012
      const driftY = Math.cos(time * 0.42) * 0.008
      ctx.drawImage(sampled.canvas, 0, 0, w, h)
      drawMask(ctx, w, h)

      const maxFont = w < 720 ? 22 : 24
      const fontPx = Math.round(range(settings.size, 7, maxFont))
      ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
      const widest = Math.max(...[...CHARS].map((ch) => ctx.measureText(ch).width))
      const metrics = ctx.measureText('@')
      const glyphH = (metrics.actualBoundingBoxAscent || fontPx) + (metrics.actualBoundingBoxDescent || 0) || fontPx
      const xStep = Math.max(range(settings.spacing, 8, 24), widest * 1.08)
      const yStep = Math.max(range(settings.spacing, 9, 26), glyphH * 1.12, fontPx * 1.04)
      const span = sampled.high - sampled.low
      const darkInk = settings.inkTone === 'shadows'
      const mix = 0.72 + 0.14 * s
      const black = 0.22 * s
      const white = 1 - 0.08 * s

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let y = yStep / 2; y < h; y += yStep) {
        for (let x = xStep / 2; x < w; x += xStep) {
          const u = x / w + driftX + Math.sin(time * 1.05 + y / h * 5) * 0.006
          const v = y / h + driftY + Math.sin(time * 0.8 + x / w * 4) * 0.005
          const px = compositePixel(sampled.data, sampled.width, sampled.height, u, v)
          const L = luminance(px.r, px.g, px.b)
          const raw = darkInk ? 1 - L : L
          const normalized = span < 0.025
            ? raw
            : clamp(darkInk ? (sampled.high - L) / span : (L - sampled.low) / span)
          const t = raw * (1 - mix) + normalized * mix
          const shimmer = animated ? 0.035 * Math.sin(time * 2.2 + x * 0.12 + y * 0.08) : 0
          const lev = clamp((t - black) / (white - black) + shimmer)
          const tone = lev * (1 - s) + smoothstep(lev) * s
          if (tone <= 0.02) continue
          const ch = CHARS[Math.round(tone * 16)]
          if (ch === ' ') continue
          const [ir, ig, ib] = liftInk(px.r, px.g, px.b, s, tone)
          const alpha = clamp((0.12 + 0.7 * tone) * (0.72 + 0.28 * s), 0.06, 0.94)
          ctx.fillStyle = `rgba(${ir},${ig},${ib},${alpha})`
          ctx.fillText(ch, x, y)
        }
      }
    }

    const drawDither = (ctx: CanvasRenderingContext2D, sampled: SampleResult, w: number, h: number) => {
      const s = settings.strength / 100
      const pixel = Math.max(2, Math.round(range(settings.size, 2, w < 720 ? 7 : 9)))
      const patternScale = Math.max(1, Math.round(range(settings.spacing, 1, 4)))
      const levels = Math.max(2, Math.round(range(settings.strength, 8, 2)))
      const blend = range(settings.strength, 0.32, 1)
      const bw = Math.max(1, Math.ceil(w / pixel))
      const bh = Math.max(1, Math.ceil(h / pixel))
      const blockCanvas = ensureBlockCanvas()
      blockCanvas.width = bw
      blockCanvas.height = bh
      const bctx = blockCanvas.getContext('2d')!
      const out = bctx.createImageData(bw, bh)
      const factor = 1 + 0.06 + 0.18 * s

      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          const px = compositePixel(sampled.data, sampled.width, sampled.height, (bx + 0.5) / bw, (by + 0.5) / bh)
          const luma = 0.299 * px.r + 0.587 * px.g + 0.114 * px.b
          const pushed = [
            luma + (px.r - luma) * factor,
            luma + (px.g - luma) * factor,
            luma + (px.b - luma) * factor,
          ]
          const mx = Math.floor(bx / patternScale) % 4
          const my = Math.floor(by / patternScale) % 4
          const threshold = (BAYER[my][mx] + 0.5) / 16
          const quantize = (c: number) => {
            const scaled = c / 255 * (levels - 1)
            const base = Math.floor(scaled)
            const q = base + (scaled - base > threshold ? 1 : 0)
            return c + (q / (levels - 1) * 255 - c) * blend
          }
          const i = (by * bw + bx) * 4
          out.data[i] = quantize(pushed[0])
          out.data[i + 1] = quantize(pushed[1])
          out.data[i + 2] = quantize(pushed[2])
          out.data[i + 3] = 255
        }
      }
      bctx.putImageData(out, 0, 0)

      const dpr = Math.min(window.devicePixelRatio || 1, 1.6, 2048 / Math.max(w, h))
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(blockCanvas, 0, 0, bw, bh, 0, 0, w, h)
      ctx.imageSmoothingEnabled = true
      drawMask(ctx, w, h)
    }

    const renderEffect = () => {
      const rect = wrapper.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const dpr = Math.min(window.devicePixelRatio || 1, 1.6, 2048 / Math.max(w, h))
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.max(1, Math.round(w * dpr))
        canvas.height = Math.max(1, Math.round(h * dpr))
      }
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const useCache = animated && !(getMedia() instanceof HTMLVideoElement)
      let sampled = useCache ? sampleResultRef.current : null
      if (!sampled) {
        sampled = sample()
        if (useCache) sampleResultRef.current = sampled
      }
      if (!sampled) return
      if (settings.filter === 'ascii') drawAscii(ctx, sampled, w, h)
      else drawDither(ctx, sampled, w, h)
    }

    const draw = () => {
      const rect = wrapper.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      renderEffect()
      const fade = fadeRef.current
      if (!fade) return
      const remaining = 1 - (performance.now() - fade.start) / 150
      const ctx = canvas.getContext('2d')!
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = clamp(remaining)
      ctx.drawImage(fade.image, 0, 0, fade.image.width, fade.image.height, 0, 0, canvas.width, canvas.height)
      ctx.restore()
    }
    drawRef.current = draw

    const captureAndFade = () => {
      if (canvas.width && canvas.height) {
        const copy = document.createElement('canvas')
        copy.width = canvas.width
        copy.height = canvas.height
        copy.getContext('2d')!.drawImage(canvas, 0, 0)
        fadeRef.current = { image: copy, start: performance.now() }
      }
      if (fadeRafRef.current !== null) cancelAnimationFrame(fadeRafRef.current)
      const step = () => {
        fadeRafRef.current = null
        draw()
        if (fadeRef.current && performance.now() - fadeRef.current.start < 150) {
          fadeRafRef.current = requestAnimationFrame(step)
        } else {
          fadeRef.current = null
          draw()
        }
      }
      fadeRafRef.current = requestAnimationFrame(step)
    }
    const media = getMedia()
    const redraw = () => draw()
    media?.addEventListener('load', redraw)
    if (media instanceof HTMLVideoElement) media.addEventListener('loadeddata', redraw)

    const resizeObserver = new ResizeObserver(() => {
      if (animated) sampleResultRef.current = null
      draw()
    })
    resizeObserver.observe(wrapper)

    let timer: number | null = null
    const key = `${settings.filter}|${settings.palette}`
    if (prevKeyRef.current && prevKeyRef.current !== key) captureAndFade()
    prevKeyRef.current = key
    timer = window.setTimeout(draw, 72)
    draw()

    return () => {
      if (timer !== null) window.clearTimeout(timer)
      resizeObserver.disconnect()
      media?.removeEventListener('load', redraw)
      if (media instanceof HTMLVideoElement) media.removeEventListener('loadeddata', redraw)
    }
  }, [settings, dark, animated])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const media = wrapper.querySelector('video') as HTMLVideoElement | null
    if (!media) return

    const loop = () => {
      videoRafRef.current = null
      if (visibleRef.current && !media.paused) drawRef.current()
      schedule()
    }
    const schedule = () => {
      if (media.paused || !visibleRef.current) return
      const rvfc = (media as any).requestVideoFrameCallback as ((cb: () => void) => number) | undefined
      if (typeof rvfc === 'function') {
        videoRafRef.current = rvfc.call(media, loop)
      } else {
        videoRafRef.current = requestAnimationFrame(loop)
      }
    }
    const cancelVideo = () => {
      if (videoRafRef.current === null) return
      const cancelVfc = (media as any).cancelVideoFrameCallback as ((id: number) => void) | undefined
      if (typeof cancelVfc === 'function') cancelVfc.call(media, videoRafRef.current)
      else cancelAnimationFrame(videoRafRef.current)
      videoRafRef.current = null
    }
    cancelVideoRef.current = cancelVideo
    const io = new IntersectionObserver((entries) => {
      visibleRef.current = entries[0]?.isIntersecting ?? true
      if (visibleRef.current) schedule()
      else cancelVideo()
    })
    io.observe(media)
    media.addEventListener('play', schedule)
    media.addEventListener('pause', schedule)
    schedule()

    return () => {
      io.disconnect()
      media.removeEventListener('play', schedule)
      media.removeEventListener('pause', schedule)
      cancelVideo()
    }
  }, [])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!animated || !wrapper) return
    const io = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(([entry]) => {
          animateVisibleRef.current = entry?.isIntersecting ?? true
        })
    io?.observe(wrapper)

    let raf: number | null = null
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 66 || !animateVisibleRef.current || document.hidden) return
      last = now
      phaseRef.current = now / 1000
      drawRef.current()
    }
    raf = requestAnimationFrame(tick)

    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
      io?.disconnect()
    }
  }, [animated])

  useEffect(() => () => {
    if (fadeRafRef.current !== null) cancelAnimationFrame(fadeRafRef.current)
    cancelVideoRef.current()
  }, [])

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: radius,
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          borderRadius: radius,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
