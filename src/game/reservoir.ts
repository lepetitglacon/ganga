// Village water reservoirs. Each reservoir GLB node is an empty named
// "Reservoir" (the trigger hitbox) holding two child meshes:
//   - "mesh"  : the bowl/walls — baked into a static trimesh by Map.tsx.
//   - "water" : a flat surface whose height represents the fill level.
//
// When the bird perches inside a reservoir's footprint it pours its own
// hydration into the reservoir, raising the fill (0..1). The water mesh is
// lerped between its authored base height and the top of the bowl's bounding
// box, and wears the same shader as the oasis water.

import {
  Vector3,
  type AbstractMesh,
  type Node,
  type ShaderMaterial,
} from '@babylonjs/core'
import { gameStore } from './gameStore.ts'
import { completeQuest } from './quests.ts'
import { addProgress } from './achievements.ts'

export type Reservoir = {
  name: string
  // The water-level mesh, detached from the GLB hierarchy so its world Y can
  // be driven directly by the lerp below.
  waterMesh: AbstractMesh
  // World-space XZ footprint of the bowl — the trigger hitbox.
  min: Vector3
  max: Vector3
  // Water mesh world Y when empty (authored position) and full (bowl top).
  baseY: number
  topY: number
  // Current fill, 0..1.
  fill: number
  // Latched once the reservoir first reaches 100%, so the celebration only
  // fires a single time.
  completed: boolean
}

export const RESERVOIRS: Reservoir[] = []

// How many full bird reserves (gameStore.water = 1) it takes to fill an empty
// reservoir, and how fast the bird pours while perched (reserve units / second).
// The reservoir holds exactly one full bird reserve. A single perch can't top it
// up, though: the bird bleeds water on the flight home (drain + flaps), so it
// arrives with ~1/3 of a load each run — making the quest ~3 round-trips.
const RESERVOIR_CAPACITY = 1
const TRANSFER_RATE = 0.4

// Finds every "Reservoir" empty under `root`, wires up its water/mesh children
// and registers it. The water mesh is detached from the hierarchy (keeping its
// world transform) so we own its vertical position, and gets the shared oasis
// water material.
export function registerReservoirs(root: Node, waterMat: ShaderMaterial): void {
  const empties = root
    .getDescendants(false)
    .filter((n) => /^Reservoir/i.test(n.name))

  for (const empty of empties) {
    const descendants = empty.getDescendants(false)
    const waterMesh = descendants.find((n) => /^water/i.test(n.name)) as
      | AbstractMesh
      | undefined
    const bodyMesh = descendants.find((n) => /^mesh/i.test(n.name)) as
      | AbstractMesh
      | undefined
    if (!waterMesh || !bodyMesh) continue

    // Bowl bounds give the hitbox footprint (XZ) and the full-water top (Y).
    bodyMesh.computeWorldMatrix(true)
    const { min, max } = bodyMesh.getHierarchyBoundingVectors(true)

    waterMesh.computeWorldMatrix(true)
    const baseY = waterMesh.getAbsolutePosition().y
    // setParent(null) preserves the world transform, after which position.y is
    // a plain world-space height we can lerp.
    waterMesh.setParent(null)
    waterMesh.material = waterMat
    waterMesh.isPickable = false
    waterMesh.applyFog = false

    // Restored from a save where the reservoir quest is already done: register
    // it full and pre-positioned so it doesn't need filling (and won't re-fire
    // the celebration, since reservoirJustFilled stays false).
    const startFull = gameStore.reservoirsStartFilled
    const fill = startFull ? 1 : 0
    if (startFull) waterMesh.position.y = max.y

    RESERVOIRS.push({
      name: empty.name,
      waterMesh,
      min: min.clone(),
      max: max.clone(),
      baseY,
      topY: max.y,
      fill,
      completed: startFull,
    })
  }
}

// Pours the bird's hydration into any reservoir it's perched in and updates
// every reservoir's water height. Returns true while a transfer is happening.
export function updateReservoirs(
  pos: { x: number; y: number; z: number },
  grounded: boolean,
  dt: number,
): boolean {
  let transferring = false
  for (const r of RESERVOIRS) {
    const inside =
      grounded &&
      pos.x >= r.min.x &&
      pos.x <= r.max.x &&
      pos.z >= r.min.z &&
      pos.z <= r.max.z
    if (inside && gameStore.water > 0 && r.fill < 1) {
      const amount = Math.min(
        TRANSFER_RATE * dt,
        gameStore.water,
        (1 - r.fill) * RESERVOIR_CAPACITY,
      )
      gameStore.water -= amount
      r.fill = Math.min(1, r.fill + amount / RESERVOIR_CAPACITY)
      addProgress('water-carried', amount)
      transferring = true
      // First time this reservoir tops off: fire the village celebration once.
      if (!r.completed && r.fill >= 1) {
        r.completed = true
        gameStore.reservoirJustFilled = true
        completeQuest('fill-reservoir')
      }
    }
    r.waterMesh.position.y = r.baseY + (r.topY - r.baseY) * r.fill
  }
  return transferring
}

export function clearReservoirs(): void {
  for (const r of RESERVOIRS) r.waterMesh.dispose()
  RESERVOIRS.length = 0
}
