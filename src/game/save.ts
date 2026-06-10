// localStorage save system. The achievements (achievements.ts) persist across
// runs — they're a lifetime tally and are meant to carry over — along with the
// ids of repeat="once-per-save" cutscenes (director.ts). The quest tree is
// deliberately *not* saved: every run starts the story fresh (source cutscene
// replays, reservoir starts empty), so the world flags derived from quest
// progress all stay at their defaults.
//
// Autosave is event-driven, not timed: any achievement change schedules a
// throttled write, and we flush on tab hide / unload. Nothing serializes live
// runtime objects (meshes, cameras, physics) — only logical progress.

import {
  loadAchievements,
  resetAchievements,
  serializeAchievements,
  subscribeAchievements,
  type AchievementSave,
} from './achievements.ts'
import {
  loadPlayedCutscenes,
  resetPlayedCutscenes,
  serializePlayedCutscenes,
  subscribePlayedCutscenes,
} from './director.ts'
import { resetQuests } from './quests.ts'

const KEY = 'ganga:save'
const VERSION = 1

export type SaveData = {
  v: number
  achievements?: AchievementSave
  cutscenes?: string[]
  savedAt: number
}

// Gate autosave until the initial load has run, so loadAchievements's notify()
// doesn't write a save before we've read one.
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
// Quests are intentionally left at their fresh module-load state — only the
// achievements are restored.
export function loadGame(): void {
  const data = readRaw()
  if (data && data.v === VERSION) {
    loadAchievements(data.achievements)
    loadPlayedCutscenes(data.cutscenes)
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
    achievements: serializeAchievements(),
    cutscenes: serializePlayedCutscenes(),
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

// Wipes the save and resets the live state to a fresh game. Resetting the
// in-memory achievements matters even right before a reload: the beforeunload
// flush would otherwise re-persist them over the cleared save. Quests are reset
// too for good measure, though they aren't persisted.
export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  resetQuests()
  resetAchievements()
  resetPlayedCutscenes()
}

// Throttle-trailing (not debounce): the first change schedules a write 500ms
// out and later changes within that window are absorbed into it. This matters
// for achievement counters, which tick every frame — a debounce that reset on
// each change would never fire while the player keeps moving.
function scheduleSave(): void {
  if (!booted) return
  if (saveTimer != null) return
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    saveGame()
  }, 500)
}

let installed = false

// Wire autosave: persist on any achievement change, and flush immediately when
// the tab is hidden or closed so a pending write isn't lost.
export function installSave(): void {
  if (installed) return
  installed = true
  subscribeAchievements(scheduleSave)
  subscribePlayedCutscenes(scheduleSave)
  const flush = () => {
    if (booted) saveGame()
  }
  window.addEventListener('beforeunload', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
