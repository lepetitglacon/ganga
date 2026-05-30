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
  type AnimationGroup,
} from '@babylonjs/core'
import '@babylonjs/loaders/glTF'
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
} from '@/game/physics.ts'
import { gameStore } from '@/game/gameStore.ts'
import { useKeyboard } from '@/hooks/useKeyboard.ts'
import { getTerrainHeight, getTerrainNormal } from '@/game/terrain.ts'
import { OASES } from '@/game/oasis.ts'
import { updateReservoirs } from '@/game/reservoir.ts'
import { SUN_DIR } from '@/game/world.ts'
import { applyStormForce, sampleStorm } from '@/game/storm.ts'
import { audio } from '@/game/audio.ts'

const FLAP_SOUND_URL = '/sound/bird/flap.mp3'
const SPLASH_SOUND_URL = '/sound/bird/plouf-big.wav'
const WADING_SOUND_URL = '/sound/bird/wading.raw.mp3'

// Hydration: drains slowly the whole time, refills fast while wading in an
// oasis. Rates are per-second so they're framerate-independent in the
// fixed-step loop. ~3 min to empty, ~3 s to fully refill.
const WATER_DRAIN_RATE = 1 / 180
const WATER_RECHARGE_RATE = 1 / 3
// The bird counts as "in water" when its XZ is inside an oasis water disc AND
// it's near the ground (not flying over it). Keyed off height ABOVE the local
// terrain so entry/exit happens right at the visible shoreline (the carve makes
// terrain == waterY exactly at waterRadius), not deep in the center.
const WATER_WADE_HEIGHT = 1.8 // m above terrain — ~capsule height when standing
// A big splash fires once when the bird first enters the water. The wading
// loop then plays only while the bird is actually moving through it.
const WADE_MIN_SPEED = 1.2 // m/s horizontal — below this, no wading sound

// Feet wetness: 1 while wading, drying out over this many meters of subsequent
// ground travel. Exposed on gameStore so WetnessMask paints the trail.
const WET_TRAIL_LENGTH = 12 // meters of travel before the feet fully dry out

// Horizon = level flight. camBeta is measured from +Y, so π/2 is horizontal.
// Looking up (camBeta > π/2) climbs, looking down (camBeta < π/2) dives.
const FLIGHT_HORIZON_BETA = Math.PI / 2

// Fixed-timestep simulation. Everything that touches physics or accumulates
// over time (storm forces, skid deceleration, flap decay, takeoff timer)
// runs in 1/60s chunks driven by an accumulator, so behavior matches across
// 30/60/144 Hz framerates. Cosmetic per-frame work (mesh slerp, banking,
// trails) still runs once per render with the real frame delta.
const FIXED_DT = 1 / 60
// Cap sub-steps per frame to avoid the "spiral of death" if a frame stalls.
const MAX_SUB_STEPS = 5

const WALK_SPEED = 5
const FLIGHT_SPEED = 14 // cruise airspeed (m/s) — level flight settles here
// Light flight realism: airspeed is no longer constant. Gravity acts along the
// flight path, so a climb trades speed for altitude and a dive trades altitude
// for speed.
//   - Climbing (pitch > 0): gravity bleeds airspeed, floored at MIN_FLIGHT_SPEED.
//   - Diving (pitch < 0): gravity builds airspeed with no cap (free-fall).
//   - Level: a gentle wing "thrust" recovers cruise speed when below it, so the
//     bird doesn't stay stuck slow after a climb.
const MIN_FLIGHT_SPEED = 10 // m/s floor while climbing (≈36 km/h on the HUD)
const MAX_SPEED = 200 / 3.6 // 200 km/h hard cap (≈55.6 m/s) — applies to dives AND storm boosts
const FLIGHT_GRAVITY = 9.81 // m/s² along the flight path
const CRUISE_RECOVERY = 0.5 // 1/s — how fast airspeed recovers toward cruise
// Ground "skid" after landing or after WASD release. Constant linear
// deceleration so the skid duration scales with the speed at touchdown:
// at FLIGHT_SPEED the slide lasts ~4s; at WALK_SPEED it tapers in ~1.4s.
const GROUND_DECEL = 3.6 // m/s² horizontal
const FLAP_BOOST = 1.2 // +120% speed at peak
const FLAP_DECAY = 0.55 // per-second exponential decay rate (slow)
const FLAP_COOLDOWN = 0.5
// Each in-flight flap flings water off the wings: hydration drops by this
// fraction per beat (~25 flaps to empty a full reserve).
const FLAP_WATER_COST = 0.04

