// Tiny pub/sub bridge between the IntroScene's cinematic player (which runs in
// the Babylon render loop) and its DOM overlay (letterbox + narration). The
// cinematic writes the current caption here; the overlay subscribes and
// re-renders. Mirrors the sceneManager/director pattern used elsewhere.

type Listener = () => void

type IntroState = {
  // Narration line for the current shot, or null between/at the very start.
  caption: string | null
  // Bumped every time the caption changes, so the overlay can re-trigger its
  // fade-in transition even when two shots share the same text.
  captionId: number
}

let state: IntroState = { caption: null, captionId: 0 }
const listeners = new Set<Listener>()

function notify() {
  for (const fn of listeners) fn()
}

export const introStore = {
  getState(): IntroState {
    return state
  },

  setCaption(caption: string | null): void {
    if (caption === state.caption) return
    state = { caption, captionId: state.captionId + 1 }
    notify()
  },

  reset(): void {
    state = { caption: null, captionId: 0 }
    notify()
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
