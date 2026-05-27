import { useCallback, useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import { Color3, MeshBuilder, Vector3, type LinesMesh } from '@babylonjs/core'
import { PLACES, type Place } from '@/game/places.ts'
import { gameStore } from '@/game/gameStore.ts'
import { audio } from '@/game/audio.ts'
import { useDebug } from '@/hooks/useDebug.ts'

// One non-spatial ambient sound layer per Place that defines `ambientSound`.
// Each layer fades in while the player's XZ position is inside the place's
// world-space bounding box and fades out when they leave.
const FADE_RATE = 1.8 // per-second blend toward target volume
// Vertical span of the debug bbox box (it's an XZ rectangle in the game, but
// we draw it as a tall box so it's visible from the air).
const DEBUG_BOX_HEIGHT = 80

type Layer = {
  place: Place
  ctl: { setVolume: (v: number) => void }
  current: number
}

export const PlaceAmbience = () => {
  const scene = useScene()
  const layersRef = useRef<Layer[]>([])
  const debugLinesRef = useRef<LinesMesh | null>(null)

  useEffect(() => {
    for (const place of PLACES) {
      if (!place.ambientSound) continue
      const ctl = audio.loop(place.ambientSound, { volume: 0 })
      layersRef.current.push({ place, ctl, current: 0 })
    }
    return () => {
      for (const l of layersRef.current) l.ctl.setVolume(0)
      layersRef.current = []
    }
  }, [])

  // 'sound' debug: outline the XZ bbox of every place with an ambient sound.
  useDebug(
    'sound',
    useCallback(
      (on: boolean) => {
        if (!on) {
          debugLinesRef.current?.dispose()
          debugLinesRef.current = null
          return
        }
        if (!scene || debugLinesRef.current) return

        const lines: Vector3[][] = []
        for (const place of PLACES) {
          if (!place.ambientSound || !place.bbox) continue
          const { minX, maxX, minZ, maxZ } = place.bbox
          const y0 = place.groundY
          const y1 = place.groundY + DEBUG_BOX_HEIGHT
          const corners = [
            new Vector3(minX, y0, minZ),
            new Vector3(maxX, y0, minZ),
            new Vector3(maxX, y0, maxZ),
            new Vector3(minX, y0, maxZ),
            new Vector3(minX, y1, minZ),
            new Vector3(maxX, y1, minZ),
            new Vector3(maxX, y1, maxZ),
            new Vector3(minX, y1, maxZ),
          ]
          for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4
            lines.push([corners[i], corners[j]])
            lines.push([corners[i + 4], corners[j + 4]])
            lines.push([corners[i], corners[i + 4]])
          }
        }
        if (lines.length === 0) return
        const ls = MeshBuilder.CreateLineSystem('placeAmbienceDebug', { lines }, scene)
        ls.color = new Color3(0.4, 1, 0.6)
        ls.isPickable = false
        ls.applyFog = false
        debugLinesRef.current = ls
      },
      [scene],
    ),
  )

  useBeforeRender(() => {
    const body = gameStore.physics?.playerBody
    if (!body || !scene) return
    const t = body.translation()
    const dt = (scene.getEngine().getDeltaTime() / 1000) || 0
    const blend = Math.min(1, dt * FADE_RATE)
    for (const l of layersRef.current) {
      const b = l.place.bbox
      const inside =
        !!b && t.x >= b.minX && t.x <= b.maxX && t.z >= b.minZ && t.z <= b.maxZ
      const target = inside ? l.place.ambientVolume ?? 0.6 : 0
      l.current += (target - l.current) * blend
      l.ctl.setVolume(l.current)
    }
  })

  return null
}