// Takeoff: scripted sequence of wing-beats to leave the ground.
// Gravity is disabled and each flap punches y-velocity upward; after the
// last flap we hand off to free flight.
const TAKEOFF_FLAPS = 3
const TAKEOFF_FLAP_INTERVAL = 0.22 // seconds between flaps
const TAKEOFF_FLAP_IMPULSE = 5 // m/s added to y-vel per flap
const TAKEOFF_FORWARD_SPEED = 4 // m/s initial forward drift during takeoff
// Margin below which the bird is considered "on the ground" for state purposes.
// Slightly larger than the landing margin so we don't flicker at edges.
const GROUND_MARGIN_LEAVE = 1.0

// Landing flare (visual overlay, NOT a state). We cast a ray along the
// current velocity vector and check time-to-impact against terrain or any
// static collider (buildings, places). The player keeps full velocity
// control — pulling up makes the ray miss and the overlay clears on its own.
const LANDING_ENTER_TIME = 0.6 // seconds to impact → flare on
const LANDING_EXIT_TIME = 1.1 // no impact within this horizon → flare off (hysteresis)
const LANDING_MIN_SPEED = 1.0 // m/s — below this, skip the ray (degenerate dir)
const LANDING_FLAP_INTERVAL = 0.25 // seconds between flap.mp3 plays during landing flare
const LANDING_FLAP_PLAYBACK_RATE = 1.5 // playback speed multiplier during landing

