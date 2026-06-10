import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import { SceneLoader, TransformNode, Quaternion } from '@babylonjs/core'
import '@babylonjs/loaders/glTF'
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from '@/game/physics.ts'
import { gameStore } from '@/game/gameStore.ts'
import { getDuneHeight } from '@/game/terrain.ts'

// The bird, standing idle at the centre of the LandingScene for the camera to
// orbit. Unlike the in-game Player this carries no physics, controls, or flight
// logic — it just loads the GLB, rests it on the dune at the origin, casts a
// shadow, and loops the standing-idle animation.

// Match the in-game resting height: the capsule's bottom sits on the ground, so
// the visual origin is half-height + radius above it.
const REST_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS
// A gentle 3/4 turn so the bird isn't dead-on to the camera's starting angle.
const FACING_YAW = Math.PI * 0.25

export const LandingBird = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return
    let cancelled = false
    let carrier: TransformNode | null = null

    SceneLoader.ImportMeshAsync('', '/gltf/', 'bird.glb', scene)
      .then((result) => {
        if (cancelled) {
          result.meshes.forEach((m) => m.dispose())
          return
        }

        const importedRoot = result.meshes[0]
        carrier = new TransformNode('landingBird', scene)
        carrier.position.set(0, getDuneHeight(0, 0) + REST_OFFSET, 0)
        carrier.rotationQuaternion = Quaternion.RotationYawPitchRoll(FACING_YAW, 0, 0)
        importedRoot.parent = carrier
        importedRoot.position.set(0, 0, 0)

        const sg = gameStore.shadowGenerator
        for (const m of result.meshes) {
          if (sg) sg.addShadowCaster(m)
          m.receiveShadows = true
        }

        // Play only the standing-idle pose; stop the rest so wings don't flap.
        for (const g of result.animationGroups) g.stop()
        const idle =
          result.animationGroups.find((g) => /walking-idle/i.test(g.name)) ??
          result.animationGroups.find((g) => /idle/i.test(g.name))
        idle?.start(true)
      })
      .catch(console.error)

    return () => {
      cancelled = true
      carrier?.dispose(false, true)
    }
  }, [scene])

  return null
}
