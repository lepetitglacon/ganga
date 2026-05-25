import { useRef, useCallback } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import { MeshBuilder, Color3, Vector3, type LinesMesh } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import { useDebug } from '@/hooks/useDebug.ts'

export const PhysicsDebug = () => {
  const scene = useScene()
  const debugRef = useRef<LinesMesh | null>(null)
  // Ref, not state: useBeforeRender captures its closure on first render and
  // would never see a state update. The ref is read fresh every frame.
  const enabledRef = useRef(false)

  useDebug(
    useCallback((on: boolean) => {
      enabledRef.current = on
      if (!on) {
        debugRef.current?.dispose()
        debugRef.current = null
      }
    }, [])
  )

  useBeforeRender(() => {
    if (!scene || !enabledRef.current) return
    const physics = gameStore.physics
    if (!physics) return

    const { vertices } = physics.world.debugRender()
    const lines: Vector3[][] = []
    for (let i = 0; i < vertices.length; i += 6) {
      lines.push([
        new Vector3(vertices[i], vertices[i + 1], vertices[i + 2]),
        new Vector3(vertices[i + 3], vertices[i + 4], vertices[i + 5]),
      ])
    }
    if (lines.length === 0) return

    if (!debugRef.current) {
      debugRef.current = MeshBuilder.CreateLineSystem(
        'physicsDebug',
        { lines, updatable: true },
        scene
      ) as LinesMesh
      debugRef.current.color = new Color3(0, 1, 0)
    } else {
      MeshBuilder.CreateLineSystem('physicsDebug', {
        lines,
        updatable: true,
        instance: debugRef.current,
      }, scene)
    }
  })

  return null
}
