import {
  CreateAudioEngineAsync,
  CreateSoundAsync,
  type AudioEngineV2,
  type StaticSound,
} from '@babylonjs/core/AudioV2'
import type { Scene, Vector3, Camera } from '@babylonjs/core'

// Singleton audio manager built on Babylon's AudioEngineV2. The engine starts
// locked by browsers until a user gesture; we hook a one-time listener that
// calls unlockAsync. The spatial listener is attached to the active camera so
// 3D sounds pan/attenuate correctly as the player flies around.

// Linearly ramps a sound's volume from its current value to `to` over
// `durMs`. Used everywhere we need to mask the click that happens when a
// looping audio buffer starts at full amplitude (some source files have a
// non-zero sample at index 0 — the speaker cone jerks → audible pop).
function rampVolume(sound: StaticSound, to: number, durMs: number): void {
  const from = sound.volume
  if (durMs <= 0) {
    sound.volume = to
    return
  }
  const start = performance.now()
  const tick = () => {
    const t = Math.min(1, (performance.now() - start) / durMs)
    sound.volume = from + (to - from) * t
    if (t < 1) requestAnimationFrame(tick)
  }
  tick()
}

class AudioManager {
  private engineP: Promise<AudioEngineV2> | null = null
  private attachedCamera: Camera | null = null
  private oneShotCache = new Map<string, Promise<StaticSound>>()
  private soundPoolCache = new Map<string, { sounds: StaticSound[]; index: number }>()

  private ensureEngine(): Promise<AudioEngineV2> {
    if (this.engineP) return this.engineP
    this.engineP = CreateAudioEngineAsync().then((eng) => {
      if (typeof window !== 'undefined') {
        const unlock = () => {
          eng.unlockAsync().catch(() => {})
          window.removeEventListener('pointerdown', unlock)
          window.removeEventListener('keydown', unlock)
        }
        window.addEventListener('pointerdown', unlock)
        window.addEventListener('keydown', unlock)
      }
      return eng
    })
    return this.engineP
  }

  // Bind the spatial listener to the scene's active camera. Safe to call
  // repeatedly; only re-attaches if the camera changed.
  attachListener(scene: Scene) {
    void this.ensureEngine().then((eng) => {
      const cam = scene.activeCamera
      if (!cam || cam === this.attachedCamera) return
      eng.listener.attach(cam)
      this.attachedCamera = cam
    })
  }

  // Spatialized looping sound at a fixed initial position. Caller can update
  // .spatial.position each frame if the source moves. Returns a Promise — the
  // sound only exists once the engine and audio buffer are ready.
  async spatial(
    url: string,
    position: Vector3,
    opts: {
      minDistance?: number
      maxDistance?: number
      volume?: number
      rolloff?: number
      distanceModel?: 'linear' | 'inverse' | 'exponential'
      // Directional cone: orientation = axis the cone opens along.
      // innerAngle/outerAngle in radians (full angle, not half-angle).
      orientation?: Vector3
      coneInnerAngle?: number
      coneOuterAngle?: number
      coneOuterVolume?: number
      // Linear gain ramp from 0 → `volume` over fadeInMs. Mostly masks the
      // initial click on loops whose first samples aren't at zero crossing
      // (tempest.wav is a typical offender).
      fadeInMs?: number
    } = {},
  ): Promise<StaticSound> {
    const {
      minDistance = 1,
      maxDistance = 200,
      volume = 1,
      rolloff = 1,
      distanceModel = 'linear',
      orientation,
      coneInnerAngle,
      coneOuterAngle,
      coneOuterVolume,
      fadeInMs = 250,
    } = opts
    const engine = await this.ensureEngine()
    const sound = await CreateSoundAsync(
      'sfx',
      url,
      {
        loop: true,
        autoplay: true,
        volume: fadeInMs > 0 ? 0 : volume,
        spatialEnabled: true,
        spatialDistanceModel: distanceModel,
        spatialMinDistance: minDistance,
        spatialMaxDistance: maxDistance,
        spatialRolloffFactor: rolloff,
        ...(coneInnerAngle !== undefined ? { spatialConeInnerAngle: coneInnerAngle } : {}),
        ...(coneOuterAngle !== undefined ? { spatialConeOuterAngle: coneOuterAngle } : {}),
        ...(coneOuterVolume !== undefined ? { spatialConeOuterVolume: coneOuterVolume } : {}),
      },
      engine,
    )
    sound.spatial.position.copyFrom(position)
    if (orientation) sound.spatial.orientation.copyFrom(orientation)
    if (fadeInMs > 0) rampVolume(sound, volume, fadeInMs)
    return sound
  }

