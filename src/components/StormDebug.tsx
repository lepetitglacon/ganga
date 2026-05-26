import { useCallback, useRef } from 'react'
import { useScene } from 'react-babylonjs'
import { Color4, MeshBuilder, Vector3, type LinesMesh } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import { shellRadiusAt } from '@/game/storm.ts'
import { useDebug } from '@/hooks/useDebug.ts'

// Visualise the storm wind force field and the wall band itself. Arrows
// live on the wall midline and point in the direction `applyStormForce`
// would push at that spot. Two wireframe truncated cones outline the
// inner / outer surfaces of the dense ring so you can see whether the
// bird is inside the force zone.
const HEIGHT_LAYERS = 6
const ANGULAR_SAMPLES = 24
const WALL_RING_LAYERS = 10 // horizontal rings drawn along the cone height
const WALL_RING_SEGMENTS = 48 // segments per ring (smooth circle)
const WALL_VERTICAL_RIBS = 16 // vertical lines connecting top to bottom
const ACCEL_SCALE = 0.08 // m of arrow per m/s²
const ARROW_HEAD = 1.5 // m — small "V" at the tip

export const StormDebug = () => {
  const scene = useScene()
  const meshRef = useRef<LinesMesh | null>(null)

  useDebug(
    useCallback(
      (on: boolean) => {
        if (!on) {
          meshRef.current?.dispose()
          meshRef.current = null
          return
        }
        if (!scene || meshRef.current) return
        if (gameStore.storms.length === 0) return

        const lines: Vector3[][] = []
        const colors: Color4[][] = []

        for (const storm of gameStore.storms) {
          // --- Wall surfaces: inner (r - half) and outer (r + half) cones ---
          const half = storm.wallThickness / 2
          const drawSurface = (offset: number, color: Color4) => {
            // Horizontal rings at evenly spaced heights.
            for (let h = 0; h <= WALL_RING_LAYERS; h++) {
              const relY = (h / WALL_RING_LAYERS) * storm.height
              const r = shellRadiusAt(storm, relY) + offset
              const y = storm.center.y + relY
              const ringPts: Vector3[] = []
              const ringCols: Color4[] = []
              for (let s = 0; s <= WALL_RING_SEGMENTS; s++) {
                const theta = (s / WALL_RING_SEGMENTS) * Math.PI * 2
                ringPts.push(
                  new Vector3(
                    storm.center.x + Math.cos(theta) * r,
                    y,
                    storm.center.z + Math.sin(theta) * r,
                  ),
                )
                ringCols.push(color)
              }
              for (let s = 0; s < WALL_RING_SEGMENTS; s++) {
                lines.push([ringPts[s], ringPts[s + 1]])
                colors.push([ringCols[s], ringCols[s + 1]])
              }
            }
            // Vertical ribs from base to top.
            for (let s = 0; s < WALL_VERTICAL_RIBS; s++) {
              const theta = (s / WALL_VERTICAL_RIBS) * Math.PI * 2
              const cos = Math.cos(theta)
              const sin = Math.sin(theta)
              for (let h = 0; h < WALL_RING_LAYERS; h++) {
                const relY0 = (h / WALL_RING_LAYERS) * storm.height
                const relY1 = ((h + 1) / WALL_RING_LAYERS) * storm.height
                const r0 = shellRadiusAt(storm, relY0) + offset
                const r1 = shellRadiusAt(storm, relY1) + offset
                lines.push([
                  new Vector3(
                    storm.center.x + cos * r0,
                    storm.center.y + relY0,
                    storm.center.z + sin * r0,
                  ),
                  new Vector3(
                    storm.center.x + cos * r1,
                    storm.center.y + relY1,
                    storm.center.z + sin * r1,
                  ),
                ])
                colors.push([color, color])
              }
            }
          }
          // Inner = cyan (eye side), outer = magenta (free air side).
          drawSurface(-half, new Color4(0.2, 0.9, 1.0, 0.5))
          drawSurface(half, new Color4(1.0, 0.3, 0.9, 0.5))

          for (let h = 0; h < HEIGHT_LAYERS; h++) {
            const relY = ((h + 0.5) / HEIGHT_LAYERS) * storm.height
            const r = shellRadiusAt(storm, relY)
            const y = storm.center.y + relY
            for (let a = 0; a < ANGULAR_SAMPLES; a++) {
              const theta = (a / ANGULAR_SAMPLES) * Math.PI * 2
              const cos = Math.cos(theta)
              const sin = Math.sin(theta)
              const x = storm.center.x + cos * r
              const z = storm.center.z + sin * r
              // Same math as applyStormForce, but without dt.
              const rx = cos
              const rz = sin
              const tx = rz
              const tz = -rx
              const ax = tx * storm.windSpeed + rx * storm.outwardAccel
              const az = tz * storm.windSpeed + rz * storm.outwardAccel
              const mag = Math.hypot(ax, az)
              if (mag < 1e-3) continue
              const len = mag * ACCEL_SCALE
              const dx = (ax / mag) * len
              const dz = (az / mag) * len
              const start = new Vector3(x, y, z)
              const end = new Vector3(x + dx, y, z + dz)
              // Color: red intensity from outward push, green from wind.
              // Alpha brightens with magnitude so weak spots fade out.
              const tStrength = Math.min(1, mag / 200)
              const cStart = new Color4(0.2, 1.0, 0.3, 0.35 + 0.5 * tStrength)
              const cEnd = new Color4(1.0, 0.3, 0.2, 0.5 + 0.5 * tStrength)
              lines.push([start, end])
              colors.push([cStart, cEnd])
              // Arrow head: two small lines forming a V at the tip.
              const perpX = -dz / len
              const perpZ = dx / len
              const backX = end.x - (dx / len) * ARROW_HEAD
              const backZ = end.z - (dz / len) * ARROW_HEAD
              const headA = new Vector3(
                backX + perpX * ARROW_HEAD * 0.6,
                y,
                backZ + perpZ * ARROW_HEAD * 0.6,
              )
              const headB = new Vector3(
                backX - perpX * ARROW_HEAD * 0.6,
                y,
                backZ - perpZ * ARROW_HEAD * 0.6,
              )
              lines.push([end, headA], [end, headB])
              colors.push([cEnd, cEnd], [cEnd, cEnd])
            }
          }
        }

        if (lines.length === 0) return
        const ls = MeshBuilder.CreateLineSystem(
          'stormDebug',
          { lines, colors, useVertexAlpha: true },
          scene,
        )
        ls.isPickable = false
        ls.applyFog = false
        meshRef.current = ls
      },
      [scene],
    ),
  )

  return null
}
