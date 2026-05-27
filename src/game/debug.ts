// Per-category debug toggles. Ctrl+D toggles all categories on/off as a
// master switch; the DebugPanel UI lets users flip individual categories.

export type DebugCategory = 'physics' | 'sound' | 'ground' | 'mesh'
export const DEBUG_CATEGORIES: DebugCategory[] = ['physics', 'sound', 'ground', 'mesh']

type Listener = (enabled: boolean) => void

const listeners: Record<DebugCategory, Set<Listener>> = {
  physics: new Set(),
  sound: new Set(),
  ground: new Set(),
  mesh: new Set(),
}
const enabled: Record<DebugCategory, boolean> = {
  physics: false,
  sound: false,
  ground: false,
  mesh: false,
}
const panelListeners = new Set<() => void>()
let installed = false

function install() {
  if (installed) return
  installed = true
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.code !== 'KeyD') return
    e.preventDefault()
    // Master toggle: if anything is on, turn all off; otherwise turn all on.
    const anyOn = DEBUG_CATEGORIES.some((c) => enabled[c])
    const next = !anyOn
    for (const c of DEBUG_CATEGORIES) setDebug(c, next)
  })
}

export function setDebug(cat: DebugCategory, on: boolean): void {
  if (enabled[cat] === on) return
  enabled[cat] = on
  listeners[cat].forEach((cb) => cb(on))
  panelListeners.forEach((cb) => cb())
}

export function isDebugEnabled(cat: DebugCategory): boolean {
  return enabled[cat]
}

export function subscribeDebug(cat: DebugCategory, cb: Listener): () => void {
  install()
  listeners[cat].add(cb)
  cb(enabled[cat])
  return () => {
    listeners[cat].delete(cb)
  }
}

// For the panel UI: notifies on any category change so the checkboxes
// can re-render when the master Ctrl+D toggle flips them.
export function subscribeDebugPanel(cb: () => void): () => void {
  install()
  panelListeners.add(cb)
  return () => {
    panelListeners.delete(cb)
  }
}
