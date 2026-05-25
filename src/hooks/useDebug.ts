import { useEffect } from 'react'
import { subscribeDebug } from '@/game/debug.ts'

// React-friendly wrapper around subscribeDebug. The callback fires once on
// mount (with the current state) and every time Ctrl+D toggles.
export function useDebug(cb: (enabled: boolean) => void): void {
  useEffect(() => subscribeDebug(cb), [cb])
}
