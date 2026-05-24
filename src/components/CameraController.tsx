import { useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import { ArcRotateCamera, UniversalCamera, Vector3, Scalar } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'

const MOUSE_SENSITIVITY = 0.002
// Near-full vertical orbit; epsilons avoid gimbal lock at the poles.
const BETA_MIN = 0.05
const BETA_MAX = Math.PI - 0.05
// Higher = camera snaps faster to the bird. Lower in flight so the bird
// leads and the camera trails (Feather-style chase).
const FOLLOW_LAG_FLYING = 2.8
const FOLLOW_LAG_GROUNDED = 20

export const CameraController = () => {
  const scene = useScene()
  const lastTimeRef = useRef(performance.now())

  useEffect(() => {
    if (!scene) return
    const canvas = scene.getEngine().getRenderingCanvas()!

    const arcCam = new ArcRotateCamera(
      'arcCam',
      gameStore.camAlpha,
      gameStore.camBeta,
      22,
      Vector3.Zero(),
      scene
    )
    arcCam.lowerRadiusLimit = 3
    arcCam.upperRadiusLimit = 60
    arcCam.lowerBetaLimit = BETA_MIN
    arcCam.upperBetaLimit = BETA_MAX
    arcCam.minZ = 0.1
    gameStore.arcCam = arcCam

    const freeCam = new UniversalCamera('freeCam', new Vector3(0, 5, -10), scene)
    freeCam.setTarget(Vector3.Zero())
    freeCam.keysUp = [87]
    freeCam.keysDown = [83]
    freeCam.keysLeft = [65]
    freeCam.keysRight = [68]
    freeCam.speed = 0.3
    freeCam.minZ = 0.1

    scene.activeCamera = arcCam

    const requestLock = () => {
      if (!document.pointerLockElement) canvas.requestPointerLock()
    }
    canvas.addEventListener('click', requestLock)

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return
      if (gameStore.camMode !== 'third') return
      // Mouse drives the camera directly
      gameStore.camAlpha -= e.movementX * MOUSE_SENSITIVITY
      gameStore.camBeta = Scalar.Clamp(
        gameStore.camBeta - e.movementY * MOUSE_SENSITIVITY,
        BETA_MIN,
        BETA_MAX
      )
    }
    document.addEventListener('mousemove', onMouseMove)

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.code !== 'KeyC') return
      e.preventDefault()
      if (gameStore.camMode === 'third') {
        gameStore.camMode = 'first'
        const mesh = gameStore.mesh
        if (mesh) {
          freeCam.position.copyFrom(mesh.position.add(new Vector3(0, 2, -5)))
          freeCam.setTarget(mesh.position.clone())
        }
        freeCam.attachControl(canvas, true)
        scene.activeCamera = freeCam
      } else {
        gameStore.camMode = 'third'
        freeCam.detachControl()
        scene.activeCamera = arcCam
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      canvas.removeEventListener('click', requestLock)
      document.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
      arcCam.dispose()
      freeCam.dispose()
      gameStore.arcCam = null
    }
  }, [scene])

  useBeforeRender(() => {
    const cam = gameStore.arcCam
    const mesh = gameStore.mesh
    if (!cam || gameStore.camMode !== 'third') return

    // Apply mouse angles directly — camera owns its own rotation
    cam.alpha = gameStore.camAlpha
    cam.beta = gameStore.camBeta

    const now = performance.now()
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05)
    lastTimeRef.current = now

    // Target follows the physics body (not the visually-bobbing mesh),
    // lagging in flight so the bird leads.
    const body = gameStore.physics?.playerBody
    if (body) {
      const bt = body.translation()
      const k = gameStore.birdMode === 'flying' ? FOLLOW_LAG_FLYING : FOLLOW_LAG_GROUNDED
      const t = 1 - Math.exp(-k * dt)
      cam.target.set(
        cam.target.x + (bt.x - cam.target.x) * t,
        cam.target.y + (bt.y - cam.target.y) * t,
        cam.target.z + (bt.z - cam.target.z) * t,
      )
    } else if (mesh) {
      const k = gameStore.birdMode === 'flying' ? FOLLOW_LAG_FLYING : FOLLOW_LAG_GROUNDED
      const t = 1 - Math.exp(-k * dt)
      Vector3.LerpToRef(cam.target, mesh.position, t, cam.target)
    }
  })

  return null
}
