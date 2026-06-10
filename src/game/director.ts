// Cutscene director. The <Cutscene> components (components/cutscene/) drive
// their own playback; this singleton owns what must be global across all of
// them: which cutscene is active (only one at a time), the window input
// listeners (F/Espace/Entrée/clic = advance, Échap = skip), the dialogue line /
// interact prompt / letterbox state the HUD renders, and the persisted set of
// played ids backing repeat="once-per-save" (serialized by save.ts).
//
// Mutable singleton mirroring gameStore: the HUD polls it per frame, gameplay
// code reads isCutsceneActive() to freeze input while a cinematic owns the
// camera.

export type DialogueLine = { speaker: string | null; text: string }

const advanceListeners = new Set<() => void>()
const playedListeners = new Set<() => void>()

// Ids of completed repeat="once-per-save" cutscenes. Persisted by save.ts.
let played = new Set<string>()

function fireAdvance(): void {
  // Copy: a listener may unsubscribe (or a new Say subscribe) during the loop.
  for (const cb of [...advanceListeners]) cb()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.code === 'Escape') {
    if (director.skippable) {
      e.preventDefault()
      director.skipRequested = true
    }
    return
  }
  if (e.code !== 'KeyF' && e.code !== 'Space' && e.code !== 'Enter') return
  e.preventDefault()
  fireAdvance()
}

function onClick(): void {
  fireAdvance()
}

export const director = {
  // Id of the playing cutscene, or null. Cutscene components check this before
  // polling their triggers, so two cutscenes can never start the same frame.
  activeId: null as string | null,
  skippable: true,
  // True while a letterboxed cutscene plays — the HUD draws the black bars.
  letterbox: false,
  // Current dialogue line (from <Say>), rendered by the HUD.
  line: null as DialogueLine | null,
  // Interact prompt (e.g. "F pour parler") set by an armed InteractTrigger.
  prompt: null as string | null,
  // Set by Échap; the active Cutscene component consumes it on its next frame
  // by fast-forwarding every remaining action to its end state.
  skipRequested: false,

  begin(id: string, opts: { skippable: boolean; letterbox: boolean }): void {
    this.activeId = id
    this.skippable = opts.skippable
    this.letterbox = opts.letterbox
    this.skipRequested = false
    this.line = null
    this.prompt = null
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('click', onClick)
  },

  end(): void {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('click', onClick)
    this.activeId = null
    this.line = null
    this.prompt = null
    this.letterbox = false
    this.skipRequested = false
  },

  // <Say> subscribes while waiting for the player to advance the dialogue.
  onAdvance(cb: () => void): () => void {
    advanceListeners.add(cb)
    return () => advanceListeners.delete(cb)
  },

  hasPlayed(id: string): boolean {
    return played.has(id)
  },

  markPlayed(id: string): void {
    if (played.has(id)) return
    played.add(id)
    playedListeners.forEach((cb) => cb())
  },
}

// One flag for all consumers (Player, CameraController…) instead of the old
// per-cutscene gameStore booleans.
export function isCutsceneActive(): boolean {
  return director.activeId != null
}

// --- persistence hooks (used by save.ts) ---

export function serializePlayedCutscenes(): string[] {
  return [...played]
}

export function loadPlayedCutscenes(ids: string[] | undefined): void {
  played = new Set(ids ?? [])
}

export function resetPlayedCutscenes(): void {
  played.clear()
}

export function subscribePlayedCutscenes(cb: () => void): () => void {
  playedListeners.add(cb)
  return () => playedListeners.delete(cb)
}
