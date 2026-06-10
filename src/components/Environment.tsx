import { useEffect } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import {
  Effect,
  MeshBuilder,
  ShaderMaterial,
} from '@babylonjs/core'
import {
  GROUND_COLOR,
  HORIZON_COLOR,
  SUN_DIR,
  SUN_TINT,
  ZENITH_COLOR,
} from '@/game/world.ts'
import { fog } from '@/game/fog.ts'
import { gameStore } from '@/game/gameStore.ts'

const SKY_VS = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void) {
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`

const SKY_FS = `
precision highp float;
varying vec3 vDir;
uniform vec3 horizonColor;
uniform vec3 zenithColor;
uniform vec3 groundColor;
uniform vec3 sunDirection;
uniform vec3 sunColor;
void main(void) {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 sky;
  if (h >= 0.0) {
    float t = pow(clamp(h, 0.0, 1.0), 0.55);
    sky = mix(horizonColor, zenithColor, t);
  } else {
    float t = pow(clamp(-h, 0.0, 1.0), 0.5);
    sky = mix(horizonColor, groundColor, t);
  }
  vec3 sd = normalize(sunDirection);
  float sunDot = max(dot(dir, sd), 0.0);
  float disk = smoothstep(0.9985, 0.9997, sunDot);
  float halo = pow(sunDot, 28.0) * 0.45;
  // Horizon glow around the sun direction
  float horizonGlow = pow(sunDot, 4.0) * (1.0 - clamp(abs(h) * 2.0, 0.0, 1.0)) * 0.35;
  sky += sunColor * (disk + halo + horizonGlow);
  gl_FragColor = vec4(sky, 1.0);
}
`

Effect.ShadersStore['journeySkyVertexShader'] = SKY_VS
Effect.ShadersStore['journeySkyFragmentShader'] = SKY_FS

export const Environment = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return

    // Fog blends terrain into the sky at the horizon, hiding the heightmap edge.
    // All fog state lives in the fog controller (color = HORIZON_COLOR so the
    // sky shader's h≈0 band matches it exactly). This is the single writer of
    // scene.fog*; every custom shader just mirrors it.
    fog.attach(scene)

    const sky = MeshBuilder.CreateSphere(
      'skybox',
      { diameter: 2, segments: 16 },
      scene
    )
    sky.infiniteDistance = true
    sky.applyFog = false

    const mat = new ShaderMaterial(
      'skyMat',
      scene,
      { vertex: 'journeySky', fragment: 'journeySky' },
      {
        attributes: ['position'],
        uniforms: [
          'worldViewProjection',
          'horizonColor',
          'zenithColor',
          'groundColor',
          'sunDirection',
          'sunColor',
        ],
      }
    )
    mat.backFaceCulling = false
    mat.disableDepthWrite = true
    mat.setColor3('horizonColor', HORIZON_COLOR)
    mat.setColor3('zenithColor', ZENITH_COLOR)
    mat.setColor3('groundColor', GROUND_COLOR)
    mat.setVector3('sunDirection', SUN_DIR)
    mat.setColor3('sunColor', SUN_TINT)
    sky.material = mat
    // Render before everything else so opaque geometry overwrites it where needed.
    sky.renderingGroupId = 0
    // Exposed so BiomeController can lerp the horizon band to match biome fog.
    gameStore.skyMaterial = mat

    return () => {
      sky.dispose()
      mat.dispose()
      fog.detach()
      gameStore.skyMaterial = null
    }
  }, [scene])

  // Localized fog boost as the player nears/enters a storm wall. gameStore
  // .stormProximity is the centralized signal (written by Player); routing it
  // through the fog controller keeps storms as the ONLY thing modulating fog,
  // without any Storm component touching scene.fog* itself.
  useBeforeRender(() => {
    fog.setStormProximity(gameStore.stormProximity)
  })

  return null
}