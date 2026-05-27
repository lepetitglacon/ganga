import { useEffect } from 'react'
import { subscribeDebug, type DebugCategory } from '@/game/debug.ts'

// React-friendly wrapper around subscribeDebug. The callback fires once on
// mount (with the current state) and every time the category is toggled.
export function useDebug(category: DebugCategory, cb: (enabled: boolean) => void): void {
  useEffect(() => subscribeDebug(category, cb), [category, cb])
}
