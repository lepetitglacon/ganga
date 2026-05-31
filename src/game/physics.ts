import RAPIER from '@dimforge/rapier3d-compat'
import { TERRAIN_SIZE, TERRAIN_SUBDIVISIONS } from './terrain.ts'

const GRAVITY = { x: 0, y: -9.81, z: 0 }

let initPromise: Promise<void> | null = null
export const initRapier = (): Promise<void> => {
  if (!initPromise) initPromise = RAPIER.init()
  return initPromise
}

export const CAPSULE_HALF_HEIGHT = 0.7
export const CAPSULE_RADIUS = 0.6

export class PhysicsWorld {
  world: RAPIER.World
  playerBody: RAPIER.RigidBody | null = null
  // Source data kept around purely for debug visualization. The heightfield
  // grid is drawn from `terrainHeights`; each static place collider has its
  // world-space vertices/indices stored on `staticTrimeshes`.
  terrainHeights: Float32Array
  staticTrimeshes: { vertices: Float32Array; indices: Uint32Array }[] = []

  constructor(terrainHeights: Float32Array) {
    this.world = new RAPIER.World(GRAVITY)
    this.terrainHeights = terrainHeights
    const N = TERRAIN_SUBDIVISIONS
    const S = TERRAIN_SIZE
    const groundBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    this.world.createCollider(
      RAPIER.ColliderDesc.heightfield(N, N, terrainHeights, { x: S, y: 1, z: S }),
      groundBody
    )
  }

  addStaticTrimesh(vertices: Float32Array, indices: Uint32Array): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices), body)
    this.staticTrimeshes.push({ vertices, indices })
  }

  // Moving collision box driven from a script (e.g. the lead caravan camel).
  // Position-based kinematic bodies push the dynamic player out of the way but
  // are never pushed back; call setNextKinematicTranslation() each frame to
  // walk it along. Returns the body so the caller can move and later remove it.
  addKinematicBox(
    half: { x: number; y: number; z: number },
    x: number,
    y: number,
    z: number,
  ): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
    )
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z),
      body,
    )
    return body
  }

  removeBody(body: RAPIER.RigidBody): void {
    this.world.removeRigidBody(body)
  }

  createPlayerBody(x: number, y: number, z: number): void {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .lockRotations()
      // Continuous collision detection: free-fall dives can reach high speeds,
      // and without CCD the body could tunnel through the terrain between steps.
      .setCcdEnabled(true)
    this.playerBody = this.world.createRigidBody(desc)
    this.world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      this.playerBody
    )
  }

  // Cast a ray from `origin` along (unit) `dir`. Returns the hit distance
  // (== time-of-impact for a unit dir) or null if nothing was hit within
  // maxDist. Filters out the player so we don't self-hit.
  raycast(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist: number,
  ): number | null {
    const ray = new RAPIER.Ray(origin, dir)
    const hit = this.world.castRay(
      ray,
      maxDist,
      true,
      undefined,
      undefined,
      undefined,
      this.playerBody ?? undefined,
    )
    return hit ? hit.timeOfImpact : null
  }

  isNearGround(margin = 0.6): boolean {
    if (!this.playerBody) return false
    const t = this.playerBody.translation()
    const ray = new RAPIER.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 })
    const hit = this.world.castRay(
      ray,
      CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + margin,
      true,
      undefined,
      undefined,
      undefined,
      this.playerBody
    )
    return hit !== null
  }

  step(dt: number): void {
    this.world.timestep = dt
    this.world.step()
  }

  dispose(): void {
    this.world.free()
    this.playerBody = null
  }
}
