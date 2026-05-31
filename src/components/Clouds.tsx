import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import {
  Axis,
  Camera,
  Color3,
  Color4,
  Effect,
  FreeCamera,
  type Material,
  type MaterialDefines,
  MaterialPluginBase,
  Matrix,
  Mesh,
  MeshBuilder,
  RenderTargetTexture,
  ShaderMaterial,
  StandardMaterial,
  type BaseTexture,
  type UniformBuffer,
  Vector3,
} from '@babylonjs/core'
import { TERRAIN_SIZE } from '@/game/terrain.ts'
import { CLOUD_SUN_CAM_NAME, makeRandomClouds } from '@/game/clouds.ts'
import { SUN_DIR } from '@/game/world.ts'

// Keep clouds inside the map edge so their shadows stay on the heightfield.
const WORLD_HALF = TERRAIN_SIZE / 2 - 250

// LOD swap distances (camera → cloud centre), with hysteresis so a cloud sitting
// near the boundary doesn't flicker between particle-cluster and sprite.
const NEAR_ENTER = 950
const NEAR_EXIT = 1200
const LOD_INTERVAL = 0.15 // seconds between LOD re-evaluations

// Curl-noise roil (shared by all cloud materials so the shadow pass matches).
// Kept small + slow so the clouds read as near-static cumulus that just barely
// breathe, instead of churning.
const CURL_AMP = 2.5
const CURL_FREQ = 0.02
const CURL_FLOW = 0.15

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

// Vertex: billboard expansion (camera-facing) of a per-instance particle, with
// a curl-noise displacement so the cloud rolls in place. `billRight`/`billUp`
// are the facing camera's axes — the main camera for the visible pass, the sun
// camera for the shadow (density) pass — so billboards are never edge-on.
const CLOUD_VS = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 aData;
uniform mat4 viewProjection;
uniform vec3 billRight;
uniform vec3 billUp;
uniform float time;
uniform float curlAmp;
uniform float curlFreq;
uniform float curlFlow;
varying vec2 vUv;
varying float vNormH;
varying float vSeed;
varying vec3 vWorldPos;

float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = h31(i + vec3(0.0, 0.0, 0.0));
  float n100 = h31(i + vec3(1.0, 0.0, 0.0));
  float n010 = h31(i + vec3(0.0, 1.0, 0.0));
  float n110 = h31(i + vec3(1.0, 1.0, 0.0));
  float n001 = h31(i + vec3(0.0, 0.0, 1.0));
  float n101 = h31(i + vec3(1.0, 0.0, 1.0));
  float n011 = h31(i + vec3(0.0, 1.0, 1.0));
  float n111 = h31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
