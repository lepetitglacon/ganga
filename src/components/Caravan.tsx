import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import {
  Material,
  Quaternion,
  SceneLoader,
  TransformNode,
  Vector3,
  type AbstractMesh,
} from '@babylonjs/core'
import type RAPIER from '@dimforge/rapier3d-compat'
import { getTerrainHeight, getTerrainNormal } from '@/game/terrain.ts'
import { gameStore } from '@/game/gameStore.ts'
import {
  CAMEL_FILE,
  CAMEL_HEADING_OFFSET,
  CAMEL_SPACING,
  CAMEL_TARGET_HEIGHT,
  CARAVAN_COUNT,
  CARAVAN_SPEED,
  LEAD_HITBOX_HALF,
  samplePath,
} from '@/game/caravan.ts'

// Shade a freshly loaded/cloned camel: force its materials opaque (some GLBs
// ship MASK + alpha 0, which discards every fragment — see Animals.tsx) and
// wire it into the shadow map.
function prepMeshes(meshes: AbstractMesh[]): void {
  const sg = gameStore.shadowGenerator
  for (const m of meshes) {
    const mat = m.material
    if (mat) {
      mat.transparencyMode = Material.MATERIAL_OPAQUE
      mat.alpha = 1
    }
    if (sg) sg.addShadowCaster(m)
    m.receiveShadows = true
  }
}

// Per-camel state: a carrier node and the vertical offset that puts its feet on
// the ground (lowest point of the model, in world units, below the carrier
// origin).
type Camel = { carrier: TransformNode; footOffset: number }

export const Caravan = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return
    let cancelled = false
    const camels: Camel[] = []
    const disposables: TransformNode[] = []
    let leadBody: RAPIER.RigidBody | null = null
    let observer: ReturnType<typeof scene.onBeforeRenderObservable.add> | null = null

    ;(async () => {
      const result = await SceneLoader.ImportMeshAsync(
        '',
        '/gltf/animals/',
        CAMEL_FILE,
        scene,
      )
      if (cancelled) {
        result.meshes.forEach((m) => m.dispose())
        return
      }

      const importedRoot = result.meshes[0]
      prepMeshes(result.meshes)

      // Normalize size from the imported bounding box; min.y * scale is the
      // distance from the carrier origin down to the camel's feet.
      const { min, max } = importedRoot.getHierarchyBoundingVectors(true)
      const height = Math.max(max.y - min.y, 1e-3)
      const scale = CAMEL_TARGET_HEIGHT / height
      const footOffset = min.y * scale

      // First camel parents the imported hierarchy; the rest are deep clones of
      // it. All share materials (clone doesn't duplicate them) — cheap.
      for (let i = 0; i < CARAVAN_COUNT; i++) {
        const carrier = new TransformNode(`camel-${i}`, scene)
        carrier.scaling.setAll(scale)
        carrier.rotationQuaternion = Quaternion.Identity()
        if (i === 0) {
          importedRoot.parent = carrier
        } else {
          const clone = importedRoot.clone(`camel-${i}-mesh`, null, false)
          if (clone) {
            clone.parent = carrier
            prepMeshes(clone.getChildMeshes(false))
          }
        }
        camels.push({ carrier, footOffset })
        disposables.push(carrier)
      }

      // The hitbox needs the physics world, which Map builds after the terrain
      // heightfield. Wait for it, then drop the lead camel's kinematic box.
      while (!gameStore.physics) {
        await new Promise((r) => setTimeout(r, 16))
        if (cancelled) return
      }
      leadBody = gameStore.physics.addKinematicBox(LEAD_HITBOX_HALF, 0, 0, 0)

      // Distance the lead camel has travelled along the trail. Camel i trails by
      // i * spacing.
      let leadDist = 0

      // Reused scratch so the per-frame work allocates nothing.
      const pos = new Vector3()
      const dir = new Vector3()
      const up = new Vector3()
      const right = new Vector3()
      const fwd = new Vector3()
      const euler = new Vector3()
      const qLocal = Quaternion.RotationAxis(Vector3.Up(), CAMEL_HEADING_OFFSET)

      observer = scene.onBeforeRenderObservable.add(() => {
        const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.1)
        leadDist += CARAVAN_SPEED * dt

        for (let i = 0; i < camels.length; i++) {
          const { carrier, footOffset } = camels[i]
          samplePath(leadDist - i * CAMEL_SPACING, pos, dir)
          if (dir.lengthSquared() < 1e-8) continue

          const groundY = getTerrainHeight(pos.x, pos.z)
          carrier.position.set(pos.x, groundY - footOffset, pos.z)

          // Orient: up = terrain normal (camel pitches/rolls with the dune),
          // forward = trail heading. Build an orthonormal left-handed basis and
          // fold in the model's heading offset.
          getTerrainNormal(pos.x, pos.z).normalizeToRef(up)
          Vector3.CrossToRef(up, dir, right)
          right.normalize()
          Vector3.CrossToRef(right, up, fwd)
          fwd.normalize()
          Vector3.RotationFromAxisToRef(right, up, fwd, euler)
          Quaternion.FromEulerVectorToRef(euler, carrier.rotationQuaternion!)
          if (CAMEL_HEADING_OFFSET !== 0) {
            carrier.rotationQuaternion!.multiplyInPlace(qLocal)
          }

          // Drag the lead camel's hitbox along, centered on its body and turned
          // to match its heading so the elongated box stays aligned in turns.
          if (i === 0 && leadBody) {
            leadBody.setNextKinematicTranslation({
              x: pos.x,
              y: groundY + LEAD_HITBOX_HALF.y,
              z: pos.z,
            })
            const q = carrier.rotationQuaternion!
            leadBody.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          }
        }
      })
    })()

    return () => {
      cancelled = true
      if (observer) scene.onBeforeRenderObservable.remove(observer)
      if (leadBody && gameStore.physics) gameStore.physics.removeBody(leadBody)
      disposables.forEach((c) => c.dispose(false, true))
    }
  }, [scene])

  return null
}