// Thermal updraft tuning.
// Thermals form over sun-facing slopes (warm rising air). We measure that
// via dot(terrainNormal, sunDir); only the positive side counts.
const THERMAL_MAX_ALTITUDE = 90 // m above terrain; effect fades to 0 above this
const THERMAL_SPEED_BOOST = 0.9 // +90% flight speed at peak
const THERMAL_LIFT = 7 // m/s extra upward velocity at peak
const THERMAL_SLOPE_THRESHOLD = 0.08 // ignore near-flat ground

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
  const accRef = useRef(0)
  const takeoffFlapsLeftRef = useRef(0)
  const takeoffNextFlapRef = useRef(0)
  const prevYawRef = useRef(0)
  const bankRef = useRef(0)
  const flightTimeRef = useRef(0)
  const landingFlapTimerRef = useRef(0)
  const flightSpeedRef = useRef(FLIGHT_SPEED)
  const flapBoostRef = useRef(0)
  const flapCooldownRef = useRef(0)
  const flyAnimRef = useRef<AnimationGroup | null>(null)
  const idleAnimRef = useRef<AnimationGroup | null>(null)
  const prevBirdModeRef = useRef(gameStore.birdMode)
  const wallSoundRef = useRef<{ setVolume: (v: number) => void } | null>(null)
  const wallVolRef = useRef(0)
  const wadingSoundRef = useRef<{ setVolume: (v: number) => void } | null>(null)
  const wadingVolRef = useRef(0)
  // 0..1 how wet the feet are; drives the trail and dries out over distance.
  const feetWetRef = useRef(0)

  useEffect(() => {
    if (!scene) return
    let cancelled = false

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      if (gameStore.birdMode === 'grounded') {
        // Active takeoff: scripted 2–3 flaps before free flight kicks in.
        gameStore.birdMode = 'takingOff'
        takeoffFlapsLeftRef.current = TAKEOFF_FLAPS
        takeoffNextFlapRef.current = 0 // fire first flap immediately on next frame
        const body = gameStore.physics?.playerBody
        if (body) body.setGravityScale(0, true)
      } else if (gameStore.birdMode === 'flying' && flapCooldownRef.current <= 0) {
        flapBoostRef.current = FLAP_BOOST
        flapCooldownRef.current = FLAP_COOLDOWN
        flyAnimRef.current?.start(false)
        audio.playOneShot(FLAP_SOUND_URL)
        // Shed water on the beat — but only if the bird actually carries any.
        // Drain hydration and hand the droplet burst the bird's current velocity
        // so the drops fly off along its heading. Dry bird → no droplets.
        if (gameStore.water > 0) {
          gameStore.water = Math.max(0, gameStore.water - FLAP_WATER_COST)
          const body = gameStore.physics?.playerBody
          if (body) {
            const lv = body.linvel()
            gameStore.flapVel = { x: lv.x, y: lv.y, z: lv.z }
          }
          gameStore.flapId++
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)

    const setup = async () => {
      // Map owns the physics world: it waits for terrain heights, then
      // creates PhysicsWorld and bakes place trimeshes. Wait for it.
      while (!gameStore.physics) {
        await new Promise((r) => setTimeout(r, 16))
        if (cancelled) return
      }

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

      // Animation groups exposed by the GLB — log so we know what's available.
      console.log(
        'bird.glb animations:',
        result.animationGroups.map((g) => g.name)
      )
      for (const g of result.animationGroups) g.stop()
      const flyAnim =
        result.animationGroups.find((g) => /fly/i.test(g.name)) ?? null
      const idleAnim =
        result.animationGroups.find(
          (g) => g !== flyAnim && /idle|ground|stand|default/i.test(g.name)
        ) ?? result.animationGroups.find((g) => g !== flyAnim) ?? null
      flyAnimRef.current = flyAnim
      idleAnimRef.current = idleAnim
      if (idleAnim) idleAnim.start(true)

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

      gameStore.physics.createPlayerBody(spawn.x, spawn.y, spawn.z)
      lastTimeRef.current = performance.now()
    }

    setup().catch(console.error)

    audio.initSoundPool(FLAP_SOUND_URL, 5).catch(console.error)

    wallSoundRef.current = audio.loop('/sound/wind/tempest-inside-wall.wav', { volume: 0 })
    wadingSoundRef.current = audio.loop(WADING_SOUND_URL, { volume: 0 })
    const stopGusts = audio.startAmbientGusts('/sound/wind/wind.wav', 5, 20, {
      volume: 0.5,
      fadeSec: 1.5,
    })

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
      gameStore.trails.forEach((t) => t.dispose())
      gameStore.trails = []
      gameStore.mesh?.dispose()
      gameStore.mesh = null
      wallSoundRef.current?.setVolume(0)
      wallSoundRef.current = null
      wadingSoundRef.current?.setVolume(0)
      wadingSoundRef.current = null
      stopGusts()
    }
  }, [scene])

  useBeforeRender(() => {
    const mesh = gameStore.mesh
    const physics = gameStore.physics
    if (!mesh || !physics?.playerBody) return

    const now = performance.now()
    const frameDt = Math.min((now - lastTimeRef.current) / 1000, 0.25)
    lastTimeRef.current = now
    accRef.current += frameDt

    const body = physics.playerBody

    // Derive bird direction from its own heading (decoupled from cam during free-look)
    const yaw = -gameStore.birdAlpha - Math.PI / 2
    gameStore.birdYaw = yaw

    // pitch drives the flight velocity (player control). visualPitch drives the
    // mesh orientation — flattens during landing flare while velocity stays free.
    const pitch = gameStore.birdMode === 'flying'
      ? gameStore.birdBeta - FLIGHT_HORIZON_BETA
      : 0
    const visualPitch = gameStore.landingApproach ? 0 : pitch
    gameStore.birdPitch = visualPitch

    let subSteps = 0
    while (accRef.current >= FIXED_DT && subSteps < MAX_SUB_STEPS) {
      const dt = FIXED_DT
      accRef.current -= FIXED_DT
      subSteps++

    if (gameStore.birdMode === 'grounded') {
      if (gameStore.camMode === 'third') {
        const fwd = new Vector3(-Math.cos(gameStore.birdAlpha), 0, -Math.sin(gameStore.birdAlpha))
        const right = new Vector3(-Math.sin(gameStore.birdAlpha), 0, Math.cos(gameStore.birdAlpha))
        const move = Vector3.Zero()

        if (keys.current.has('KeyW')) move.addInPlace(fwd)
        if (keys.current.has('KeyS')) move.subtractInPlace(fwd)
        if (keys.current.has('KeyA')) move.subtractInPlace(right)
        if (keys.current.has('KeyD')) move.addInPlace(right)

        const linvel = body.linvel()
        if (move.length() > 0) {
          move.normalize()
          body.setLinvel(
            { x: move.x * WALK_SPEED, y: linvel.y, z: move.z * WALK_SPEED },
            true,
          )
        } else {
          // No input: coast on inherited momentum (post-landing skid) with a
          // constant linear deceleration. Lets gravity own the y axis.
          const speed = Math.hypot(linvel.x, linvel.z)
          if (speed > 0) {
            const newSpeed = Math.max(0, speed - GROUND_DECEL * dt)
            const scale = newSpeed / speed
            body.setLinvel(
              { x: linvel.x * scale, y: linvel.y, z: linvel.z * scale },
              true,
            )
          }
        }
      }
      // Passive takeoff: walked off an edge → switch to flying without the
      // scripted flap sequence. Gravity off, current velocity preserved.
      if (!physics.isNearGround(GROUND_MARGIN_LEAVE)) {
        gameStore.birdMode = 'flying'
        body.setGravityScale(0, true)
        const lv = body.linvel()
        flightSpeedRef.current = Math.max(MIN_FLIGHT_SPEED, Math.hypot(lv.x, lv.z))
      }
    }

    if (gameStore.birdMode === 'takingOff') {
      takeoffNextFlapRef.current -= dt
      if (takeoffNextFlapRef.current <= 0 && takeoffFlapsLeftRef.current > 0) {
        const lv = body.linvel()
        body.setLinvel(
          {
            x: Math.sin(yaw) * TAKEOFF_FORWARD_SPEED,
            y: Math.max(lv.y, 0) + TAKEOFF_FLAP_IMPULSE,
            z: Math.cos(yaw) * TAKEOFF_FORWARD_SPEED,
          },
          true
        )
        flyAnimRef.current?.start(false)
        audio.playOneShot(FLAP_SOUND_URL)
        takeoffFlapsLeftRef.current -= 1
        takeoffNextFlapRef.current = TAKEOFF_FLAP_INTERVAL
      }
      if (takeoffFlapsLeftRef.current <= 0 && takeoffNextFlapRef.current <= 0) {
        gameStore.birdMode = 'flying'
        const lv = body.linvel()
        flightSpeedRef.current = Math.max(MIN_FLIGHT_SPEED, Math.hypot(lv.x, lv.z))
      }
    }

    if (gameStore.birdMode === 'flying') {
      if (flapCooldownRef.current > 0) flapCooldownRef.current -= dt
      flapBoostRef.current *= Math.exp(-FLAP_DECAY * dt)

      // --- Thermal updraft ---
      // Sample the dune's slope under the bird. Sun-facing slopes radiate
      // warmth → rising air. Only slopes that are both (a) tilted enough
      // and (b) oriented toward the sun produce a thermal.
      const t = body.translation()
      const terrainY = getTerrainHeight(t.x, t.z)
      const altitude = t.y - terrainY
      let thermal = 0
      if (altitude > 0 && altitude < THERMAL_MAX_ALTITUDE) {
        const normal = getTerrainNormal(t.x, t.z, 3)
        const facing = Vector3.Dot(normal, SUN_DIR) // -1..1
        const slope = 1 - normal.y // 0 = flat, 1 = vertical
        if (facing > 0 && slope > THERMAL_SLOPE_THRESHOLD) {
          const altFalloff = 1 - altitude / THERMAL_MAX_ALTITUDE
          thermal = facing * slope * altFalloff
        }
      }
      gameStore.thermal = thermal

      // --- Airspeed dynamics (light realism) ---
      // Gravity projected onto the flight path: climbing (pitch > 0) decelerates,
      // diving (pitch < 0) accelerates with no upper bound. A gentle thrust
      // recovers cruise speed when below it, so level flight settles at
      // FLIGHT_SPEED instead of staying stuck at the climb floor.
      const alongGravity = -FLIGHT_GRAVITY * Math.sin(pitch)
      // Recovery only kicks in once level or descending — never during a climb,
      // so climbing always bleeds airspeed all the way down to the floor.
      const recover =
        pitch <= 0 && flightSpeedRef.current < FLIGHT_SPEED
          ? (FLIGHT_SPEED - flightSpeedRef.current) * CRUISE_RECOVERY
          : 0
      flightSpeedRef.current += (alongGravity + recover) * dt
      flightSpeedRef.current = Math.min(
        MAX_SPEED,
        Math.max(MIN_FLIGHT_SPEED, flightSpeedRef.current)
      )

      const speedMul = 1 + thermal * THERMAL_SPEED_BOOST + flapBoostRef.current
      const speed = flightSpeedRef.current * speedMul
      const lift = thermal * THERMAL_LIFT
      body.setLinvel(
        {
          x: Math.sin(yaw) * Math.cos(pitch) * speed,
          y: Math.sin(pitch) * speed + lift,
          z: Math.cos(yaw) * Math.cos(pitch) * speed,
        },
        true
      )

      // Landing flare overlay: cast a ray along motion and react to imminent
      // impact (terrain, buildings, place trimeshes — anything with a collider).
      const lvNow = body.linvel()
      const tNow = body.translation()
      const speedH = Math.hypot(lvNow.x, lvNow.y, lvNow.z)
      if (speedH > LANDING_MIN_SPEED) {
        const dir = { x: lvNow.x / speedH, y: lvNow.y / speedH, z: lvNow.z / speedH }
        const enterDist = speedH * LANDING_ENTER_TIME
        const exitDist = speedH * LANDING_EXIT_TIME
        const toi = physics.raycast(tNow, dir, exitDist)
        if (!gameStore.landingApproach && toi !== null && toi <= enterDist) {
          gameStore.landingApproach = true
          flyAnimRef.current?.start(true)
          audio.playOneShotPooled(FLAP_SOUND_URL, 5, { playbackRate: LANDING_FLAP_PLAYBACK_RATE })
          landingFlapTimerRef.current = LANDING_FLAP_INTERVAL
        } else if (gameStore.landingApproach && toi === null) {
          gameStore.landingApproach = false
          flyAnimRef.current?.stop()
        }
      }
      if (gameStore.landingApproach) {
        landingFlapTimerRef.current -= dt
        if (landingFlapTimerRef.current <= 0) {
          audio.playOneShotPooled(FLAP_SOUND_URL, 5, { playbackRate: LANDING_FLAP_PLAYBACK_RATE })
          landingFlapTimerRef.current = LANDING_FLAP_INTERVAL
        }
      }

      if (physics.isNearGround()) {
        gameStore.birdMode = 'grounded'
        gameStore.landingApproach = false
        gameStore.thermal = 0
        flapBoostRef.current = 0
        flapCooldownRef.current = 0
        body.setGravityScale(1, true)
        // Preserve full horizontal momentum at touchdown. Any cap here causes
        // a discontinuous speed drop that the FOV (speed-driven) makes obvious.
        // The grounded skid (GROUND_DECEL) bleeds the energy off smoothly.
        const lv = body.linvel()
        body.setLinvel({ x: lv.x, y: 0, z: lv.z }, true)
      }
    }

    // --- Sandstorm forces ---
    // Inside the dense wall of any storm: tangential wind + small radial push
    // outward. We add to whatever linvel the mode branches just wrote.
    if (gameStore.storms.length > 0) {
      const t = body.translation()
      const lv = body.linvel()
      const out = { x: lv.x, y: lv.y, z: lv.z }
      let maxProx = 0
      let inWall = false
      for (const storm of gameStore.storms) {
        const s = sampleStorm(storm, t.x, t.y, t.z)
        if (s.wallProximity > maxProx) maxProx = s.wallProximity
        if (s.inWall) inWall = true
        applyStormForce(storm, t.x, t.z, s, dt, out)
      }
      gameStore.stormProximity = maxProx
      const target = inWall ? 1 : 0
      wallVolRef.current += (target - wallVolRef.current) * Math.min(1, dt * 4)
      wallSoundRef.current?.setVolume(wallVolRef.current)
      if (out.x !== lv.x || out.z !== lv.z) {
        body.setLinvel(out, true)
      }
    } else {
      gameStore.stormProximity = 0
      wallVolRef.current += (0 - wallVolRef.current) * Math.min(1, dt * 4)
      wallSoundRef.current?.setVolume(wallVolRef.current)
    }

    // --- Oasis water / hydration ---
    // In water when the body is inside an oasis disc (XZ) and low enough to be
    // standing in the basin rather than flying over it. Refill while wading,
    // drain slowly otherwise. A splash plays on the entry transition and a
    // wading loop fades in for as long as the bird stays in the water.
    const tp = body.translation()
    let inWater = false
    if (tp.y - getTerrainHeight(tp.x, tp.z) < WATER_WADE_HEIGHT) {
      for (const o of OASES) {
        const dx = tp.x - o.x
        const dz = tp.z - o.z
        if (dx * dx + dz * dz < o.waterRadius * o.waterRadius) {
          inWater = true
          break
        }
      }
    }
    gameStore.water = inWater
      ? Math.min(1, gameStore.water + WATER_RECHARGE_RATE * dt)
      : Math.max(0, gameStore.water - WATER_DRAIN_RATE * dt)

    // One big splash on the entry into the water.
    if (inWater && !gameStore.inWater) audio.playOneShot(SPLASH_SOUND_URL)

    const lvW = body.linvel()
    const hSpeed = Math.hypot(lvW.x, lvW.z)
    const moving = hSpeed > WADE_MIN_SPEED

    // Feet wetness: full while wading, then dries out over WET_TRAIL_LENGTH
    // meters of subsequent travel. WetnessMask reads it to paint the trail.
    if (inWater) feetWetRef.current = 1
    else if (feetWetRef.current > 0)
      feetWetRef.current = Math.max(0, feetWetRef.current - (hSpeed * dt) / WET_TRAIL_LENGTH)
    gameStore.feetWet = feetWetRef.current

    gameStore.inWater = inWater

    // --- Village reservoirs ---
    // While perched inside a reservoir's footprint, pour the bird's hydration
    // into it (raising its water level). Also drives the lerp every frame.
    updateReservoirs(tp, gameStore.birdMode === 'grounded', dt)

    // Wading loop plays only while moving through the water; silent when still.
    const wadingTarget = inWater && moving ? 1 : 0
    wadingVolRef.current += (wadingTarget - wadingVolRef.current) * Math.min(1, dt * 6)
    wadingSoundRef.current?.setVolume(wadingVolRef.current * 0.7)

    // Global speed cap — storms (and steep dives) can otherwise fling the bird
    // well past 200 km/h. Clamp the final velocity magnitude after every force.
    {
      const lv = body.linvel()
      const sp = Math.hypot(lv.x, lv.y, lv.z)
      if (sp > MAX_SPEED) {
        const s = MAX_SPEED / sp
        body.setLinvel({ x: lv.x * s, y: lv.y * s, z: lv.z * s }, true)
      }
    }

    const v = body.linvel()
    gameStore.speed = Math.hypot(v.x, v.y, v.z)
    gameStore.flapCooldown = Math.max(0, flapCooldownRef.current)

    // Animation transitions
    if (gameStore.birdMode !== prevBirdModeRef.current) {
      const inAir = gameStore.birdMode !== 'grounded'
      const wasInAir = prevBirdModeRef.current !== 'grounded'
      if (inAir && !wasInAir) {
        idleAnimRef.current?.stop()
        flyAnimRef.current?.start(false)
      } else if (!inAir && wasInAir) {
        flyAnimRef.current?.stop()
        idleAnimRef.current?.start(true)
      }
      prevBirdModeRef.current = gameStore.birdMode
    }

    physics.step(dt)
    } // end fixed-step loop
    // If we hit the sub-step cap, drop leftover accumulator so the spiral
    // doesn't compound across slow frames.
    if (subSteps >= MAX_SUB_STEPS) accRef.current = 0

    // Feather-style float: bank into turns + gentle vertical bob
    const isFlying = gameStore.birdMode === 'flying' && !gameStore.landingApproach
    let yawDelta = yaw - prevYawRef.current
    // shortest-arc
    if (yawDelta > Math.PI) yawDelta -= 2 * Math.PI
    else if (yawDelta < -Math.PI) yawDelta += 2 * Math.PI
    prevYawRef.current = yaw
    const yawRate = frameDt > 0 ? yawDelta / frameDt : 0
    const targetBank = isFlying
      ? Math.max(-MAX_BANK, Math.min(MAX_BANK, -yawRate * BANK_PER_YAW_RATE))
      : 0
    const bankBlend = 1 - Math.exp(-ORIENT_SMOOTHING * frameDt)
    bankRef.current += (targetBank - bankRef.current) * bankBlend

    if (isFlying) flightTimeRef.current += frameDt
    else flightTimeRef.current = 0
    const bob = isFlying
      ? Math.sin(flightTimeRef.current * Math.PI * 2 * BOB_FREQUENCY) * BOB_AMPLITUDE
      : 0

    const t = body.translation()
    mesh.position.set(t.x, t.y + bob, t.z)

    // Build orientation from yaw + pitch + roll via quaternion to avoid
    // Euler-order ambiguity. The GLB loader already applies a 180° flip on
    // the imported root, so the carrier uses yaw directly.
    const target = Quaternion.RotationYawPitchRoll(yaw, -visualPitch, bankRef.current)
    if (!mesh.rotationQuaternion) mesh.rotationQuaternion = target.clone()
    else Quaternion.SlerpToRef(mesh.rotationQuaternion, target, 1 - Math.exp(-ORIENT_SMOOTHING * frameDt), mesh.rotationQuaternion)

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