vec3 snoiseVec3(vec3 p) {
  return vec3(vn3(p), vn3(p + vec3(31.4, 11.2, 47.1)), vn3(p + vec3(-19.3, 23.7, 9.8))) * 2.0 - 1.0;
}
vec3 curlNoise(vec3 p) {
  const float e = 0.7;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  vec3 px1 = snoiseVec3(p + dx), px0 = snoiseVec3(p - dx);
  vec3 py1 = snoiseVec3(p + dy), py0 = snoiseVec3(p - dy);
  vec3 pz1 = snoiseVec3(p + dz), pz0 = snoiseVec3(p - dz);
  float x = (py1.z - py0.z) - (pz1.y - pz0.y);
  float y = (pz1.x - pz0.x) - (px1.z - px0.z);
  float z = (px1.y - px0.y) - (py1.x - py0.x);
  return vec3(x, y, z) / (2.0 * e);
}
void main(void) {
  vec3 base = world3.xyz;
  vec3 disp = curlNoise(base * curlFreq + vec3(0.0, time * curlFlow, 0.0)) * curlAmp;
  vec3 center = base + disp;
  float size = aData.x;
  vec3 wp = center + billRight * (position.x * size) + billUp * (position.y * size);
  vWorldPos = wp;
  vUv = uv;
  vNormH = aData.y;
  vSeed = aData.z;
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`

// Fragment (visible pass): soft round particle, rim eroded by 2D noise; lit
// from bottom→top via the particle's normalised height; scene fog.
const CLOUD_FS = `
precision highp float;
varying vec2 vUv;
varying float vNormH;
varying float vSeed;
varying vec3 vWorldPos;
uniform vec3 cameraPosition;
uniform vec3 litColor;
uniform vec3 shadowColor;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float spriteMode;
uniform float time;

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), u.x),
             mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm2(vec2 p) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 4; i++) { v += a * vn2(p); p *= 2.02; a *= 0.5; }
  return v;
}
void main(void) {
  float r = length(vUv - 0.5) * 2.0;
  float edge = fbm2(vUv * 4.0 + vSeed * 17.0 + vec2(time * 0.05, 0.0));
  float a;
  if (spriteMode > 0.5) {
    // Far LOD: one big soft fluffy blob standing in for the whole cloud.
    a = smoothstep(1.0, 0.05, r) * (0.55 + 0.45 * edge);
  } else {
    // Near LOD: crisp-ish puff eroded by noise so the cluster reads as fluff.
    a = smoothstep(1.0, 0.2, r + (0.5 - edge) * 0.6);
  }
  if (a < 0.04) discard;

  float lightT = clamp(vNormH * 0.55 + 0.45, 0.0, 1.0);
  vec3 col = mix(shadowColor, litColor, lightT);

  float dist = length(vWorldPos - cameraPosition);
  float fogArg = fogDensity * dist;
  float fogFactor = 1.0 - exp(-fogArg * fogArg);
  col = mix(col, fogColor, clamp(fogFactor, 0.0, 1.0));

  gl_FragColor = vec4(col, a);
}
`

// Fragment (shadow/density pass): just accumulate soft white coverage so the
// terrain can read it back as a shadow mask.
const CLOUD_DENSITY_FS = `
precision highp float;
varying vec2 vUv;
void main(void) {
  float r = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.25, r);
  if (a < 0.05) discard;
  gl_FragColor = vec4(1.0, 1.0, 1.0, a * 0.55);
}
`

Effect.ShadersStore['cloudVertexShader'] = CLOUD_VS
Effect.ShadersStore['cloudFragmentShader'] = CLOUD_FS
Effect.ShadersStore['cloudDensityFragmentShader'] = CLOUD_DENSITY_FS

// ---------------------------------------------------------------------------
// Terrain material plugin — samples the cloud shadow RTT in sun-light space and
// darkens the ground. Decoupled from the engine ShadowGenerator so the bird's
// crisp shadow stays untouched.
// ---------------------------------------------------------------------------
class CloudShadowPlugin extends MaterialPluginBase {
  texture: BaseTexture | null = null
  matrix = Matrix.Identity()
  strength = 0.85
  // Warm ochre shadow multiplier: keep red, cut blue hard, so shadowed sand
  // stays a warm desert tone (a neutral/cool grey turns the sand greenish).
  tint = new Color3(0.82, 0.5, 0.28)
  private _on = false

  constructor(material: Material) {
    super(material, 'CloudShadow', 200, { CLOUDSHADOW: false })
  }

  setEnabled(on: boolean) {
    if (this._on === on) return
    this._on = on
    this._enable(on)
    this.markAllDefinesAsDirty()
  }

  getClassName() {
    return 'CloudShadowPlugin'
  }

  prepareDefines(defines: MaterialDefines) {
    defines.CLOUDSHADOW = this._on
  }

  getSamplers(samplers: string[]) {
    samplers.push('cloudShadowSampler')
  }

  getUniforms() {
    return {
      ubo: [
        { name: 'cloudShadowMatrix', size: 16, type: 'mat4' },
        // x = strength, yzw = shadow tint
        { name: 'cloudShadowParams', size: 4, type: 'vec4' },
      ],
    }
  }

  bindForSubMesh(uniformBuffer: UniformBuffer) {
    if (!this._on) return
    uniformBuffer.updateMatrix('cloudShadowMatrix', this.matrix)
    uniformBuffer.updateFloat4(
      'cloudShadowParams',
      this.strength,
      this.tint.r,
      this.tint.g,
      this.tint.b,
    )
    if (this.texture) uniformBuffer.setTexture('cloudShadowSampler', this.texture)
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null
    return {
      // getSamplers only registers the name for binding; a custom sampler must
      // be declared in the shader ourselves (built-in ones live in includes).
      CUSTOM_FRAGMENT_DEFINITIONS: `
        #ifdef CLOUDSHADOW
          uniform sampler2D cloudShadowSampler;
        #endif
      `,
      // Apply BEFORE fog so distant shadows fade into the haze instead of
      // sitting on top of it.
      CUSTOM_FRAGMENT_BEFORE_FOG: `
        #ifdef CLOUDSHADOW
          vec4 csClip = cloudShadowMatrix * vec4(vPositionW, 1.0);
          vec3 csNdc = csClip.xyz / csClip.w;
          vec2 csUv = csNdc.xy * 0.5 + 0.5;
          if (csUv.x > 0.0 && csUv.x < 1.0 && csUv.y > 0.0 && csUv.y < 1.0) {
            float csD = texture2D(cloudShadowSampler, csUv).r;
            float csK = clamp(csD * cloudShadowParams.x, 0.0, 1.0);
            color.rgb *= mix(vec3(1.0), cloudShadowParams.yzw, csK);
          }
        #endif
      `,
    }
  }
}

export interface CloudsProps {
  // How many clouds to scatter across the map.
  count?: number
}

export const Clouds = ({ count = 11 }: CloudsProps) => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return
    let cancelled = false
    let cleanup: (() => void) | null = null

    const setup = async () => {
      // Decals/shadow project onto the terrain mesh, built async by Terrain.tsx.
      let terrain = scene.getMeshByName('terrain') as Mesh | null
      while (!cancelled && !terrain) {
        await new Promise((r) => setTimeout(r, 50))
        terrain = scene.getMeshByName('terrain') as Mesh | null
      }
      if (cancelled || !terrain) return

      const clouds = makeRandomClouds(count, WORLD_HALF)
      if (clouds.length === 0) return
      const total = clouds.reduce((s, c) => s + c.count, 0)

      // Shared thin-instance buffers, sized for every particle. The LOD step
      // packs the near clouds' blocks into the front and limits the draw count.
      const activeMat = new Float32Array(total * 16)
      const activeData = new Float32Array(total * 4)
      const spriteMat = new Float32Array(clouds.length * 16)
      const spriteData = new Float32Array(clouds.length * 4)

      const attributes = ['position', 'uv', 'world0', 'world1', 'world2', 'world3', 'aData']

      const makeMaterial = (name: string, fragment: string, sprite: boolean) => {
        const m = new ShaderMaterial(
          name,
          scene,
          { vertex: 'cloud', fragment },
          {
            attributes,
            uniforms: [
              'viewProjection',
              'billRight',
              'billUp',
              'time',
              'curlAmp',
              'curlFreq',
              'curlFlow',
              'cameraPosition',
              'litColor',
              'shadowColor',
              'fogColor',
              'fogDensity',
              'spriteMode',
            ],
          },
        )
        m.backFaceCulling = false
        m.needAlphaBlending = () => true
        m.disableDepthWrite = true
        m.setFloat('curlAmp', CURL_AMP)
        m.setFloat('curlFreq', CURL_FREQ)
        m.setFloat('curlFlow', CURL_FLOW)
        m.setFloat('spriteMode', sprite ? 1 : 0)
        m.setColor3('litColor', new Color3(1.0, 1.0, 1.0))
        m.setColor3('shadowColor', new Color3(0.85, 0.86, 0.9))
        return m
      }

      const particleMaterial = makeMaterial('cloudParticleMat', 'cloud', false)
      const spriteMaterial = makeMaterial('cloudSpriteMat', 'cloud', true)
      const densityMaterial = makeMaterial('cloudDensityMat', 'cloudDensity', false)

      const buildMesh = (name: string, mat: ShaderMaterial, m16: Float32Array, m4: Float32Array) => {
        const mesh = MeshBuilder.CreatePlane(name, { size: 1 }, scene)
        mesh.material = mat
        mesh.isPickable = false
        mesh.applyFog = false
        mesh.alwaysSelectAsActiveMesh = true // billboards move; skip culling
        mesh.thinInstanceSetBuffer('matrix', m16, 16, false)
        mesh.thinInstanceSetBuffer('aData', m4, 4, false)
        mesh.thinInstanceCount = 0
        return mesh
      }

      const particlesMesh = buildMesh('cloudParticles', particleMaterial, activeMat, activeData)
      const spritesMesh = buildMesh('cloudSprites', spriteMaterial, spriteMat, spriteData)

      // --- Sun camera + cloud-shadow render target ---
      const prevCam = scene.activeCamera
      const sunCam = new FreeCamera(CLOUD_SUN_CAM_NAME, SUN_DIR.scale(2000), scene)
      sunCam.setTarget(Vector3.Zero())
      sunCam.mode = Camera.ORTHOGRAPHIC_CAMERA
      const ext = WORLD_HALF + 350
      sunCam.orthoLeft = -ext
      sunCam.orthoRight = ext
      sunCam.orthoTop = ext
      sunCam.orthoBottom = -ext
      sunCam.minZ = 10
      sunCam.maxZ = 4200
      if (scene.activeCamera !== prevCam) scene.activeCamera = prevCam
      // NB: PostProcess.tsx skips attaching the SSAO pipeline to this camera by
      // name (CLOUD_SUN_CAM_NAME) — its post-processes crash when finalized
      // during the RTT render (MRT framebuffer is null for the RTT).
      // Sun-facing billboard axes for the density pass (static — sun is fixed).
      const sunRight = sunCam.getDirection(Axis.X)
      const sunUp = sunCam.getDirection(Axis.Y)
      densityMaterial.setVector3('billRight', sunRight)
      densityMaterial.setVector3('billUp', sunUp)

      sunCam.getViewMatrix()
      sunCam.getProjectionMatrix()
      const lightMatrix = sunCam.getTransformationMatrix().clone()

      const rtt = new RenderTargetTexture('cloudShadowRTT', 2048, scene, false)
      rtt.renderList = [particlesMesh, spritesMesh]
      rtt.activeCamera = sunCam
      rtt.clearColor = new Color4(0, 0, 0, 0)
      rtt.setMaterialForRendering(particlesMesh, densityMaterial)
      rtt.setMaterialForRendering(spritesMesh, densityMaterial)
      scene.customRenderTargets.push(rtt)

      // --- Terrain receives the cloud shadow ---
      const terrainMat = terrain.material as StandardMaterial | null
      let plugin: CloudShadowPlugin | null = null
      if (terrainMat) {
        // Reuse an existing plugin (HMR re-runs this effect on the same
        // material; Babylon rejects adding two plugins with the same name).
        plugin =
          terrainMat.pluginManager?.getPlugin<CloudShadowPlugin>('CloudShadow') ??
          new CloudShadowPlugin(terrainMat)
        plugin.texture = rtt
        plugin.matrix = lightMatrix
        plugin.setEnabled(true)
      }

      // --- LOD bucketing ---
      const nearFlags = new Array<boolean>(clouds.length).fill(false)
      const rebuild = () => {
        let off = 0
        for (let i = 0; i < clouds.length; i++) {
          if (!nearFlags[i]) continue
          const c = clouds[i]
          activeMat.set(c.matrices, off * 16)
          activeData.set(c.aData, off * 4)
          off += c.count
        }
        particlesMesh.thinInstanceCount = off
        if (off > 0) {
          particlesMesh.thinInstanceBufferUpdated('matrix')
          particlesMesh.thinInstanceBufferUpdated('aData')
        }

        let so = 0
        for (let i = 0; i < clouds.length; i++) {
          if (nearFlags[i]) continue
          const c = clouds[i]
          const b = so * 16
          spriteMat[b] = 1; spriteMat[b + 5] = 1; spriteMat[b + 10] = 1; spriteMat[b + 15] = 1
          spriteMat[b + 12] = c.center.x
          spriteMat[b + 13] = c.center.y
          spriteMat[b + 14] = c.center.z
          const d = so * 4
          spriteData[d] = c.spriteSize
          spriteData[d + 1] = 0.62 // mid normHeight → balanced lighting on the blob
          spriteData[d + 2] = (i * 0.61803398875) % 1
          spriteData[d + 3] = 0
          so++
        }
        spritesMesh.thinInstanceCount = so
        if (so > 0) {
          spritesMesh.thinInstanceBufferUpdated('matrix')
          spritesMesh.thinInstanceBufferUpdated('aData')
        }
      }

      let lodTimer = 0
      let firstBuild = true
      const t0 = performance.now()
      let tPrev = t0

      const obs = scene.onBeforeRenderObservable.add(() => {
        const now = performance.now()
        const t = (now - t0) / 1000
        const dt = Math.max(0, (now - tPrev) / 1000)
        tPrev = now

        const cam = scene.activeCamera
        // Per-frame uniforms shared by both visible materials.
        for (const m of [particleMaterial, spriteMaterial]) {
          m.setFloat('time', t)
          m.setColor3('fogColor', scene.fogColor)
          m.setFloat('fogDensity', scene.fogDensity)
          if (cam) {
            m.setVector3('billRight', cam.getDirection(Axis.X))
            m.setVector3('billUp', cam.getDirection(Axis.Y))
            m.setVector3('cameraPosition', cam.globalPosition)
          }
        }
        densityMaterial.setFloat('time', t)

        // LOD re-evaluation (throttled, with hysteresis).
        lodTimer -= dt
        if (cam && (lodTimer <= 0 || firstBuild)) {
          lodTimer = LOD_INTERVAL
          const cp = cam.globalPosition
          let changed = firstBuild
          for (let i = 0; i < clouds.length; i++) {
            const d = Vector3.Distance(cp, clouds[i].center)
            if (nearFlags[i]) {
              if (d > NEAR_EXIT) { nearFlags[i] = false; changed = true }
            } else if (d < NEAR_ENTER) {
              nearFlags[i] = true; changed = true
            }
          }
          if (changed) rebuild()
          firstBuild = false
        }
      })

      cleanup = () => {
        scene.onBeforeRenderObservable.remove(obs)
        plugin?.setEnabled(false)
        const ri = scene.customRenderTargets.indexOf(rtt)
        if (ri >= 0) scene.customRenderTargets.splice(ri, 1)
        rtt.dispose()
        particlesMesh.dispose()
        spritesMesh.dispose()
        particleMaterial.dispose()
        spriteMaterial.dispose()
        densityMaterial.dispose()
        sunCam.dispose()
      }
    }

    setup().catch(console.error)
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [scene, count])

  return null
}
