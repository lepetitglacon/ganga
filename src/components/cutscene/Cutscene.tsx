import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useBeforeRender, useScene } from 'react-babylonjs'
import type { UniversalCamera } from '@babylonjs/core'
import { gameStore } from '@/game/gameStore.ts'
import { director } from '@/game/director.ts'
import { createCutsceneCamera, releaseCutsceneCamera } from './cameraRig.ts'
import { CutsceneCtx, type CutscenePhase, type StepApi } from './context.ts'
import { Step, type StepProps } from './Step.tsx'

export type CutsceneRepeat = 'always' | 'once' | 'once-per-save'

export type CutsceneProps = {
  id: string
  // 'always' — replayable every time the trigger fires (e.g. talking to an NPC
  // again). 'once' — once per mount of the scene (resets on scene switch, like
  // the old per-load latches). 'once-per-save' — persisted in the save file.
  repeat?: CutsceneRepeat
  // Échap fast-forwards every remaining action to its end state.
  skippable?: boolean
  // Cinema bars + the HUD hides everything else.
  letterbox?: boolean
  fov?: number
  // Fires when the cutscene ends (skipped or not) — quest completion,
  // achievement unlocks…
  onComplete?: () => void
  children?: ReactNode
}

// A scripted scene, declared as JSX and mounted in the world like any other
// component. Direct children: trigger components (when to start) and <Step>s
// (what happens, in order). While idle it polls its triggers each frame; once
// fired it takes over the camera, freezes player input (via director.activeId)
// and ticks one step at a time until done.
export const Cutscene = ({
  id,
  repeat = 'always',
  skippable = true,
  letterbox = false,
  fov = 0.9,
  onComplete,
  children,
}: CutsceneProps) => {
  const scene = useScene()
  // React state drives rendering (which step's <Spawn>s are visible…); the refs
  // mirror it for the render-loop, which must not read stale closures.
  const [phase, setPhase] = useState<CutscenePhase>('idle')
  const [stepIndex, setStepIndex] = useState(-1)
  const phaseRef = useRef<CutscenePhase>('idle')
  const stepIndexRef = useRef(-1)

  const camRef = useRef<UniversalCamera | null>(null)
  const stepsRef = useRef(new Map<number, StepApi>())
  const triggersRef = useRef(new Set<() => boolean>())
  const stepCountRef = useRef(0)
  const playedOnceRef = useRef(false)
  const lastTimeRef = useRef(performance.now())
  const propsRef = useRef({ id, repeat, skippable, letterbox, fov, onComplete })
  propsRef.current = { id, repeat, skippable, letterbox, fov, onComplete }

  const registerStep = useCallback((index: number, api: StepApi) => {
    stepsRef.current.set(index, api)
    return () => {
      if (stepsRef.current.get(index) === api) stepsRef.current.delete(index)
    }
  }, [])

  const registerTrigger = useCallback((poll: () => boolean) => {
    triggersRef.current.add(poll)
    return () => {
      triggersRef.current.delete(poll)
    }
  }, [])

  const getCamera = useCallback(() => camRef.current, [])

  const setPlaying = (phase: CutscenePhase, index: number) => {
    phaseRef.current = phase
    stepIndexRef.current = index
    setPhase(phase)
    setStepIndex(index)
  }

  const begin = () => {
    const p = propsRef.current
    if (!scene || phaseRef.current !== 'idle') return
    director.begin(p.id, { skippable: p.skippable, letterbox: p.letterbox })
    camRef.current = createCutsceneCamera(scene, p.fov)
    for (const api of stepsRef.current.values()) api.reset()
    setPlaying('playing', 0)
  }

  const end = () => {
    const p = propsRef.current
    if (phaseRef.current !== 'playing') return
    if (scene && camRef.current) releaseCutsceneCamera(scene, camRef.current)
    camRef.current = null
    director.end()
    playedOnceRef.current = true
    if (p.repeat === 'once-per-save') director.markPlayed(p.id)
    setPlaying('idle', -1)
    p.onComplete?.()
  }

  // Ready to fire? Only in gameplay, with no other cinematic running, and not
  // already spent for the chosen repeat mode.
  const armed = () => {
    const p = propsRef.current
    if (gameStore.phase !== 'playing' || director.activeId) return false
    if (p.repeat === 'once' && playedOnceRef.current) return false
    if (p.repeat === 'once-per-save' && director.hasPlayed(p.id)) return false
    return true
  }

  // Tear down cleanly if unmounted (scene switch) mid-play.
  useEffect(() => {
    return () => {
      if (phaseRef.current !== 'playing') return
      if (scene && camRef.current) releaseCutsceneCamera(scene, camRef.current)
      camRef.current = null
      phaseRef.current = 'idle'
      stepIndexRef.current = -1
      director.end()
    }
  }, [scene])

  useBeforeRender(() => {
    const now = performance.now()
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05)
    lastTimeRef.current = now

    if (phaseRef.current === 'idle') {
      if (!armed()) return
      for (const poll of triggersRef.current) {
        if (poll()) {
          begin()
          break
        }
      }
      return
    }

    if (director.activeId !== propsRef.current.id) return

    // Skip: fast-forward the current and every remaining step, in order, so all
    // world mutations still land on their end state.
    if (director.skipRequested && propsRef.current.skippable) {
      for (let i = stepIndexRef.current; i < stepCountRef.current; i++) {
        stepsRef.current.get(i)?.flush()
      }
      end()
      return
    }

    const step = stepsRef.current.get(stepIndexRef.current)
    if (!step) {
      end()
      return
    }
    step.tick(dt)
    if (step.isDone()) {
      // Cut the step's ambient actions before moving on.
      step.flush()
      const next = stepIndexRef.current + 1
      if (next >= stepCountRef.current) end()
      else setPlaying('playing', next)
    }
  })

  // Number the <Step> children in JSX order; everything else (triggers, custom
  // components) renders as-is. Conditional steps ({cond && <Step>}) are fine as
  // long as the condition stays stable while the cutscene plays.
  let count = 0
  const content = Children.map(children, (child) => {
    if (isValidElement(child) && child.type === Step) {
      return cloneElement(child as ReactElement<StepProps>, { __index: count++ })
    }
    return child
  })
  stepCountRef.current = count

  const ctxValue = useMemo(
    () => ({ phase, stepIndex, getCamera, registerStep, registerTrigger }),
    [phase, stepIndex, getCamera, registerStep, registerTrigger],
  )

  return <CutsceneCtx.Provider value={ctxValue}>{content}</CutsceneCtx.Provider>
}
