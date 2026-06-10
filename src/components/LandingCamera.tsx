import { useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import { ArcRotateCamera, Vector3 } from '@babylonjs/core'
import { getDuneHeight } from '@/game/terrain.ts'

// Ambient camera for the LandingScene: the same slow, high cinematic orbit the
// intro used (IntroSequence) — circling the bird at the centre of the dunes.
// No mouse control or pointer-lock; it's a backdrop for the title menu.

// Matches IntroSequence's cinematic orbit.
const ORBIT_RADIUS = 170 // horizontal distance from the centre
const ORBIT_HEIGHT = 55 // metres above the look-at point
const LOOK_HEIGHT = 8 // raise the target a touch above the ground
const ORBIT_SPEED = 0.05 // rad/s — barely moving, very calm
const FOV = 0.8

// ArcRotateCamera equivalents of the (radius, height) orbit above.
const RADIUS = Math.hypot(ORBIT_RADIUS, ORBIT_HEIGHT)
const BETA = Math.atan2(ORBIT_RADIUS, ORBIT_HEIGHT)
// Clearance kept between the camera and any dune under it (never clip sand).
const GROUND_MARGIN = 2

export const LandingCamera = () => {
  const scene = useScene()
  const camRef = useRef<ArcRotateCamera | null>(null)

  useEffect(() => {
    if (!scene) return
    const cam = new ArcRotateCamera(
      'landingCam',
      0,
      BETA,
      RADIUS,
      new Vector3(0, getDuneHeight(0, 0) + LOOK_HEIGHT, 0),
      scene,
    )
    cam.minZ = 0.1
    cam.fov = FOV
    scene.activeCamera = cam
    camRef.current = cam
    return () => {
      camRef.current = null
      cam.dispose()
    }
  }, [scene])

  useBeforeRender(() => {
    const cam = camRef.current
    if (!cam || !scene) return

    cam.alpha += ORBIT_SPEED * (scene.getEngine().getDeltaTime() / 1000)

    // Lift the whole target/camera pair so the camera never dips into a dune.
    // Moving the target by Δy moves the camera by the same Δy (it orbits the
    // target), preserving the look direction onto the bird.
    let targetY = getDuneHeight(0, 0) + LOOK_HEIGHT
    const sb = Math.sin(cam.beta)
    const cb = Math.cos(cam.beta)
    const camX = cam.radius * Math.cos(cam.alpha) * sb
    const camZ = cam.radius * Math.sin(cam.alpha) * sb
    const camY = targetY + cam.radius * cb
    const minY = getDuneHeight(camX, camZ) + GROUND_MARGIN
    if (camY < minY) targetY += minY - camY
    cam.target.set(0, targetY, 0)
  })

  return null
}
