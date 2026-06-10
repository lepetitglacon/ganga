import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  StepCtx,
  useCutsceneCtx,
  type ActionHandle,
  type StepApi,
  type StepStatus,
} from './context.ts'

export type StepProps = {
  // Minimum length in seconds. Without it the step ends as soon as every
  // blocking action has finished (a step with only ambient actions and no
  // duration ends immediately).
  duration?: number
  children?: ReactNode
  // Position in the cutscene, injected by <Cutscene> via cloneElement.
  __index?: number
}

// One beat of a cutscene. Everything inside plays in parallel; steps play in
// order. Holds its actions' handles (in mount = JSX order, which is the order
// finish() runs in on a skip) and exposes its runtime to the cutscene.
export const Step = ({ duration, children, __index = -1 }: StepProps) => {
  const ctx = useCutsceneCtx()
  const handlesRef = useRef<ActionHandle[]>([])
  const elapsedRef = useRef(0)
  const durationRef = useRef(duration)
  durationRef.current = duration

  const register = useCallback((h: ActionHandle) => {
    handlesRef.current.push(h)
    return () => {
      handlesRef.current = handlesRef.current.filter((x) => x !== h)
    }
  }, [])

  useEffect(() => {
    const api: StepApi = {
      reset: () => {
        elapsedRef.current = 0
        for (const h of handlesRef.current) h.reset()
      },
      tick: (dt) => {
        elapsedRef.current += dt
        for (const h of handlesRef.current) {
          if (elapsedRef.current >= h.delay) h.ensureStarted()
          h.tick(dt)
        }
      },
      isDone: () => {
        const d = durationRef.current
        if (d != null && elapsedRef.current < d) return false
        return handlesRef.current.every((h) => !h.blocking || h.isFinished())
      },
      flush: () => {
        for (const h of handlesRef.current) h.finish()
      },
    }
    return ctx.registerStep(__index, api)
  }, [ctx.registerStep, __index])

  const status: StepStatus =
    ctx.phase !== 'playing' || ctx.stepIndex < __index
      ? 'pending'
      : ctx.stepIndex === __index
        ? 'active'
        : 'done'

  const value = useMemo(() => ({ status, register }), [status, register])
  return <StepCtx.Provider value={value}>{children}</StepCtx.Provider>
}