  // Non-spatial fire-and-forget. Loads the buffer once per URL and replays it
  // on each call. Safe to invoke before the engine unlocks — the play() call
  // will simply be a no-op until the first user gesture.
  playOneShot(url: string, opts: { volume?: number; playbackRate?: number } = {}) {
    const { volume = 1, playbackRate = 1 } = opts
    let p = this.oneShotCache.get(url)
    if (!p) {
      p = this.ensureEngine().then((engine) =>
        CreateSoundAsync('sfx', url, { volume }, engine),
      )
      this.oneShotCache.set(url, p)
    }
    void p.then((sound) => {
      sound.volume = volume
      sound.playbackRate = playbackRate
      sound.stop()
      sound.play()
    })
  }

  // Pool-based fire-and-forget for rapid-fire sounds (landing flaps, etc).
  // Creates a pool of N sounds and cycles through them to avoid timing issues.
  async initSoundPool(url: string, poolSize: number = 5): Promise<void> {
    let pool = this.soundPoolCache.get(url)
    if (pool && pool.sounds.length === poolSize) return

    pool = { sounds: [], index: 0 }
    this.soundPoolCache.set(url, pool)

    const engine = await this.ensureEngine()
    for (let i = 0; i < poolSize; i++) {
      const sound = await CreateSoundAsync(`sfx-pool-${url}-${i}`, url, { loop: false, volume: 1 }, engine)
      pool.sounds.push(sound)
    }
  }

  playOneShotPooled(
    url: string,
    poolSize: number = 5,
    opts: { volume?: number; playbackRate?: number } = {},
  ) {
    const { volume = 1, playbackRate = 1 } = opts
    const pool = this.soundPoolCache.get(url)

    if (!pool || pool.sounds.length === 0) {
      void this.initSoundPool(url, poolSize)
      return
    }

    const sound = pool.sounds[pool.index]
    sound.volume = volume
    sound.playbackRate = playbackRate
    sound.stop()
    sound.play()
    pool.index = (pool.index + 1) % pool.sounds.length
  }

  // Non-spatial looping sound. Returns a controller; setVolume() is the only
  // knob — useful for fading ambient layers in/out based on game state.
  loop(url: string, opts: { volume?: number } = {}): { setVolume: (v: number) => void } {
    const { volume = 0 } = opts
    let current = volume
    const soundP = this.ensureEngine().then(async (engine) => {
      const s = await CreateSoundAsync('sfx', url, { loop: true, volume: current }, engine)
      s.play()
      return s
    })
    return {
      setVolume(v: number) {
        current = v
        void soundP.then((s) => {
          s.volume = v
        })
      },
    }
  }

  // Schedules randomized one-shot plays of `url` with a linear fade in/out.
  // Intervals between plays are uniform in [minIntervalSec, maxIntervalSec].
  // Returns a stop function.
  startAmbientGusts(
    url: string,
    minIntervalSec: number,
    maxIntervalSec: number,
    opts: { volume?: number; fadeSec?: number } = {},
  ): () => void {
    const { volume = 0.6, fadeSec = 1.5 } = opts
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const soundP = this.ensureEngine().then((engine) =>
      CreateSoundAsync('sfx', url, { loop: false, volume: 0 }, engine),
    )

    const fade = async (sound: StaticSound, from: number, to: number, durMs: number) => {
      const start = performance.now()
      return new Promise<void>((resolve) => {
        const tick = () => {
          if (stopped) return resolve()
          const t = Math.min(1, (performance.now() - start) / durMs)
          sound.volume = from + (to - from) * t
          if (t >= 1) return resolve()
          requestAnimationFrame(tick)
        }
        tick()
      })
    }

    const playOnce = async () => {
      if (stopped) return
      const sound = await soundP
      if (stopped) return
      sound.volume = 0
      sound.stop()
      sound.play()
      const durMs = (sound.buffer?.duration ?? 6) * 1000
      const fadeMs = Math.min(fadeSec * 1000, durMs / 2)
      await fade(sound, 0, volume, fadeMs)
      const hold = Math.max(0, durMs - fadeMs * 2)
      await new Promise((r) => setTimeout(r, hold))
      if (stopped) return
      await fade(sound, sound.volume, 0, fadeMs)
      sound.stop()
    }

    const schedule = () => {
      if (stopped) return
      const wait = (minIntervalSec + Math.random() * (maxIntervalSec - minIntervalSec)) * 1000
      timer = setTimeout(async () => {
        await playOnce()
        schedule()
      }, wait)
    }
    schedule()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      void soundP.then((s) => s.stop())
    }
  }
}

export const audio = new AudioManager()
