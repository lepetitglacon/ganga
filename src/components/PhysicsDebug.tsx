import { useCallback, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  type LinesMesh,
  type Mesh,
} from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from '@/game/physics.ts'
import { TERRAIN_SIZE, TERRAIN_SUBDIVISIONS } from '@/game/terrain.ts'
import { useDebug } from '@/hooks/useDebug.ts'

// Visualises the physics world in three independently-togglable layers:
//  - 'physics': the player's capsule body (only physics element that isn't ground or a static mesh)
//  - 'ground':  the terrain heightfield wireframe
//  - 'mesh':    every static trimesh collider baked from a Place GLB
export const PhysicsDebug = () => {
  const scene = useScene()
  const capsuleRef = useRef<Mesh | null>(null)
  const groundRef = useRef<LinesMesh | null>(null)
  const trimeshRef = useRef<LinesMesh | null>(null)

  // --- Player capsule ('physics') ---
  useDebug(
    'physics',
    useCallback(
      (on: boolean) => {
        if (!on) {
          capsuleRef.current?.material?.dispose()
          capsuleRef.current?.dispose()
          capsuleRef.current = null
          return
        }
        if (!scene || capsuleRef.current) return
        const m = MeshBuilder.CreateCapsule(
          'physicsCapsuleDebug',
          {
            radius: CAPSULE_RADIUS,
            height: CAPSULE_HALF_HEIGHT * 2 + CAPSULE_RADIUS * 2,
            tessellation: 16,
            subdivisions: 4,
          },
          scene,
        )
        const mat = new StandardMaterial('physicsCapsuleDebug-mat', scene)
        mat.wireframe = true
        mat.emissiveColor = new Color3(0.2, 1, 0.3)
        mat.disableLighting = true
        m.material = mat
        m.isPickable = false
        capsuleRef.current = m
      },
      [scene],
    ),
  )

  useBeforeRender(() => {
    const c = capsuleRef.current
    const body = gameStore.physics?.playerBody
    if (!c || !body) return
    const t = body.translation()
    c.position.set(t.x, t.y, t.z)
  })

  // --- Heightfield wireframe ('ground') ---
  useDebug(
    'ground',
    useCallback(
      (on: boolean) => {
        if (!on) {
          groundRef.current?.dispose()
          groundRef.current = null
          return
        }
        if (!scene || groundRef.current) return
        const physics = gameStore.physics
        if (!physics) return

        const N = TERRAIN_SUBDIVISIONS
        const S = TERRAIN_SIZE
        const heights = physics.terrainHeights
        // Heightfield grid: walk the (N+1)×(N+1) sample lattice and draw the
        // horizontal + vertical edges. Skip every other cell to keep the line
        // count manageable at 192² subdivisions.
        const STEP = 2
        const half = S / 2
        const lines: Vector3[][] = []
        const yAt = (i: number, j: number) => heights[i * (N + 1) + j]
        const posAt = (i: number, j: number) =>
          new Vector3(-half + (j / N) * S, yAt(i, j), -half + (i / N) * S)
        for (let i = 0; i <= N; i += STEP) {
          for (let j = 0; j <= N; j += STEP) {
            if (j + STEP <= N) lines.push([posAt(i, j), posAt(i, j + STEP)])
            if (i + STEP <= N) lines.push([posAt(i, j), posAt(i + STEP, j)])
          }
        }
        const ls = MeshBuilder.CreateLineSystem('groundPhysicsDebug', { lines }, scene)
        ls.color = new Color3(0.3, 0.8, 1)
        ls.isPickable = false
        ls.applyFog = false
        groundRef.current = ls
      },
      [scene],
    ),
  )

  // --- Static trimeshes ('mesh') ---
  useDebug(
    'mesh',
    useCallback(
      (on: boolean) => {
        if (!on) {
          trimeshRef.current?.dispose()
          trimeshRef.current = null
          return
        }
        if (!scene || trimeshRef.current) return
        const physics = gameStore.physics
        if (!physics || physics.staticTrimeshes.length === 0) return

        const lines: Vector3[][] = []
        for (const { vertices, indices } of physics.staticTrimeshes) {
          for (let i = 0; i < indices.length; i += 3) {
            const a = indices[i] * 3
            const b = indices[i + 1] * 3
            const c = indices[i + 2] * 3
            const va = new Vector3(vertices[a], vertices[a + 1], vertices[a + 2])
            const vb = new Vector3(vertices[b], vertices[b + 1], vertices[b + 2])
            const vc = new Vector3(vertices[c], vertices[c + 1], vertices[c + 2])
            lines.push([va, vb], [vb, vc], [vc, va])
          }
        }
        if (lines.length === 0) return
        const ls = MeshBuilder.CreateLineSystem('meshPhysicsDebug', { lines }, scene)
        ls.color = new Color3(1, 0.5, 0.2)
        ls.isPickable = false
        ls.applyFog = false
        trimeshRef.current = ls
      },
      [scene],
    ),
  )

  return null
}
