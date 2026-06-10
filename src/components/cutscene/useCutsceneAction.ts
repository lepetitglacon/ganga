import { useEffect, useRef } from 'react'
import { useStepCtx, type ActionHandle } from './context.ts'

// What an action does once running. Built lazily by make() when the action
// actually starts, so it can capture start-time state (current camera pose,
// zone centers resolved from gameStore…).
export type ActionImpl = {
  // Advance one frame; return true once the end is reached. Ambient actions
  // just keep returning false — the step cuts them when it ends.
  update: (dt: number) => boolean
  // Jump straight to the end state (skip / step cut). World mutations (a rising
  // water plane…) must implement this; pure camera moves can omit it — their
  // end pose doesn't matter once the step is over.
  finish?: () => void
  // Teardown, called exactly once when the action stops for any reason
  // (natural end, fast-forward, or unmount mid-play).
  stop?: () => void
}

export type ActionOpts = {
  // Default true: the step waits for this action.
  blocking?: boolean
  delay?: number
  make: () => ActionImpl
}

// The contract behind every cutscene action component: register a handle with
// the enclosing <Step>, start when the step activates (after `delay`), tick
// every frame, and support fast-forward for the skip path. Components built on
// this render nothing — they're pure behavior.
export function useCutsceneAction(opts: ActionOpts): void {
  const step = useStepCtx()
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    let impl: ActionImpl | null = null
    let started = false
    let finished = false

    const stop = () => {
      const i = impl
      impl = null
      i?.stop?.()
    }

    const handle: ActionHandle = {
      blocking: optsRef.current.blocking ?? true,
      delay: optsRef.current.delay ?? 0,
      reset: () => {
        if (started && !finished) stop()
        started = false
        finished = false
      },
      ensureStarted: () => {
        if (started) return
        started = true
        impl = optsRef.current.make()
      },
      tick: (dt) => {
        if (!started || finished || !impl) return
        if (impl.update(dt)) {
          finished = true
          stop()
        }
      },
      isFinished: () => finished,
      finish: () => {
        if (finished) return
        handle.ensureStarted()
        finished = true
        impl?.finish?.()
        stop()
      },
    }

    const unregister = step.register(handle)
    return () => {
      if (started && !finished) stop()
      unregister()
    }
  }, [step.register])
}
