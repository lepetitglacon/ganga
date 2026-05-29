import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import {
  Color3,
  Effect,
  MeshBuilder,
  ShaderMaterial,
} from '@babylonjs/core'
import { OASES } from '@/game/oasis.ts'
import { ensureOasesResolved } from '@/game/terrain.ts'
import { SUN_DIR } from '@/game/world.ts'

// Stylized oasis water. A flat disc per oasis at the resolved waterY, shaded by
// a custom material: animated fbm ripples drive a fake surface normal that
// feeds a fresnel sky-reflection + a sharp sun glint, with a shallow→deep color
// gradient and a soft rim fade into the wet sand. Scene fog (EXP2) is matched
// so distant pools dissolve into the same haze as the dunes — same approach as
// Storm.tsx.

const WATER_VS = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform mat4 world;
varying vec2 vUv;
varying vec3 vWorldPos;
void main(void) {
  vec4 wp = world * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vUv = uv;
  gl_Position = viewProjection * wp;
}
`

const WATER_FS = `
precision highp float;
varying vec2 vUv;
varying vec3 vWorldPos;
uniform float time;
uniform vec3 cameraPosition;
uniform vec3 sunDirection;
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 shallowColor;
uniform vec3 deepColor;
uniform vec3 skyColor;

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
  // Ripples: sample fbm over world XZ and take its gradient as a surface tilt.
  // Two layers drifting in different directions read as wind-rippled water.
  vec2 p = vWorldPos.xz * 0.18;
  vec2 drift = vec2(time * 0.05, time * 0.035);
  float e = 0.08;
  float n0 = fbm(p + drift);
  float nx = fbm(p + vec2(e, 0.0) + drift);
  float nz = fbm(p + vec2(0.0, e) + drift);
  float n2 = fbm(p * 1.7 - drift * 1.3);
  float nx2 = fbm(p * 1.7 + vec2(e, 0.0) - drift * 1.3);
  float nz2 = fbm(p * 1.7 + vec2(0.0, e) - drift * 1.3);
  float gx = (n0 - nx) / e + (n2 - nx2) / e * 0.5;
  float gz = (n0 - nz) / e + (n2 - nz2) / e * 0.5;
  vec3 normal = normalize(vec3(gx * 0.18, 1.0, gz * 0.18));

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fres = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);

  // Radial position on the disc (CreateDisc uvs put the center at 0.5,0.5).
  float r = length(vUv - 0.5) * 2.0;
  vec3 base = mix(deepColor, shallowColor, smoothstep(0.45, 1.0, r));

  // Sun glint via Blinn-Phong half-vector against the rippled normal.
  vec3 halfv = normalize(viewDir + normalize(sunDirection));
  float spec = pow(max(dot(normal, halfv), 0.0), 90.0);

  vec3 col = mix(base, skyColor, fres * 0.6);
  col += spec * vec3(1.0, 0.96, 0.88) * 0.9;

  // Fade to transparent at the very rim so the disc edge blends into wet sand.
  float edgeFade = 1.0 - smoothstep(0.86, 1.0, r);
  float alpha = mix(0.6, 0.92, fres) * edgeFade;

  // Scene fog (FOGMODE_EXP2), matching Environment/Storm.
  float dist = length(vWorldPos - cameraPosition);
  float fogArg = fogDensity * dist;
  float fogFactor = 1.0 - exp(-fogArg * fogArg);
  col = mix(col, fogColor, clamp(fogFactor, 0.0, 1.0));

  gl_FragColor = vec4(col, alpha);
}
`

Effect.ShadersStore['oasisWaterVertexShader'] = WATER_VS
Effect.ShadersStore['oasisWaterFragmentShader'] = WATER_FS

export const Water = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return
    // waterY / floorY come from the procedural terrain — make sure they're set.
    ensureOasesResolved()

    const mat = new ShaderMaterial(
      'oasisWaterMat',
      scene,
      { vertex: 'oasisWater', fragment: 'oasisWater' },
      {
        attributes: ['position', 'uv'],
        uniforms: [
          'world',
          'viewProjection',
          'time',
          'cameraPosition',
          'sunDirection',
          'fogColor',
          'fogDensity',
          'shallowColor',
          'deepColor',
          'skyColor',
        ],
      },
    )
    mat.backFaceCulling = false // visible from below if the bird dives under
    mat.needAlphaBlending = () => true
    mat.alpha = 0.999
    mat.setColor3('shallowColor', new Color3(0.32, 0.62, 0.6))
    mat.setColor3('deepColor', new Color3(0.05, 0.22, 0.32))
    mat.setColor3('skyColor', new Color3(0.78, 0.86, 0.92))
    mat.setVector3('sunDirection', SUN_DIR)

    const discs = OASES.map((o, i) => {
      const disc = MeshBuilder.CreateDisc(
        `oasisWater-${i}`,
        { radius: o.waterRadius, tessellation: 48 },
        scene,
      )
      // CreateDisc lies in the XY plane facing +Z; rotate flat (normal +Y).
      disc.rotation.x = Math.PI / 2
      disc.position.set(o.x, o.waterY, o.z)
      disc.material = mat
      disc.isPickable = false
      disc.applyFog = false // fog handled inside the shader
      disc.alwaysSelectAsActiveMesh = true
      return disc
    })

    const t0 = performance.now()
    const obs = scene.onBeforeRenderObservable.add(() => {
      mat.setFloat('time', (performance.now() - t0) / 1000)
      mat.setColor3('fogColor', scene.fogColor)
      mat.setFloat('fogDensity', scene.fogDensity)
      const cam = scene.activeCamera
      if (cam) mat.setVector3('cameraPosition', cam.globalPosition)
    })

    return () => {
      scene.onBeforeRenderObservable.remove(obs)
      discs.forEach((d) => d.dispose())
      mat.dispose()
    }
  }, [scene])

  return null
}
