import { createContext, useContext } from 'react'
import type { UniversalCamera } from '@babylonjs/core'

// React plumbing shared by the cutscene building blocks. A <Cutscene> provides
// CutsceneCtx to its triggers and steps; each <Step> provides StepCtx to its
// actions. All steps stay mounted for the whole life of the cutscene (so a
// skip can fast-forward actions of steps that never became active) — only the
// *behavior* is gated on the step status.

// Runtime handle an action registers with its step (built by useCutsceneAction).
export type ActionHandle = {
  // Blocking actions hold their step open until finished; ambient ones (an
  // endless camera glide, spawned props, geysers…) just run until the step ends.
  blocking: boolean
  // Seconds into the step before the action starts.
  delay: number
  // Re-arm for a fresh playthrough (repeat="always" replays).
  reset: () => void
  ensureStarted: () => void
  tick: (dt: number) => void
  isFinished: () => boolean
  // Fast-forward: start if needed, apply the end state, mark finished. Called
  // on skip and when the step ends with the action still running.
  finish: () => void
}

// Runtime handle a step registers with its cutscene.
export type StepApi = {
  reset: () => void
  tick: (dt: number) => void
  isDone: () => boolean
  flush: () => void
}

export type CutscenePhase = 'idle' | 'playing'

export type CutsceneCtxValue = {
  phase: CutscenePhase
  // Index of the active step while playing, -1 otherwise.
  stepIndex: number
  getCamera: () => UniversalCamera | null
  registerStep: (index: number, api: StepApi) => () => void
  // Trigger polls run once per frame while the cutscene is idle and armed;
  // returning true starts the cutscene.
  registerTrigger: (poll: () => boolean) => () => void
}

export type StepStatus = 'pending' | 'active' | 'done'

export type StepCtxValue = {
  status: StepStatus
  register: (handle: ActionHandle) => () => void
}

export const CutsceneCtx = createContext<CutsceneCtxValue | null>(null)
export const StepCtx = createContext<StepCtxValue | null>(null)

export function useCutsceneCtx(): CutsceneCtxValue {
  const ctx = useContext(CutsceneCtx)
  if (!ctx) throw new Error('cutscene building blocks must be used inside <Cutscene>')
  return ctx
}

export function useStepCtx(): StepCtxValue {
  const ctx = useContext(StepCtx)
  if (!ctx) throw new Error('cutscene actions must be used inside <Step>')
  return ctx
}
