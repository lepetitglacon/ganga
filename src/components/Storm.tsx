import { useEffect } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import {
  Effect,
  Matrix,
  MeshBuilder,
  Quaternion,
  ShaderMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import { makeDefaultStorm, shellRadiusAt } from '@/game/storm.ts'
import { getTerrainHeight } from '@/game/terrain.ts'
import { SUN_DIR } from '@/game/world.ts'

const STORM_VS = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
uniform mat4 viewProjection;
uniform mat4 world; // mesh's world matrix (root transform: position + Y swirl)
uniform float stormHeight;
varying vec2 vUv;
varying vec3 vWorldPos;
varying float vInstanceSeed;
varying vec3 vRadial; // outward radial direction of the patch in cone-local space
// Per-instance hash on the instance's local translation (W column 3).
// Constant across the quad, so it produces a stable per-patch tint variation.
float ihash3(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}
void main(void) {
  mat4 Wi = mat4(world0, world1, world2, world3);
  // Compose mesh world * instance local → real world position.
  vec4 wp = world * Wi * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vUv = uv;
  vInstanceSeed = ihash3(world3.xyz);
  // Radial direction of this patch: normalized XZ of the local translation.
  // Cone is centered at root origin, so world3.xz points outward from the axis.
  vec2 rad = world3.xz;
  float rlen = max(length(rad), 0.0001);
  vRadial = vec3(rad.x / rlen, 0.0, rad.y / rlen);
  gl_Position = viewProjection * wp;
}
`

const STORM_FS = `
precision highp float;
varying vec2 vUv;
varying vec3 vWorldPos;
varying float vInstanceSeed;
varying vec3 vRadial;
uniform float time;
uniform vec3 sandColor;
uniform vec3 tintA;
uniform vec3 tintB;
uniform float brightnessMin;
uniform float brightnessMax;
uniform float patchOpacity;
uniform float bottomFadeEnd;
uniform float topFadeStart;
uniform float noiseScrollSpeed;
uniform float streakMix;
uniform float stormBaseY;
uniform float stormHeight;
// Scene integration
uniform vec3 cameraPosition;
uniform vec3 sunDirection;
uniform vec3 fogColor;
uniform float fogDensity;
// Self-shadow contrast: how much the side of the cone facing away from the
// sun is darkened (0 = no shading, 1 = full half-dark). ~0.5 reads well.
uniform float shadeStrength;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main(void) {
  // Anisotropic noise: streaks stretched horizontally (along the tangent of
  // the cone) and scrolling fast → reads clearly as wind even when the cone
  // is far away. The slow vertical component adds depth without killing the
  // horizontal flow.
  vec2 baseUv = vUv * vec2(1.6, 5.5);
  baseUv += vec2(vWorldPos.x * 0.05 + vWorldPos.z * 0.05, vWorldPos.y * 0.04);
  vec2 scroll = vec2(time * noiseScrollSpeed, time * 0.1);
  float n = fbm(baseUv + scroll);
  // Secondary high-frequency streaks moving faster — visible "gust" lines.
  float streaks = fbm(baseUv * vec2(0.8, 3.0) + vec2(time * noiseScrollSpeed * 1.7, 0.0));
  n = mix(n, streaks, streakMix);
  // Contrast remap: push the midtones apart so the noise reads as crisp
  // sand puffs instead of a soft mush.
  n = smoothstep(0.25, 0.85, n);

  // Soft quad edges so we don't see rectangle silhouettes.
  float ex = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
  float ey = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.88, 1.0, vUv.y));
  float edge = ex * ey;

  // Height fade: dim hard at the very bottom (touches the dunes) and at the
  // top (cone dissipates into the sky).
  float y01 = clamp((vWorldPos.y - stormBaseY) / stormHeight, 0.0, 1.0);
  float bottomFade = smoothstep(0.0, bottomFadeEnd, y01);
  float topFade = 1.0 - smoothstep(topFadeStart, 1.0, y01);

  float alpha = n * edge * bottomFade * topFade * patchOpacity;
  // Discard aggressively so the depth buffer only records solid parts of a
  // patch. Without this, faint feathered edges write depth and create hard
  // halos around every quad.
  if (alpha < 0.25) discard;
  // Per-patch tint variation: each patch is a mix of tintA / tintB by its
  // instance hash, with a brightness factor in [brightnessMin, brightnessMax].
  vec3 patchTint = mix(tintA, tintB, vInstanceSeed);
  float brightness = mix(brightnessMin, brightnessMax, fract(vInstanceSeed * 7.31));
  vec3 col = mix(sandColor, sandColor * 1.15, y01) * patchTint * brightness;

  // --- Self-shadowing approximation ---
  // Patches facing the sun stay bright; patches on the back of the cone get
  // darker. Reads as the storm being a real volume in scene lighting.
  float lit = 0.5 + 0.5 * dot(normalize(vRadial), normalize(sunDirection));
  float shade = mix(1.0 - shadeStrength, 1.0, lit);
  col *= shade;

  // --- Scene fog (FOGMODE_EXP2) ---
  // Match Environment.tsx: factor = 1 - exp(-(density * dist)^2). The cone
  // dissolves into the same horizon haze as the dunes.
  float dist = length(vWorldPos - cameraPosition);
  float fogArg = fogDensity * dist;
  float fogFactor = 1.0 - exp(-fogArg * fogArg);
  col = mix(col, fogColor, clamp(fogFactor, 0.0, 1.0));

  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`

Effect.ShadersStore['stormVertexShader'] = STORM_VS
Effect.ShadersStore['stormFragmentShader'] = STORM_FS

export const Storm = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return

    // Wait for terrain heights, then plant the storm at ground level.
    let cleanup: (() => void) | null = null

    const setup = () => {
      // Build the storm first to learn its XZ, then sample the terrain at
      // that location so the cone's base sits on the actual ground.
      const storm = makeDefaultStorm(0)
      storm.center.y = getTerrainHeight(storm.center.x, storm.center.z)
      gameStore.storms.push(storm)

      const root = new TransformNode('stormRoot', scene)
      // thinInstance matrices are kept in root-local space; the root's Y
      // rotation drives the visible swirl without rebuilding the buffer.
      const N = storm.patchCount
      const half = storm.wallThickness / 2
      const buf = new Float32Array(N * 16)
      const tmpScale = new Vector3(storm.patchWidth, storm.patchHeight, 1)
      const tmpMat = new Matrix()
      for (let i = 0; i < N; i++) {
        const theta = Math.random() * Math.PI * 2
        const y01 = Math.pow(Math.random(), 0.7)
        const relY = y01 * storm.height
        const r = shellRadiusAt(storm, relY) + (Math.random() - 0.5) * half * 2
        const cos = Math.cos(theta)
        const sin = Math.sin(theta)
        // Local position (relative to root which sits at storm.center).
        const px = cos * r
        const py = relY
        const pz = sin * r
        // +π flips each patch so its front face points radially OUTWARD.
        // The default plane has its front along +Z, and our base rotation
        // pointed +Z toward the cone axis instead of away from it.
        const yaw = Math.atan2(cos, sin) + Math.PI
        const rot = Quaternion.FromEulerAngles(0, yaw, 0)
        Matrix.ComposeToRef(tmpScale, rot, new Vector3(px, py, pz), tmpMat)
        tmpMat.copyToArray(buf, i * 16)
      }

      root.position.copyFrom(storm.center)

      const plane = MeshBuilder.CreatePlane('stormQuad', { width: 1, height: 1 }, scene)
      plane.parent = root
      plane.alwaysSelectAsActiveMesh = true // skip frustum culling per-instance
      plane.isPickable = false
      plane.applyFog = false
      plane.thinInstanceSetBuffer('matrix', buf, 16, true)

      const mat = new ShaderMaterial(
        'stormMat',
        scene,
        { vertex: 'storm', fragment: 'storm' },
        {
          attributes: ['position', 'uv', 'world0', 'world1', 'world2', 'world3'],
          uniforms: [
            'world',
            'viewProjection',
            'time',
            'sandColor',
            'tintA',
            'tintB',
            'brightnessMin',
            'brightnessMax',
            'patchOpacity',
            'bottomFadeEnd',
            'topFadeStart',
            'noiseScrollSpeed',
            'streakMix',
            'stormBaseY',
            'stormHeight',
            'cameraPosition',
            'sunDirection',
            'fogColor',
            'fogDensity',
            'shadeStrength',
          ],
        },
      )
      // Two-pass cone:
      //   - This material/mesh = FRONT pass. Backface culling keeps only the
      //     half of the cone whose patch normals face the camera (front half).
      //   - A cloned mesh with flipped faces + dimmed material = BACK pass,
      //     drawn first and faintly so the front facade reads as solid while
      //     the silhouette of the far side bleeds through gaps.
      mat.backFaceCulling = true
      mat.needAlphaBlending = () => true
      mat.alpha = 0.999 // ensure transparency path
      mat.setColor3('sandColor', storm.sandColor)
      mat.setColor3('tintA', storm.tintA)
      mat.setColor3('tintB', storm.tintB)
      mat.setFloat('brightnessMin', storm.brightnessMin)
      mat.setFloat('brightnessMax', storm.brightnessMax)
      mat.setFloat('patchOpacity', storm.patchOpacity)
      mat.setFloat('bottomFadeEnd', storm.bottomFadeEnd)
      mat.setFloat('topFadeStart', storm.topFadeStart)
      mat.setFloat('noiseScrollSpeed', storm.noiseScrollSpeed)
      mat.setFloat('streakMix', storm.streakMix)
      mat.setFloat('stormBaseY', storm.center.y)
      mat.setFloat('stormHeight', storm.height)
      mat.setVector3('sunDirection', SUN_DIR)
      mat.setFloat('shadeStrength', 0.55)
      plane.material = mat
      mat.disableDepthWrite = false

      // --- BACK PASS ---
      // Clone the plane and flip its winding. With backFaceCulling still on,
      // the clone renders the half of the cone the original mesh hides. A
      // separate material instance lets us dim its opacity so the front pass
      // stays visually dominant.
      const planeBack = plane.clone('stormQuadBack')!
      // Clones share geometry by default — flipping faces here would also flip
      // the original. Detach the geometry first so the flip is isolated.
      planeBack.makeGeometryUnique()
      planeBack.flipFaces(true)
      planeBack.thinInstanceSetBuffer('matrix', buf, 16, true)
      const matBack = mat.clone('stormMatBack') as ShaderMaterial
      matBack.backFaceCulling = true
      matBack.disableDepthWrite = false
      // Dim the back pass — silhouette is enough, we don't want it competing
      // with the front patches in brightness.
      matBack.setFloat('patchOpacity', storm.patchOpacity * 0.45)
      matBack.setFloat('brightnessMin', storm.brightnessMin * 0.55)
      matBack.setFloat('brightnessMax', storm.brightnessMax * 0.55)
      planeBack.material = matBack

      // Render order: back pass first (group 0), front pass on top (group 1).
      // Disable auto-clear-depth on group 1 so the front pass can depth-test
      // against the back pass's depth (otherwise group 1 starts with a fresh
      // depth buffer and the layering gains nothing).
      planeBack.renderingGroupId = 0
      plane.renderingGroupId = 1
      scene.setRenderingAutoClearDepthStencil(1, false, true, true)

      let t0 = performance.now()

      const obs = scene.onBeforeRenderObservable.add(() => {
        const now = performance.now()
        const t = (now - t0) / 1000
        mat.setFloat('time', t)
        matBack.setFloat('time', t)
        // Swirl: rotate the whole cone around Y. Cheap visual that sells motion.
        root.rotation.y = t * storm.windAngularSpeed
        // Sync scene fog into both shaders (Environment owns the baseline).
        const cam = scene.activeCamera
        mat.setColor3('fogColor', scene.fogColor)
        mat.setFloat('fogDensity', scene.fogDensity)
        matBack.setColor3('fogColor', scene.fogColor)
        matBack.setFloat('fogDensity', scene.fogDensity)
        if (cam) {
          mat.setVector3('cameraPosition', cam.globalPosition)
          matBack.setVector3('cameraPosition', cam.globalPosition)
        }
      })

      cleanup = () => {
        scene.onBeforeRenderObservable.remove(obs)
        const idx = gameStore.storms.indexOf(storm)
        if (idx >= 0) gameStore.storms.splice(idx, 1)
        planeBack.dispose()
        matBack.dispose()
        plane.dispose()
        mat.dispose()
        root.dispose()
        // Restore default group-1 auto-clear behavior.
        scene.setRenderingAutoClearDepthStencil(1, true, true, true)
      }
    }

    setup()
    return () => {
      cleanup?.()
    }
  }, [scene])

  // Drive a localized fog boost when the player is near/in a storm wall.
  // We touch scene.fogDensity directly — Environment owns the baseline.
  useBeforeRender(() => {
    if (!scene) return
    const baseDensity = 0.0042
    const prox = gameStore.stormProximity
    // Smoothly add up to +0.018 to the fog density when fully inside the wall.
    scene.fogDensity = baseDensity + prox * 0.018
  })

  return null
}
