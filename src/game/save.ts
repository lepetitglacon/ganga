// localStorage save system. The quest tree (quests.ts) is the source of truth
// for progression; this module persists the quest status map under a single
// versioned JSON blob and, on load, derives the few world flags that need to
// reflect past progress (skip the already-seen source cutscene, register the
// reservoir already full).
//
// Autosave is event-driven, not timed: any quest change schedules a debounced
// write, and we flush on tab hide / unload. Nothing serializes live runtime
// objects (meshes, cameras, physics) — only logical progress.

import { gameStore } from './gameStore.ts'
import {
  getQuestStatus,
  loadQuestStatus,
  resetQuests,
  serializeQuests,
  subscribeQuests,
  type QuestStatus,
} from './quests.ts'

const KEY = 'ganga:save'
const VERSION = 1

export type SaveData = {
  v: number
  quests: Record<string, QuestStatus>
  savedAt: number
}

// Gate autosave until the initial load has run, so loadQuestStatus's notify()
// (and any boot-time quest seeding) doesn't write a save before we've read one.
let booted = false
let saveTimer: number | null = null

function readRaw(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as SaveData
    if (!data || typeof data !== 'object') return null
    return data
  } catch {
    return null
  }
}

export function hasSave(): boolean {
  return readRaw() != null
}

// Read the save (if any) and apply it. Call once, before the world initializes.
export function loadGame(): void {
  const data = readRaw()
  if (data && data.v === VERSION && data.quests) {
    loadQuestStatus(data.quests)
    // Derive world flags from progression — quests are the single truth.
    if (getQuestStatus('find-source') === 'done') {
      gameStore.sourceCutsceneDone = true
    }
    if (getQuestStatus('fill-reservoir') === 'done') {
      gameStore.reservoirsStartFilled = true
    }
  } else if (data && data.v !== VERSION) {
    // Unknown/older schema: drop it rather than risk loading garbage. Add real
    // migrations here when the schema evolves.
    localStorage.removeItem(KEY)
  }
  booted = true
}

function buildSave(): SaveData {
  return {
    v: VERSION,
    quests: serializeQuests(),
    savedAt: Date.now(),
  }
}

export function saveGame(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(buildSave()))
  } catch {
    // Storage full / disabled (private mode): progression just won't persist.
  }
}

export function getSavedAt(): number | null {
  return readRaw()?.savedAt ?? null
}

// Wipes the save and resets the live quest tree to a fresh game. Resetting the
// in-memory tree matters even right before a reload: the beforeunload flush
// would otherwise re-persist the still-completed quests over the cleared save.
export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  resetQuests()
}

function scheduleSave(): void {
  if (!booted) return
  if (saveTimer != null) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    saveGame()
  }, 500)
}

let installed = false

// Wire autosave: persist on any quest change, and flush immediately when the
// tab is hidden or closed so a pending debounce isn't lost.
export function installSave(): void {
  if (installed) return
  installed = true
  subscribeQuests(scheduleSave)
  const flush = () => {
    if (booted) saveGame()
  }
  window.addEventListener('beforeunload', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
