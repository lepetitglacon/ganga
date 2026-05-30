import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import {
  Color4,
  DynamicTexture,
  ParticleSystem,
  Vector3,
  type Scene,
} from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'

// Water shed on each wing-flap. When the bird beats its wings (Space), it loses
// a bit of hydration and a quick burst of droplets is launched from its body.
//
// Each drop is born with the bird's velocity AT THE INSTANT OF THE FLAP
// (captured in gameStore.flapVel) and is fully independent afterward — gravity
// pulls it down while it coasts along that launch heading. So if the bird banks
// away right after flapping, the drops keep carrying the old momentum, trailing
// off in the direction the bird was going. Exactly the "weight" effect wanted.

// Particles per burst.
const BURST_COUNT = 26
// Drops shed a little slower than the bird so they visibly peel off behind it.
const VELOCITY_INHERIT = 0.72
// Extra downward kick (m/s) so drops drip off rather than pacing the bird.
const DOWNWARD_BIAS = 1.5
// Random spread (m/s) added around the inherited launch velocity.
const SPREAD = 1.6
// Heavier-than-real gravity reads better at this scale.
const GRAVITY = -14

// Soft round droplet sprite, generated so we don't ship an asset.
function makeDropletTexture(scene: Scene): DynamicTexture {
  const size = 64
  const tex = new DynamicTexture('waterDropTex', size, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.45, 'rgba(220,240,255,0.85)')
  g.addColorStop(1, 'rgba(180,215,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  tex.hasAlpha = true
  tex.update(false)
  return tex
}

export const WaterDrops = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return

    const tex = makeDropletTexture(scene)
    const ps = new ParticleSystem('waterDrops', BURST_COUNT * 6, scene)
    ps.particleTexture = tex
    // World-space point emitter; we reposition it onto the bird each burst.
    const emitter = new Vector3(0, 0, 0)
    ps.emitter = emitter
    // Small box around the body so drops don't all spawn from one pixel.
    ps.minEmitBox = new Vector3(-0.3, -0.2, -0.3)
    ps.maxEmitBox = new Vector3(0.3, 0.1, 0.3)
    ps.color1 = new Color4(0.72, 0.86, 1.0, 0.9)
    ps.color2 = new Color4(0.5, 0.72, 0.95, 0.8)
    ps.colorDead = new Color4(0.45, 0.6, 0.9, 0.0)
    ps.minSize = 0.06
    ps.maxSize = 0.2
    ps.minLifeTime = 0.5
    ps.maxLifeTime = 1.2
    ps.emitRate = 0 // manual bursts only
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD
    ps.gravity = new Vector3(0, GRAVITY, 0)
    // direction1/2 ARE the launch velocity (emitPower = 1), set per burst.
    ps.minEmitPower = 1
    ps.maxEmitPower = 1
    ps.start()

    let lastFlapId = gameStore.flapId
    const obs = scene.onBeforeRenderObservable.add(() => {
      if (gameStore.flapId === lastFlapId) return
      lastFlapId = gameStore.flapId
      const mesh = gameStore.mesh
      if (!mesh) return

      emitter.copyFrom(mesh.position)
      const v = gameStore.flapVel
      // Inherit the bird's flap-time velocity (with a downward bias), then emit
      // within a small spread box around it.
      const bx = v.x * VELOCITY_INHERIT
      const by = v.y * VELOCITY_INHERIT - DOWNWARD_BIAS
      const bz = v.z * VELOCITY_INHERIT
      ps.direction1 = new Vector3(bx - SPREAD, by - SPREAD, bz - SPREAD)
      ps.direction2 = new Vector3(bx + SPREAD, by + SPREAD, bz + SPREAD)
      ps.manualEmitCount = BURST_COUNT
    })

    return () => {
      scene.onBeforeRenderObservable.remove(obs)
      ps.dispose()
      tex.dispose()
    }
  }, [scene])

  return null
}
