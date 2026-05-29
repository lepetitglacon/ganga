import {
  DynamicTexture,
  MaterialPluginBase,
  Texture,
  type Material,
  type Scene,
  type UniformBuffer,
} from '@babylonjs/core'

// Painted wetness system (the "AAA" approach).
//
// A sliding-window canvas texture follows the bird, into which we paint soft
// brush stamps wherever its wet feet touch the ground; the whole thing decays
// each frame so the trail dries out. The terrain's StandardMaterial samples
// this mask (via WetnessPlugin) and tints the sand toward damp brown — so the
// trail conforms perfectly to the dunes and costs no extra geometry.
//
// The window is local (WINDOW_SIZE meters around the bird) so the texture stays
// high-resolution without having to cover the whole 1600 m terrain. Trails are
// short-lived and short, so content scrolling out of the window is fine.

// Damp-brown multiplier applied to the sand where wet — matches the static
// wet ring baked into the terrain vertex colors (Terrain.tsx WET_SAND_TINT).
const WET_TINT = { r: 0.6, g: 0.42, b: 0.3 }

export class WetnessPlugin extends MaterialPluginBase {
  private _enabled = false
  texture: DynamicTexture | null = null
  centerX = 0
  centerZ = 0
  worldSize = 120

  constructor(material: Material) {
    super(material, 'Wetness', 200, { WETNESS: false })
  }

  get isEnabled(): boolean {
    return this._enabled
  }
  set isEnabled(value: boolean) {
    if (this._enabled === value) return
    this._enabled = value
    this.markAllDefinesAsDirty()
    this._enable(value)
  }

  prepareDefines(defines: Record<string, unknown>): void {
    defines.WETNESS = this._enabled
  }

  getClassName(): string {
    return 'WetnessPlugin'
  }

  getSamplers(samplers: string[]): void {
    samplers.push('wetnessSampler')
  }

  getUniforms() {
    return {
      ubo: [
        { name: 'wetMaskCenter', size: 2, type: 'vec2' },
        { name: 'wetMaskSize', size: 1, type: 'float' },
        { name: 'wetTint', size: 3, type: 'vec3' },
      ],
      fragment: `#ifdef WETNESS
        uniform vec2 wetMaskCenter;
        uniform float wetMaskSize;
        uniform vec3 wetTint;
      #endif`,
    }
  }

  bindForSubMesh(uniformBuffer: UniformBuffer): void {
    if (!this._enabled) return
    uniformBuffer.updateFloat2('wetMaskCenter', this.centerX, this.centerZ)
    uniformBuffer.updateFloat('wetMaskSize', this.worldSize)
    uniformBuffer.updateFloat3('wetTint', WET_TINT.r, WET_TINT.g, WET_TINT.b)
    if (this.texture) uniformBuffer.setTexture('wetnessSampler', this.texture)
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null
    return {
      // Sampler can't live in the UBO — declare it here.
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef WETNESS
        uniform sampler2D wetnessSampler;
      #endif`,
      // Tint the albedo before lighting, so the wet sand still shades/shadows
      // normally. World XZ → window UV; outside the window leaves sand dry.
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef WETNESS
        vec2 wetUv = (vPositionW.xz - wetMaskCenter) / wetMaskSize + 0.5;
        if (wetUv.x > 0.0 && wetUv.x < 1.0 && wetUv.y > 0.0 && wetUv.y < 1.0) {
          float wetAmt = clamp(texture2D(wetnessSampler, wetUv).r, 0.0, 1.0);
          // Remap so faint drying residue reads as fully dry (clean fade) and
          // gives a crisp edge — the mask decay is exponential otherwise.
          wetAmt = smoothstep(0.3, 0.85, wetAmt);
          diffuseColor *= mix(vec3(1.0), wetTint, wetAmt);
        }
      #endif`,
    }
  }
}

// Minimal 2D context surface we use from Babylon's ICanvasRenderingContext.
type Ctx2D = {
  canvas: CanvasImageSource
  fillStyle: string | CanvasGradient
  globalCompositeOperation: string
  fillRect(x: number, y: number, w: number, h: number): void
  drawImage(img: CanvasImageSource, dx: number, dy: number): void
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient
  beginPath(): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  fill(): void
}

class WetnessMask {
  texture: DynamicTexture | null = null
  centerX = 0
  centerZ = 0
  readonly res = 256
  readonly worldSize = 120
  private ctx: Ctx2D | null = null

  private get metersPerTexel(): number {
    return this.worldSize / this.res
  }

  init(scene: Scene): void {
    if (this.texture) return
    const tex = new DynamicTexture('wetnessMask', this.res, scene, false)
    tex.wrapU = Texture.CLAMP_ADDRESSMODE
    tex.wrapV = Texture.CLAMP_ADDRESSMODE
    const ctx = tex.getContext() as unknown as Ctx2D
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, this.res, this.res)
    tex.update(false)
    this.texture = tex
    this.ctx = ctx
  }

  // Re-center the window on the bird, scrolling the canvas content by whole
  // texels so already-painted wetness keeps its world position.
  recenter(x: number, z: number): void {
    if (!this.ctx) return
    const mpt = this.metersPerTexel
    const dtx = Math.round((x - this.centerX) / mpt)
    const dtz = Math.round((z - this.centerZ) / mpt)
    if (dtx === 0 && dtz === 0) return
    const ctx = this.ctx
    // 'copy' shifts the content and clears the newly-exposed strips (→ dry).
    ctx.globalCompositeOperation = 'copy'
    ctx.drawImage(ctx.canvas, -dtx, -dtz)
    ctx.globalCompositeOperation = 'source-over'
    this.centerX += dtx * mpt
    this.centerZ += dtz * mpt
  }

  // Fade the whole mask toward dry. A per-frame alpha of dt/dryTime is far below
  // the canvas's 8-bit quantization step (255*(1-0.0016) rounds back to 255 →
  // never dries), so we accumulate the fraction and only apply a black overlay
  // once it's large enough to actually subtract a level.
  private _decayAcc = 0
  decay(dt: number, dryTime: number): void {
    if (!this.ctx) return
    this._decayAcc += dt / dryTime
    if (this._decayAcc < 0.03) return
    const a = Math.min(1, this._decayAcc)
    this._decayAcc = 0
    this.ctx.fillStyle = `rgba(0,0,0,${a})`
    this.ctx.fillRect(0, 0, this.res, this.res)
  }

  // Additively stamp a soft circle of wetness at a world XZ position.
  paint(x: number, z: number, strength: number, radiusMeters: number): void {
    if (!this.ctx) return
    const mpt = this.metersPerTexel
    const px = ((x - this.centerX) / this.worldSize) * this.res + this.res / 2
    const py = ((z - this.centerZ) / this.worldSize) * this.res + this.res / 2
    const r = Math.max(1, radiusMeters / mpt)
    const s = Math.min(1, Math.max(0, strength))
    const g = this.ctx.createRadialGradient(px, py, 0, px, py, r)
    g.addColorStop(0, `rgba(255,255,255,${s})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    this.ctx.globalCompositeOperation = 'lighter'
    this.ctx.fillStyle = g
    this.ctx.beginPath()
    this.ctx.arc(px, py, r, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.globalCompositeOperation = 'source-over'
  }

  // Upload the canvas to the GPU. Call once per frame after painting/decaying.
  commit(): void {
    this.texture?.update(false)
  }

  dispose(): void {
    this.texture?.dispose()
    this.texture = null
    this.ctx = null
  }
}

export const wetnessMask = new WetnessMask()
