import {
  Color3,
  Color4,
  DynamicTexture,
  MeshBuilder,
  ParticleSystem,
  StandardMaterial,
  Vector3,
  type Mesh,
  type Scene,
} from '@babylonjs/core'

// Procedural weather props for the intro: a rain particle system that follows
// the camera, and a flat translucent "current" ribbon the egg drifts along.
// Both are created up front and revealed/animated by the cinematic timeline.

// Tall thin streak so each particle reads as a falling raindrop.
function makeRainTexture(scene: Scene): DynamicTexture {
  const w = 8
  const h = 64
  const tex = new DynamicTexture('introRainTex', { width: w, height: h }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.5, 'rgba(220,238,255,0.9)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(w * 0.35, 0, w * 0.3, h)
  tex.hasAlpha = true
  tex.update(false)
  return tex
}

export type Rain = {
  ps: ParticleSystem
  emitter: Vector3
  setIntensity: (i: number) => void
  dispose: () => void
}

// Rain falling within a box that we keep centred on a moving point (the camera
// focus). emitRate is driven by setIntensity (0..1).
export function createRain(scene: Scene): Rain {
  const tex = makeRainTexture(scene)
  const ps = new ParticleSystem('introRain', 4000, scene)
  ps.particleTexture = tex
  const emitter = new Vector3(0, 0, 0)
  ps.emitter = emitter
  ps.minEmitBox = new Vector3(-60, 45, -60)
  ps.maxEmitBox = new Vector3(60, 55, 60)
  ps.color1 = new Color4(0.75, 0.85, 1.0, 0.6)
  ps.color2 = new Color4(0.6, 0.75, 0.95, 0.5)
  ps.colorDead = new Color4(0.6, 0.75, 0.95, 0)
  ps.minSize = 0.12
  ps.maxSize = 0.28
  ps.minScaleY = 6
  ps.maxScaleY = 10
  ps.minLifeTime = 1.0
  ps.maxLifeTime = 1.4
  ps.emitRate = 0
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD
  ps.gravity = new Vector3(0, -90, 0)
  ps.direction1 = new Vector3(-1, -1, -0.5)
  ps.direction2 = new Vector3(1, -1, 0.5)
  ps.minEmitPower = 30
  ps.maxEmitPower = 45
  ps.updateSpeed = 0.02
  ps.start()

  return {
    ps,
    emitter,
    setIntensity: (i: number) => {
      ps.emitRate = Math.max(0, i) * 3500
    },
    dispose: () => {
      ps.dispose()
      tex.dispose()
    },
  }
}

// A long flat translucent ribbon standing in for the rain-fed stream the egg
// rides. Authored along +X; pass the world start position and length.
export function createCurrent(scene: Scene, start: Vector3, length: number, width: number): Mesh {
  const mesh = MeshBuilder.CreateGround(
    'introCurrent',
    { width: length, height: width, subdivisions: 1 },
    scene,
  )
  mesh.position.set(start.x + length / 2, start.y, start.z)
  const mat = new StandardMaterial('introCurrentMat', scene)
  mat.diffuseColor = new Color3(0.32, 0.5, 0.62)
  mat.emissiveColor = new Color3(0.12, 0.22, 0.32)
  mat.specularColor = new Color3(0.6, 0.7, 0.8)
  mat.alpha = 0.7
  mat.backFaceCulling = false
  mesh.material = mat
  mesh.isPickable = false
  mesh.setEnabled(false)
  return mesh
}
