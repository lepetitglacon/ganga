import { useEffect, useRef } from 'react'

export const useKeyboard = () => {
  const keys = useRef<Set<string>>(new Set())

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      // Space (free-cam climb / bird takeoff) and Shift (free-cam descend) are
      // movement keys here. Space's default action (page scroll / activating a
      // focused button) would otherwise swallow it, so block it.
      if (e.code === 'Space') e.preventDefault()
      keys.current.add(e.code)
    }
    const onUp = (e: KeyboardEvent) => keys.current.delete(e.code)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  return keys
}
