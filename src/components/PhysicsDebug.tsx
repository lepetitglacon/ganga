import { useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import { MeshBuilder, Color3, Vector3, type LinesMesh } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'

export const PhysicsDebug = () => {
  const scene = useScene()
  const debugRef = useRef<LinesMesh | null>(null)
  const enabledRef = useRef(false)

  useEffect(() => {
    if (!scene) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.code !== 'KeyD') return
      e.preventDefault()
      enabledRef.current = !enabledRef.current
      if (!enabledRef.current) {
        debugRef.current?.dispose()
        debugRef.current = null
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scene])

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
