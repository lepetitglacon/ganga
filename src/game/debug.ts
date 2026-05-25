// Global debug toggle (Ctrl+D). Single key listener installed lazily on the
// first subscribe; multiple components can react to the state change.

type Listener = (enabled: boolean) => void

const listeners = new Set<Listener>()
let enabled = false
let installed = false

function install() {
  if (installed) return
  installed = true
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.code !== 'KeyD') return
    e.preventDefault()
    enabled = !enabled
    listeners.forEach((cb) => cb(enabled))
  })
}

export function subscribeDebug(cb: Listener): () => void {
  install()
  listeners.add(cb)
  cb(enabled) // sync current state on subscribe
  return () => {
    listeners.delete(cb)
  }
}

export function isDebugEnabled(): boolean {
  return enabled
}
