import { Children, type ReactNode } from 'react'
import { Vector3 } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import { director } from '@/game/director.ts'
import { useCutsceneCtx, useStepCtx } from './context.ts'
import { useCutsceneAction, type ActionImpl } from './useCutsceneAction.ts'

// The cutscene action vocabulary. Each component is pure behavior (renders
// nothing, except <Spawn>) scoped to its enclosing <Step>.

export type Ease = 'linear' | 'smoothstep'

function applyEase(t: number, ease: Ease): number {
  return ease === 'smoothstep' ? t * t * (3 - 2 * t) : t
}

type Vec3Like = Vector3 | [number, number, number]
type Resolvable<T> = T | (() => T)

function toVec3(v: Vec3Like): Vector3 {
  return v instanceof Vector3 ? v.clone() : new Vector3(v[0], v[1], v[2])
}

function resolveNum(v: Resolvable<number>): number {
  return typeof v === 'function' ? v() : v
}

function resolveVec(v: Resolvable<Vector3>): Vector3 {
  return typeof v === 'function' ? v() : v
}

const NOOP_DONE: ActionImpl = { update: () => true }

// --- camera ---

export type PanToProps = {
  // What the camera frames; the camera sits at focus + offset.
  focus: Resolvable<Vector3>
  offset?: Vec3Like
  // Exponential glide rate (1/s) — ambient mode: the camera chases the framing
  // for as long as the step lasts (the village-intro feel).
  lerp?: number
  // Eased move that completes (and blocks the step) instead of gliding forever.
  duration?: number
  ease?: Ease
  delay?: number
}

export const PanTo = ({
  focus,
  offset = [0, 0, 0],
  lerp = 1.4,
  duration,
  ease = 'smoothstep',
  delay,
}: PanToProps) => {
  const ctx = useCutsceneCtx()
  useCutsceneAction({
    blocking: duration != null,
    delay,
    make: () => {
      const cam = ctx.getCamera()
      if (!cam) return NOOP_DONE
      const pos = cam.position.clone()
      const target = cam.getTarget().clone()
      const startPos = pos.clone()
      const startTarget = target.clone()
      let elapsed = 0
      const apply = () => {
        cam.position.copyFrom(pos)
        cam.setTarget(target.clone())
      }
      return {
        update: (dt) => {
          const f = resolveVec(focus)
          const desired = f.add(toVec3(offset))
          if (duration == null) {
            const k = 1 - Math.exp(-lerp * dt)
            Vector3.LerpToRef(pos, desired, k, pos)
            Vector3.LerpToRef(target, f, k, target)
            apply()
            return false
          }
          elapsed += dt
          const t = applyEase(Math.min(elapsed / duration, 1), ease)
          Vector3.LerpToRef(startPos, desired, t, pos)
          Vector3.LerpToRef(startTarget, f, t, target)
          apply()
          return elapsed >= duration
        },
        finish:
          duration == null
            ? undefined
            : () => {
                const f = resolveVec(focus)
                pos.copyFrom(f.add(toVec3(offset)))
                target.copyFrom(f)
                apply()
              },
      }
    },
  })
  return null
}

export type OrbitProps = {
  center: Resolvable<Vector3>
  radius: Resolvable<number>
  height: Resolvable<number>
  // rad/s
  speed?: number
  // With a duration the orbit blocks its step; without, it circles until the
  // step ends.
  duration?: number
  delay?: number
}

export const Orbit = ({ center, radius, height, speed = 0.4, duration, delay }: OrbitProps) => {
  const ctx = useCutsceneCtx()
  useCutsceneAction({
    blocking: duration != null,
    delay,
    make: () => {
      const cam = ctx.getCamera()
      if (!cam) return NOOP_DONE
      const c = resolveVec(center).clone()
      const r = resolveNum(radius)
      const h = resolveNum(height)
      // Begin the lap roughly where the player was already looking.
      let angle = gameStore.arcCam?.alpha ?? 0
      let elapsed = 0
      return {
        update: (dt) => {
          elapsed += dt
          angle += speed * dt
          cam.position.set(c.x + Math.cos(angle) * r, c.y + h, c.z + Math.sin(angle) * r)
          cam.setTarget(c)
          return duration != null && elapsed >= duration
        },
      }
    },
  })
  return null
}

// --- timing & world mutations ---

export type TweenProps = {
  duration: number
  ease?: Ease
  // Capture start-time state here (world positions…), not in component render.
  onStart?: () => void
  // Receives the eased 0..1 progress; on skip it's called once with 1 so the
  // end state always lands.
  onUpdate: (t: number) => void
  blocking?: boolean
  delay?: number
}

export const Tween = ({
  duration,
  ease = 'linear',
  onStart,
  onUpdate,
  blocking = true,
  delay,
}: TweenProps) => {
  useCutsceneAction({
    blocking,
    delay,
    make: () => {
      onStart?.()
      let elapsed = 0
      return {
        update: (dt) => {
          elapsed += dt
          onUpdate(applyEase(Math.min(elapsed / duration, 1), ease))
          return elapsed >= duration
        },
        finish: () => onUpdate(1),
      }
    },
  })
  return null
}

export const Wait = ({ seconds, delay }: { seconds: number; delay?: number }) => {
  useCutsceneAction({
    blocking: true,
    delay,
    make: () => {
      let elapsed = 0
      return { update: (dt) => (elapsed += dt) >= seconds }
    },
  })
  return null
}

// Escape hatch for fully custom behavior (particles, physics nudges…). `run`
// is called when the action starts and returns the same contract every
// built-in uses.
export const Action = ({
  run,
  blocking = false,
  delay,
}: {
  run: () => ActionImpl
  blocking?: boolean
  delay?: number
}) => {
  useCutsceneAction({ blocking, delay, make: run })
  return null
}

// --- dialogue ---

export type SayProps = {
  speaker?: string
  children?: ReactNode
  delay?: number
}

// Pushes a line into the director (the HUD renders it) and blocks until the
// player advances (F / Espace / Entrée / clic). The line stays up until the
// next <Say> replaces it or the cutscene ends.
export const Say = ({ speaker, children, delay }: SayProps) => {
  const text = Children.toArray(children)
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .join('')
  useCutsceneAction({
    blocking: true,
    delay,
    make: () => {
      director.line = { speaker: speaker ?? null, text }
      let done = false
      const unsub = director.onAdvance(() => {
        done = true
      })
      return {
        update: () => done,
        stop: () => unsub(),
      }
    },
  })
  return null
}

// --- spawning ---

// Mounts its children (react-babylonjs nodes — models, meshes, lights…) while
// its step is active; `keep` leaves them up for the rest of the cutscene.
// Unmounting is the despawn — no bookkeeping needed.
export const Spawn = ({ keep = false, children }: { keep?: boolean; children?: ReactNode }) => {
  const cut = useCutsceneCtx()
  const step = useStepCtx()
  const visible =
    step.status === 'active' || (keep && step.status === 'done' && cut.phase === 'playing')
  return visible ? <>{children}</> : null
}
