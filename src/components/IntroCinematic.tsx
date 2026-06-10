import { useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import { UniversalCamera, Vector3, Color3, type Mesh } from '@babylonjs/core'
import { getDuneHeight } from '@/game/terrain.ts'
import { gameStore } from '@/game/gameStore.ts'
import { fog } from '@/game/fog.ts'
import { introStore } from '@/game/introStore.ts'
import { sceneManager } from '@/game/sceneManager.ts'
import { audio } from '@/game/audio.ts'
import { loadGLB, type LoadedModel } from '@/components/intro/loadGLB.ts'
import { createRain, createCurrent, type Rain } from '@/components/intro/weather.ts'

// Cinematic intro for the world. A fixed timeline of camera shots over a
// lightweight staged set (dunes + a departing flock, an abandoned egg, the
// returning rain that sweeps the egg into a stream, the elephants who recover
// it, the hatching, and the grown bird landing on the elephant) with French
// narration. Auto-advances to the desert; Échap skips.
//
// Everything is driven imperatively from a single master clock so the props,
// weather and camera stay in lockstep. No dependency on the gameplay cutscene
// director.

const INTRO_MUSIC_URL = '/sound/ambiance/intro.mp3'
const INTRO_MUSIC_VOLUME = 0.55
const MUSIC_FADE_IN = 0.4
const GROUND_MARGIN = 3

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smooth = (x: number) => x * x * (3 - 2 * x)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const v = (x: number, y: number, z: number) => new Vector3(x, y, z)

// --- staging layout (world coords) -----------------------------------------
const G = getDuneHeight(0, 0) // ground at the egg / origin

// The elephant stands downstream; the egg drifts to just in front of it.
const ELE = v(46, getDuneHeight(46, 4), 4)
const EGG_END_X = ELE.x - 4
const ELE_H = 4.2
// Approx top-of-head, where the grown bird perches.
const HEAD = v(ELE.x - 2.2, ELE.y + ELE_H * 0.82, ELE.z + 0.3)

// Egg drift along the current.
const DRIFT_START = 27
const DRIFT_END = 40
function eggPos(t: number): Vector3 {
  const d = clamp01((t - DRIFT_START) / (DRIFT_END - DRIFT_START))
  const x = lerp(0, EGG_END_X, smooth(d))
  const z = Math.sin(d * Math.PI) * 2
  const ground = getDuneHeight(x, z)
  const bob = d > 0 && d < 1 ? Math.sin(t * 3) * 0.15 : 0
  return v(x, ground + 0.18 + bob, z)
}

// Flock leaving toward the sun (+Z, climbing).
function flockPos(t: number): Vector3 {
  const d = clamp01((t - 7) / 9)
  return v(lerp(6, 95, d), G + lerp(12, 88, d), lerp(-6, 210, d))
}

// Grown bird's flight from the egg spot up onto the elephant's head.
const LAND_START = 47
const LAND_END = 52.5
function grownBirdPos(t: number): Vector3 {
  const d = clamp01((t - LAND_START) / (LAND_END - LAND_START))
  const from = eggPos(DRIFT_END)
  const x = lerp(from.x, HEAD.x, smooth(d))
  const z = lerp(from.z, HEAD.z, smooth(d))
  const y = lerp(from.y, HEAD.y, smooth(d)) + Math.sin(d * Math.PI) * 2.2 // arc up
  return v(x, y, z)
}

// 0..1 "wetness" of the world: drives rain, grey sky and dimmed sun.
function wetness(t: number): number {
  if (t < 22) return 0
  if (t < 25) return smooth((t - 22) / 3)
  if (t < 44) return 1
  if (t < 49) return 1 - smooth((t - 44) / 5)
  return 0
}

// --- shot list --------------------------------------------------------------
type Pose = Vector3 | ((t: number) => Vector3)
type Beat = {
  start: number
  end: number
  fov: number
  caption: string
  pos: Pose
  target: Pose
}

const resolve = (p: Pose, t: number) => (typeof p === 'function' ? p(t) : p)

const BEATS: Beat[] = [
  {
    start: 0,
    end: 7,
    fov: 0.85,
    caption: 'Le désert se meurt. La sécheresse a tout brûlé.',
    pos: (t) => Vector3.Lerp(v(-150, G + 120, -150), v(-110, G + 88, -110), smooth(clamp01(t / 7))),
    target: (t) => Vector3.Lerp(v(0, G + 8, 0), v(0, G + 5, 0), clamp01(t / 7)),
  },
  {
    start: 7,
    end: 15,
    fov: 0.9,
    caption: 'Les Gangas s’en vont, fuyant la chaleur du désert.',
    pos: (t) => Vector3.Lerp(v(10, G + 16, -28), v(2, G + 24, -44), smooth(clamp01((t - 7) / 8))),
    target: (t) => flockPos(t),
  },
  {
    start: 15,
    end: 22,
    fov: 0.75,
    caption: 'Mais un œuf est resté là, oublié sur le sable.',
    pos: (t) => Vector3.Lerp(v(5, G + 5, 5.5), v(1.8, G + 1.7, 2.0), smooth(clamp01((t - 15) / 7))),
    target: (t) => eggPos(t).add(v(0, 0.4, 0)),
  },
  {
    start: 22,
    end: 27,
    fov: 0.8,
    caption: 'Puis, enfin… la pluie revient.',
    pos: (t) => Vector3.Lerp(v(1.8, G + 1.7, 2.0), v(2.4, G + 2.2, 2.6), smooth(clamp01((t - 22) / 5))),
    target: (t) => eggPos(t).add(v(0, 0.4, 0)),
  },
  {
    start: 27,
    end: 34,
    fov: 0.85,
    caption: 'Et le courant l’emporte au loin.',
    pos: (t) => eggPos(t).add(v(-3.5, 2.6, -4.2)),
    target: (t) => eggPos(t).add(v(0, 0.2, 0)),
  },
  {
    start: 34,
    end: 41,
    fov: 0.9,
    caption: 'Les éléphants fêtent le retour de l’eau, et recueillent l’œuf.',
    pos: (t) => Vector3.Lerp(v(ELE.x - 13, ELE.y + 8, ELE.z - 13), v(ELE.x - 9, ELE.y + 5.5, ELE.z - 10), smooth(clamp01((t - 34) / 7))),
    target: (t) => Vector3.Center(eggPos(t), v(ELE.x, ELE.y + 2.5, ELE.z)),
  },
  {
    start: 41,
    end: 47,
    fov: 0.7,
    caption: 'L’œuf éclot : un Ganga voit le jour.',
    pos: (t) => Vector3.Lerp(v(EGG_END_X - 3, G + 2.4, 3.2), v(EGG_END_X - 2.2, G + 1.8, 2.4), smooth(clamp01((t - 41) / 6))),
    target: v(EGG_END_X, G + 0.8, 0),
  },
  {
    start: 47,
    end: 54,
    fov: 0.85,
    caption: 'Devenu grand, il revient se poser sur son ami — comme au premier jour.',
    pos: (t) => Vector3.Lerp(v(ELE.x - 10, ELE.y + 5, ELE.z - 8), v(ELE.x - 6.5, ELE.y + 5.6, ELE.z - 5.5), smooth(clamp01((t - 47) / 7))),
    target: (t) => Vector3.Center(grownBirdPos(t), HEAD),
  },
]
const TOTAL = BEATS[BEATS.length - 1].end

export const IntroCinematic = () => {
  const scene = useScene()
  const camRef = useRef<UniversalCamera | null>(null)
  const clockRef = useRef(0)
  const lastTimeRef = useRef(performance.now())
  const beatRef = useRef(-1)
  const finishedRef = useRef(false)
  const musicRef = useRef<{ setVolume: (v: number) => void } | null>(null)
  const musicVolRef = useRef(0)

  // Loaded props (filled async).
  const flockRef = useRef<LoadedModel[]>([])
  const eggRef = useRef<LoadedModel | null>(null)
  const eleRef = useRef<LoadedModel | null>(null)
  const grownRef = useRef<LoadedModel | null>(null)
  const rainRef = useRef<Rain | null>(null)
  const currentRef = useRef<Mesh | null>(null)
  // Base sun look, restored implicitly when the scene unmounts.
  const sunBaseRef = useRef(1.6)

  const finish = () => {
    if (finishedRef.current) return
    finishedRef.current = true
    introStore.setCaption(null)
    sceneManager.switchTo('desert')
  }

  useEffect(() => {
    if (!scene) return
    let cancelled = false
    const isCancelled = () => cancelled

    const first = BEATS[0]
    const cam = new UniversalCamera('introCam', resolve(first.pos, 0), scene)
    cam.fov = first.fov
    cam.minZ = 0.1
    cam.setTarget(resolve(first.target, 0))
    scene.activeCamera = cam
    camRef.current = cam

    if (gameStore.sun) sunBaseRef.current = gameStore.sun.intensity

    // Weather props.
    rainRef.current = createRain(scene)
    currentRef.current = createCurrent(scene, eggPos(0).add(v(0, -0.05, 0)), 70, 9)

    // Load all models in parallel; stage them as they arrive.
    void (async () => {
      const [b0, b1, b2, egg, ele, grown] = await Promise.all([
        loadGLB(scene, '/gltf/', 'bird.glb', 0.9, isCancelled),
        loadGLB(scene, '/gltf/', 'bird.glb', 0.9, isCancelled),
        loadGLB(scene, '/gltf/', 'bird.glb', 0.9, isCancelled),
        loadGLB(scene, '/gltf/objects/', 'egg.glb', 0.7, isCancelled),
        loadGLB(scene, '/gltf/animals/', 'elephant.glb', ELE_H, isCancelled),
        loadGLB(scene, '/gltf/', 'bird.glb', 1.1, isCancelled),
      ])
      if (cancelled) {
        ;[b0, b1, b2, egg, ele, grown].forEach((m) => m?.dispose())
        return
      }
      flockRef.current = [b0, b1, b2].filter((m): m is LoadedModel => m != null)
      flockRef.current.forEach((m) => {
        m.playAnim(/wing-flap/i, true)
        m.carrier.rotation.y = Math.PI // tails toward the camera as they leave
        m.setEnabled(false)
      })

      eggRef.current = egg
      if (egg) {
        const p = eggPos(0)
        egg.carrier.position.set(p.x, p.y, p.z)
      }

      eleRef.current = ele
      if (ele) {
        ele.carrier.position.set(ELE.x, ELE.y + ele.restOffset, ELE.z)
        ele.carrier.rotation.y = -Math.PI / 2 // face -X, toward the incoming egg
        ele.playAnim(/idle|walk/i, true)
        ele.setEnabled(false)
      }

      grownRef.current = grown
      grown?.setEnabled(false)
    })()

    musicRef.current = audio.loop(INTRO_MUSIC_URL, { volume: 0 })
    lastTimeRef.current = performance.now()
    introStore.setCaption(first.caption)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault()
        finish()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
      musicRef.current?.setVolume(0)
      musicRef.current = null
      introStore.reset()
      flockRef.current.forEach((m) => m.dispose())
      flockRef.current = []
      eggRef.current?.dispose()
      eleRef.current?.dispose()
      grownRef.current?.dispose()
      rainRef.current?.dispose()
      currentRef.current?.dispose()
      if (scene.activeCamera === cam) scene.activeCamera = null
      cam.dispose()
      camRef.current = null
    }
  }, [scene])

  useBeforeRender(() => {
    const cam = camRef.current
    if (!cam || !scene || finishedRef.current) return

    const now = performance.now()
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05)
    lastTimeRef.current = now
    const t = (clockRef.current += dt)

    if (musicVolRef.current < INTRO_MUSIC_VOLUME) {
      musicVolRef.current = Math.min(INTRO_MUSIC_VOLUME, musicVolRef.current + MUSIC_FADE_IN * dt)
      musicRef.current?.setVolume(musicVolRef.current)
    }

    // --- find the active beat → camera + caption ---
    let bi = BEATS.length - 1
    for (let i = 0; i < BEATS.length; i++) {
      if (t < BEATS[i].end) {
        bi = i
        break
      }
    }
    const beat = BEATS[bi]
    if (bi !== beatRef.current) {
      beatRef.current = bi
      introStore.setCaption(beat.caption)
    }
    cam.fov = beat.fov
    const pos = resolve(beat.pos, t).clone()
    const minY = getDuneHeight(pos.x, pos.z) + GROUND_MARGIN
    if (pos.y < minY) pos.y = minY
    cam.position.copyFrom(pos)
    cam.setTarget(resolve(beat.target, t))

    // --- weather ---
    const w = wetness(t)
    rainRef.current?.setIntensity(w)
    if (rainRef.current) rainRef.current.emitter.copyFrom(cam.getTarget())
    fog.setBaseDensity(lerp(0.0042, 0.011, w))
    fog.setColor(new Color3(lerp(0.9, 0.62, w), lerp(0.74, 0.66, w), lerp(0.5, 0.7, w)))
    if (gameStore.sun) gameStore.sun.intensity = lerp(sunBaseRef.current, 0.55, w)
    currentRef.current?.setEnabled(w > 0.05 && t > 24 && t < 44)

    // --- props visibility / motion ---
    const flock = flockRef.current
    if (flock.length) {
      const show = t > 6.5 && t < 16
      const fp = flockPos(t)
      flock.forEach((m, i) => {
        m.setEnabled(show)
        const off = (i - 1) * 3
        m.carrier.position.set(fp.x + off, fp.y + Math.sin(t * 2 + i) * 0.6, fp.z + off * 1.5)
      })
    }

    const egg = eggRef.current
    if (egg) {
      const hatched = t > 43
      egg.setEnabled(t > 14 && !hatched)
      const p = eggPos(t)
      egg.carrier.position.set(p.x, p.y, p.z)
      egg.carrier.rotation.z = t > DRIFT_START && t < DRIFT_END ? Math.sin(t * 4) * 0.3 : 0
    }

    eleRef.current?.setEnabled(t > 33)

    const grown = grownRef.current
    if (grown) {
      const show = t > 43
      grown.setEnabled(show)
      if (show) {
        const p = t < LAND_START ? eggPos(DRIFT_END) : grownBirdPos(t)
        grown.carrier.position.set(p.x, p.y + grown.restOffset, p.z)
        const flying = t >= LAND_START && t < LAND_END
        if (flying) grown.playAnim(/wing-flap/i, true)
        else grown.playAnim(/walking-idle|idle/i, true)
        // Face toward the head while flying in.
        grown.carrier.rotation.y = -Math.PI / 2
      }
    }

    if (t >= TOTAL) finish()
  })

  return null
}
