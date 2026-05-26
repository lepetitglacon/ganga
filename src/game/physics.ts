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

  constructor(terrainHeights: Float32Array) {
    this.world = new RAPIER.World(GRAVITY)
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
  }

  createPlayerBody(x: number, y: number, z: number): void {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .lockRotations()
    this.playerBody = this.world.createRigidBody(desc)
    this.world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      this.playerBody
    )
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
