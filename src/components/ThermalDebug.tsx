import { useCallback, useRef } from 'react'
import { useScene } from 'react-babylonjs'
import {
  Color4,
  MeshBuilder,
  Vector3,
  type LinesMesh,
} from '@babylonjs/core'
import {
  TERRAIN_SIZE,
  getTerrainHeight,
  getTerrainNormal,
} from '@/game/terrain.ts'
import { SUN_DIR } from '@/game/world.ts'
import { useDebug } from '@/hooks/useDebug.ts'

// Tunables — same logic as the Player thermal sampler, just visualised.
const SAMPLE_STEP = 14 // m between probes (terrain-wide grid)
const SLOPE_THRESHOLD = 0.04
const MIN_STRENGTH = 0.02 // ignore very weak thermals to keep the overlay readable

// Each probe draws a vertical line whose length scales with strength,
// with a warm-color gradient (yellow tip on the strongest). Lengths scale
// with the new ±75 m dunes so they stay readable.
const MAX_LINE_LENGTH = 45

export const ThermalDebug = () => {
  const scene = useScene()
  const meshRef = useRef<LinesMesh | null>(null)

  useDebug(
    'ground',
    useCallback(
      (on: boolean) => {
        if (!on) {
          meshRef.current?.dispose()
          meshRef.current = null
          return
        }
        if (!scene || meshRef.current) return

        const half = TERRAIN_SIZE / 2
        const lines: Vector3[][] = []
        const colors: Color4[][] = []
        for (let x = -half; x <= half; x += SAMPLE_STEP) {
          for (let z = -half; z <= half; z += SAMPLE_STEP) {
            const normal = getTerrainNormal(x, z, 3)
            const facing = Vector3.Dot(normal, SUN_DIR)
            if (facing <= 0) continue
            const slope = 1 - normal.y
            if (slope <= SLOPE_THRESHOLD) continue
            const strength = facing * slope
            if (strength < MIN_STRENGTH) continue
            const y = getTerrainHeight(x, z)
            const len = 1.5 + strength * MAX_LINE_LENGTH
            lines.push([
              new Vector3(x, y + 0.3, z),
              new Vector3(x, y + 0.3 + len, z),
            ])
            const a = 0.35 + strength * 0.65
            colors.push([
              new Color4(1.0, 0.45, 0.1, a),
              new Color4(1.0, 0.95, 0.55, a),
            ])
          }
        }
        if (lines.length === 0) return
        const ls = MeshBuilder.CreateLineSystem(
          'thermalDebug',
          { lines, colors, useVertexAlpha: true },
          scene
        )
        ls.isPickable = false
        ls.applyFog = false
        meshRef.current = ls
      },
      [scene]
    )
  )

  return null
}
