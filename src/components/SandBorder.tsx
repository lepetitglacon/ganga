import { useEffect, useRef } from 'react'

// A self-contained sand-in-the-wind effect drawn on a <canvas> overlaid on its
// parent. Grains spawn along the parent's border, get pushed by a steady wind
// plus per-grain turbulence, and fade in/out over their lifetime. The canvas is
// sized to the parent + MARGIN so grains can drift past the edges; the parent
// must be position: relative and overflow: visible.

type Grain = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  seed: number
}

type Props = {
  /** Grain colour as an "r, g, b" string. Defaults to a warm desert sand. */
  color?: string
  /** Horizontal wind in px/s. Negative blows leftward. */
  wind?: number
  /** Grains emitted per second. */
  spawnRate?: number
  /** How far (px) the canvas extends past the box so grains can drift out. */
  margin?: number
}

export const SandBorder = ({
  color = '225, 198, 145',
  wind = 55,
  spawnRate = 90,
  margin = 28,
}: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    const ctx = canvas.getContext('2d')
    if (!parent || !ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const grains: Grain[] = []
    let w = 0
    let h = 0

    const resize = () => {
      const r = parent.getBoundingClientRect()
      w = r.width + margin * 2
      h = r.height + margin * 2
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(parent)
    resize()

    // Drop a grain at a random point along the inner border rectangle (the box
    // edge), nudged slightly off the edge so it reads as detaching from it.
    const spawn = () => {
      const l = margin
      const t = margin
      const right = w - margin
      const bottom = h - margin
      const top = right - l
      const side = bottom - t
      const perim = 2 * (top + side)
      const d = Math.random() * perim
      let x: number
      let y: number
      if (d < top) {
        x = l + d
        y = t
      } else if (d < top + side) {
        x = right
        y = t + (d - top)
      } else if (d < 2 * top + side) {
        x = right - (d - top - side)
        y = bottom
      } else {
        x = l
        y = bottom - (d - 2 * top - side)
      }
      grains.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: wind * (0.5 + Math.random()),
        vy: -10 + Math.random() * 20,
        life: 0,
        maxLife: 0.8 + Math.random() * 1.3,
        size: 0.6 + Math.random() * 1.7,
        seed: Math.random() * 1000,
      })
    }

    let raf = 0
    let last = performance.now()
    let acc = 0
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      acc += dt * spawnRate
      while (acc >= 1) {
        spawn()
        acc -= 1
      }

      ctx.clearRect(0, 0, w, h)
      for (let i = grains.length - 1; i >= 0; i--) {
        const g = grains[i]
        g.life += dt
        if (g.life >= g.maxLife) {
          grains.splice(i, 1)
          continue
        }
        // Steady wind + a little swirling turbulence.
        g.x += (g.vx + Math.sin((g.life + g.seed) * 6) * 12) * dt
        g.y += (g.vy + Math.sin((g.life + g.seed) * 4) * 8) * dt
        const t = g.life / g.maxLife
        const alpha = Math.sin(t * Math.PI) * 0.7 // fade in then out
        ctx.fillStyle = `rgba(${color}, ${alpha})`
        ctx.fillRect(g.x, g.y, g.size, g.size)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [color, wind, spawnRate, margin])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: -28, // = -margin
        left: -28,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}
