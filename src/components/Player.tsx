import { useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import {
  SceneLoader,
  Vector3,
  Quaternion,
  TransformNode,
  TrailMesh,
  StandardMaterial,
  Color3,
} from '@babylonjs/core'
import '@babylonjs/loaders/glTF'
import {
  initRapier,
  PhysicsWorld,
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
} from '@/game/physics.ts'
import { gameStore } from '@/game/gameStore.ts'
import { useKeyboard } from '@/hooks/useKeyboard.ts'
import { getTerrainHeight } from '@/game/terrain.ts'
import { terrainHeights } from '@/components/Terrain.tsx'

// Horizon = level flight. camBeta is measured from +Y, so π/2 is horizontal.
// Looking up (camBeta > π/2) climbs, looking down (camBeta < π/2) dives.
const FLIGHT_HORIZON_BETA = Math.PI / 2

const WALK_SPEED = 4
const FLIGHT_SPEED = 14
const TAKEOFF_COOLDOWN = 0.5

// Feather-style float
const BANK_PER_YAW_RATE = 0.9 // how hard the bird rolls into turns
const MAX_BANK = Math.PI / 3
const BOB_AMPLITUDE = 0.18 // meters of vertical sway
const BOB_FREQUENCY = 0.6 // Hz
const ORIENT_SMOOTHING = 4.5 // lower = floatier rotation

function makeSpawn(): Vector3 {
  const groundY = getTerrainHeight(0, 0)
  return new Vector3(0, groundY + CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 1, 0)
}

export const Player = () => {
  const scene = useScene()
  const keys = useKeyboard()
  const lastTimeRef = useRef(performance.now())
  const takeoffCooldownRef = useRef(0)
  const prevYawRef = useRef(0)
  const bankRef = useRef(0)
  const flightTimeRef = useRef(0)

  useEffect(() => {
    if (!scene) return
    let cancelled = false

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      if (gameStore.birdMode === 'grounded') {
        gameStore.birdMode = 'flying'
        takeoffCooldownRef.current = TAKEOFF_COOLDOWN
        const body = gameStore.physics?.playerBody
        if (body) {
          // Disable gravity so vertical input is the sole driver of climb/dive.
          body.setGravityScale(0, true)
          body.setLinvel({ x: 0, y: 6, z: 0 }, true)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)

    const setup = async () => {
      await initRapier()
      if (cancelled) return

      const spawn = makeSpawn()

      const result = await SceneLoader.ImportMeshAsync(
        '',
        '/gltf/',
        'bird.glb',
        scene
      )
      if (cancelled) {
        result.meshes.forEach((m) => m.dispose())
        return
      }

      // The GLB __root__ has baked transforms (handedness flip) that fight
      // our rotation. Wrap it in a clean carrier we fully own.
      const importedRoot = result.meshes[0]
      const carrier = new TransformNode('birdCarrier', scene)
      carrier.position.copyFrom(spawn)
      carrier.rotationQuaternion = Quaternion.Identity()
      importedRoot.parent = carrier
      importedRoot.position.set(0, 0, 0)

      // Shadow casters
      const sg = gameStore.shadowGenerator
      if (sg) result.meshes.forEach((m) => sg.addShadowCaster(m))

      gameStore.mesh = carrier

      // Wing-tip trails (Feather-style). Compute tip offsets from the
      // mesh's local AABB so it works regardless of model scale.
      const bbox = importedRoot.getHierarchyBoundingVectors(true)
      const sizeX = bbox.max.x - bbox.min.x
      const sizeZ = bbox.max.z - bbox.min.z
      const wingAlongX = sizeX >= sizeZ
      const halfWing = ((wingAlongX ? sizeX : sizeZ) / 2) * 0.95
      const midY = (bbox.max.y + bbox.min.y) / 2 - carrier.position.y

      const tipL = new TransformNode('wingTipL', scene)
      tipL.parent = carrier
      tipL.position = wingAlongX
        ? new Vector3(-halfWing, midY, 0)
        : new Vector3(0, midY, -halfWing)
      const tipR = new TransformNode('wingTipR', scene)
      tipR.parent = carrier
      tipR.position = wingAlongX
        ? new Vector3(halfWing, midY, 0)
        : new Vector3(0, midY, halfWing)

      const trailMat = new StandardMaterial('trailMat', scene)
      trailMat.emissiveColor = new Color3(1, 1, 1)
      trailMat.disableLighting = true
      trailMat.backFaceCulling = false
      trailMat.alpha = 0.55

      const diameter = halfWing * 0.08
      const trailL = new TrailMesh('trailL', tipL, scene, diameter, 120, false)
      trailL.material = trailMat
      const trailR = new TrailMesh('trailR', tipR, scene, diameter, 120, false)
      trailR.material = trailMat
      trailL.setEnabled(false)
      trailR.setEnabled(false)
      gameStore.trails = [trailL, trailR]

      const physics = new PhysicsWorld(terrainHeights)
      physics.createPlayerBody(spawn.x, spawn.y, spawn.z)
      gameStore.physics = physics
      lastTimeRef.current = performance.now()
    }

    setup().catch(console.error)

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
      gameStore.trails.forEach((t) => t.dispose())
      gameStore.trails = []
      gameStore.mesh?.dispose()
      gameStore.mesh = null
      gameStore.physics?.dispose()
      gameStore.physics = null
    }
  }, [scene])

  useBeforeRender(() => {
    const mesh = gameStore.mesh
    const physics = gameStore.physics
    if (!mesh || !physics?.playerBody) return

    const now = performance.now()
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05)
    lastTimeRef.current = now

    const body = physics.playerBody

    // Derive bird direction from camera — camera is the source of truth
    const yaw = -gameStore.camAlpha - Math.PI / 2
    gameStore.birdYaw = yaw

    const pitch = gameStore.birdMode === 'flying'
      ? gameStore.camBeta - FLIGHT_HORIZON_BETA
      : 0
    gameStore.birdPitch = pitch

    if (gameStore.birdMode === 'grounded' && gameStore.camMode === 'third') {
      // fwd = direction camera is looking, flattened
      const fwd = new Vector3(-Math.cos(gameStore.camAlpha), 0, -Math.sin(gameStore.camAlpha))
      const right = new Vector3(-Math.sin(gameStore.camAlpha), 0, Math.cos(gameStore.camAlpha))
      const move = Vector3.Zero()

      if (keys.current.has('KeyW')) move.addInPlace(fwd)
      if (keys.current.has('KeyS')) move.subtractInPlace(fwd)
      if (keys.current.has('KeyA')) move.subtractInPlace(right)
      if (keys.current.has('KeyD')) move.addInPlace(right)

      if (move.length() > 0) move.normalize()
      const linvel = body.linvel()
      body.setLinvel(
        { x: move.x * WALK_SPEED, y: linvel.y, z: move.z * WALK_SPEED },
        true
      )
    }

    if (gameStore.birdMode === 'flying') {
      if (takeoffCooldownRef.current > 0) {
        takeoffCooldownRef.current -= dt
      } else {
        body.setLinvel(
          {
            x: Math.sin(yaw) * Math.cos(pitch) * FLIGHT_SPEED,
            y: Math.sin(pitch) * FLIGHT_SPEED,
            z: Math.cos(yaw) * Math.cos(pitch) * FLIGHT_SPEED,
          },
          true
        )

        if (physics.isNearGround()) {
          gameStore.birdMode = 'grounded'
          body.setGravityScale(1, true)
          body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        }
      }
    }

    physics.step(dt)

    // Feather-style float: bank into turns + gentle vertical bob
    const isFlying = gameStore.birdMode === 'flying'
    let yawDelta = yaw - prevYawRef.current
    // shortest-arc
    if (yawDelta > Math.PI) yawDelta -= 2 * Math.PI
    else if (yawDelta < -Math.PI) yawDelta += 2 * Math.PI
    prevYawRef.current = yaw
    const yawRate = dt > 0 ? yawDelta / dt : 0
    const targetBank = isFlying
      ? Math.max(-MAX_BANK, Math.min(MAX_BANK, -yawRate * BANK_PER_YAW_RATE))
      : 0
    const bankBlend = 1 - Math.exp(-ORIENT_SMOOTHING * dt)
    bankRef.current += (targetBank - bankRef.current) * bankBlend

    if (isFlying) flightTimeRef.current += dt
    else flightTimeRef.current = 0
    const bob = isFlying
      ? Math.sin(flightTimeRef.current * Math.PI * 2 * BOB_FREQUENCY) * BOB_AMPLITUDE
      : 0

    const t = body.translation()
    mesh.position.set(t.x, t.y + bob, t.z)

    // Build orientation from yaw + pitch + roll via quaternion to avoid
    // Euler-order ambiguity. The GLB loader already applies a 180° flip on
    // the imported root, so the carrier uses yaw directly.
    const target = Quaternion.RotationYawPitchRoll(yaw, -pitch, bankRef.current)
    if (!mesh.rotationQuaternion) mesh.rotationQuaternion = target.clone()
    else Quaternion.SlerpToRef(mesh.rotationQuaternion, target, 1 - Math.exp(-ORIENT_SMOOTHING * dt), mesh.rotationQuaternion)

    const shouldTrail = gameStore.birdMode === 'flying'
    for (const trail of gameStore.trails) {
      if (shouldTrail && !trail.isEnabled()) {
        trail.setEnabled(true)
        trail.start()
      } else if (!shouldTrail && trail.isEnabled()) {
        trail.stop()
        trail.setEnabled(false)
      }
    }
  })

  return null
}
