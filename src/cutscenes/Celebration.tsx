import { useScene } from 'react-babylonjs'
import {
  Color4,
  DynamicTexture,
  ParticleSystem,
  Vector3,
  type Scene,
} from '@babylonjs/core'
import { Cutscene, EventTrigger, Orbit, Step, useCutsceneAction } from '@/components/cutscene/index.ts'
import { gameStore } from '@/game/gameStore.ts'
import { PLACES } from '@/game/places.ts'
import { getTerrainHeight } from '@/game/terrain.ts'

// When the village reservoir first hits 100%, the camera lifts off the bird and
// does a slow lap around the village while water erupts from the ground — the
// land coming back to life. Triggered off gameStore.reservoirJustFilled (set by
// the reservoir the frame it fills).

const DURATION = 9 // seconds of camera tour
const ORBIT_SPEED = 0.6 // rad/s — ~0.86 of a full lap over DURATION
const GEYSER_COUNT = 14
const GEYSER_GRAVITY = -14 // arcs the jets back down like fountains
// Once the tour ends the jets stop emitting; the drops in flight need this long
// to fall + fade before it's safe to dispose the systems.
const GEYSER_FADE_MS = 2600

// Village footprint → orbit center / radius / height.
function villageFrame() {
  const place = PLACES.find((p) => p.name === 'village') ?? PLACES[0]
  const bbox = place?.bbox
  if (!bbox) return { center: new Vector3(0, 30, 0), radius: 120, height: 60 }
  const cx = (bbox.minX + bbox.maxX) / 2
  const cz = (bbox.minZ + bbox.maxZ) / 2
  const extent = Math.max(bbox.maxX - bbox.minX, bbox.maxZ - bbox.minZ) / 2
  return {
    center: new Vector3(cx, (place?.groundY ?? 0) + extent * 0.25, cz),
    radius: extent * 1.8,
    height: extent * 1.0 + 18,
  }
}

// Soft round droplet sprite, generated so we don't ship an asset (mirrors the
// flap droplets).
function makeDropletTexture(scene: Scene): DynamicTexture {
  const size = 64
  const tex = new DynamicTexture('geyserTex', size, scene, false)
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

// Ambient action: water jets scattered across the village footprint for as
// long as the step lasts, then a stop + fade-out before disposal.
const Geysers = () => {
  const scene = useScene()
  useCutsceneAction({
    blocking: false,
    make: () => {
      if (!scene) return { update: () => true }
      const tex = makeDropletTexture(scene)
      const systems: ParticleSystem[] = []
      const { center, radius } = villageFrame()
      const spread = radius * 0.85
      for (let i = 0; i < GEYSER_COUNT; i++) {
        // Scatter the jets across the village footprint.
        const a = Math.random() * Math.PI * 2
        const r = Math.sqrt(Math.random()) * spread
        const x = center.x + Math.cos(a) * r
        const z = center.z + Math.sin(a) * r
        const y = getTerrainHeight(x, z)

        const ps = new ParticleSystem(`geyser${i}`, 600, scene)
        ps.particleTexture = tex
        ps.emitter = new Vector3(x, y, z)
        ps.minEmitBox = new Vector3(-0.4, 0, -0.4)
        ps.maxEmitBox = new Vector3(0.4, 0.2, 0.4)
        ps.color1 = new Color4(0.72, 0.86, 1.0, 0.95)
        ps.color2 = new Color4(0.5, 0.72, 0.95, 0.85)
        ps.colorDead = new Color4(0.45, 0.6, 0.9, 0.0)
        ps.minSize = 0.12
        ps.maxSize = 0.45
        ps.minLifeTime = 1.1
        ps.maxLifeTime = 2.2
        ps.emitRate = 140
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD
        ps.gravity = new Vector3(0, GEYSER_GRAVITY, 0)
        // Mostly upward with a little outward spray. direction × emitPower = vel.
        ps.direction1 = new Vector3(-0.6, 1, -0.6)
        ps.direction2 = new Vector3(0.6, 1, 0.6)
        ps.minEmitPower = 7
        ps.maxEmitPower = 11
        ps.start()
        systems.push(ps)
      }
      return {
        update: () => false,
        stop: () => {
          for (const ps of systems) ps.stop()
          setTimeout(() => {
            if (scene.isDisposed) return
            for (const ps of systems) ps.dispose()
            tex.dispose()
          }, GEYSER_FADE_MS)
        },
      }
    },
  })
  return null
}

export const Celebration = () => (
  <Cutscene id="village-celebration" repeat="once" fov={1.0}>
    <EventTrigger
      poll={() => {
        // Consume the one-shot flag.
        if (!gameStore.reservoirJustFilled) return false
        gameStore.reservoirJustFilled = false
        return true
      }}
    />

    <Step>
      <Orbit
        center={() => villageFrame().center}
        radius={() => villageFrame().radius}
        height={() => villageFrame().height}
        speed={ORBIT_SPEED}
        duration={DURATION}
      />
      <Geysers />
    </Step>
  </Cutscene>
)
