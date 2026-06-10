import type { Scene as BabylonScene } from '@babylonjs/core'
import type { GameScene } from './scenes/types.ts'

type Listener = () => void

const scenes = new Map<string, GameScene>()
let activeId: string | null = null
let transitioning = false
// 0 = fully transparent, 1 = fully black
let fadeOpacity = 0
const listeners = new Set<Listener>()
// Babylon scene ref + fallback camera, set by SceneHost/FallbackCamera
let babylonScene: BabylonScene | null = null
let fallbackCamera: import('@babylonjs/core').Camera | null = null

function notify() {
  for (const fn of listeners) fn()
}

export const sceneManager = {
  /** Called by FallbackCamera to register the Babylon scene & fallback cam. */
  _setBabylonScene(scene: BabylonScene | null, cam: import('@babylonjs/core').Camera | null) {
    babylonScene = scene
    fallbackCamera = cam
  },

  register(scene: GameScene) {
    scenes.set(scene.id, scene)
    if (!activeId) {
      activeId = scene.id
    }
    notify()
  },

  unregister(id: string) {
    scenes.delete(id)
    if (activeId === id) activeId = scenes.keys().next().value ?? null
    notify()
  },

  getAll(): GameScene[] {
    return [...scenes.values()]
  },

  getActive(): GameScene | null {
    return activeId ? scenes.get(activeId) ?? null : null
  },

  getActiveId(): string | null {
    return activeId
  },

  isTransitioning(): boolean {
    return transitioning
  },

  getFadeOpacity(): number {
    return fadeOpacity
  },

  /** Switch to a different scene with a fade-to-black transition. */
  async switchTo(id: string) {
    if (id === activeId || transitioning || !scenes.has(id)) return
    transitioning = true
    notify()

    // Fade to black
    await animateFade(0, 1, 400)

    // Activate the fallback camera *before* React unmounts the old scene's
    // components — this prevents the "No camera defined" error that fires if
    // the render loop hits a frame between the old camera's dispose and the
    // new scene mounting its own camera.
    if (babylonScene && fallbackCamera) {
      babylonScene.activeCamera = fallbackCamera
    }

    // Swap active scene (React will unmount old, mount new)
    activeId = id
    notify()

    // Give React enough frames to mount the new scene's components (camera,
    // lights…).
    await waitFrames(3)

    // Fade back in
    await animateFade(1, 0, 400)

    transitioning = false
    notify()
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let count = 0
    const tick = () => {
      if (++count >= n) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

function animateFade(from: number, to: number, duration: number): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now()
    const step = () => {
      const elapsed = performance.now() - start
      const t = Math.min(1, elapsed / duration)
      fadeOpacity = from + (to - from) * t
      notify()
      if (t < 1) requestAnimationFrame(step)
      else resolve()
    }
    requestAnimationFrame(step)
  })
}
