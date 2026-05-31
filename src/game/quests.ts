// Quest tree. Each quest declares the quests it `requires`; a quest unlocks
// (locked → active) once all its prerequisites are done, which is what gives the
// progression its tree shape. The quest status map is the single source of
// truth for what the player has accomplished — the save system (save.ts) just
// persists it and derives the world flags it needs from it on load.

export type QuestStatus = 'locked' | 'active' | 'done'

export type Quest = {
  id: string
  title: string
  description: string
  // ids of the quests that must be `done` before this one becomes `active`.
  // [] = a root quest, active from the start.
  requires: string[]
}

// Ordered parents-first (topological), so UI can render top-to-bottom and the
// initial unlock pass sees prerequisites before the quests that depend on them.
export const QUESTS: Quest[] = [
  {
    id: 'meet-village',
    title: 'Le village assoiffé',
    description: 'Pose-toi au village et parle à son habitant.',
    requires: [],
  },
  {
    id: 'find-source',
    title: 'La source oubliée',
    description: 'Retrouve la source tarie, au nord-ouest des dunes.',
    requires: ['meet-village'],
  },
  {
    id: 'fill-reservoir',
    title: 'Rendre la vie',
    description: 'Rapporte de l’eau jusqu’à remplir le réservoir du village.',
    requires: ['find-source'],
  },
]

const BY_ID = new Map(QUESTS.map((q) => [q.id, q]))

// id → status. Mutable singleton, mirrors the gameStore / debug.ts pattern.
const status: Record<string, QuestStatus> = {}
const listeners = new Set<() => void>()
// Fired only on a live completion (completeQuest), never on save load — so the
// UI can show a one-off toast without it replaying every quest on reload.
const completeListeners = new Set<(id: string) => void>()
// Fired when a quest freshly transitions locked → active during play. Like
// completeListeners, suppressed during boot/save-load so it isn't replayed for
// quests that were already unlocked.
const unlockListeners = new Set<(id: string) => void>()

function notify(): void {
  listeners.forEach((cb) => cb())
}

// Re-derives locked/active for every not-yet-done quest from its prerequisites.
// `done` is never touched here — only the save load or completeQuest set that.
// When `emit` is true, quests that go locked → active fire the unlock listeners.
function recomputeUnlocks(emit = false): void {
  for (const q of QUESTS) {
    if (status[q.id] === 'done') continue
    const ready = q.requires.every((r) => status[r] === 'done')
    const next = ready ? 'active' : 'locked'
    const becameActive = emit && status[q.id] === 'locked' && next === 'active'
    status[q.id] = next
    if (becameActive) unlockListeners.forEach((cb) => cb(q.id))
  }
}

// Fresh game: nothing done, roots active.
export function resetQuests(): void {
  for (const q of QUESTS) status[q.id] = 'locked'
  recomputeUnlocks()
  notify()
}

export function getQuestStatus(id: string): QuestStatus {
  return status[id] ?? 'locked'
}

// Depth in the tree (longest prerequisite chain) — used by the UI to indent.
export function questDepth(id: string): number {
  const q = BY_ID.get(id)
  if (!q || q.requires.length === 0) return 0
  return 1 + Math.max(...q.requires.map(questDepth))
}

export function completeQuest(id: string): void {
  if (!BY_ID.has(id) || status[id] === 'done') return
  status[id] = 'done'
  recomputeUnlocks(true)
  notify()
  completeListeners.forEach((cb) => cb(id))
}

// --- persistence hooks (used by save.ts) ---

export function serializeQuests(): Record<string, QuestStatus> {
  return { ...status }
}

// Applies a saved status map, then re-derives locked/active so the live tree
// stays consistent even if the quest definitions changed since the save.
export function loadQuestStatus(saved: Record<string, QuestStatus>): void {
  for (const q of QUESTS) {
    status[q.id] = saved[q.id] === 'done' ? 'done' : 'locked'
  }
  recomputeUnlocks()
  notify()
}

export function subscribeQuests(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

// Notified with the quest id each time a quest is freshly completed.
export function subscribeQuestComplete(cb: (id: string) => void): () => void {
  completeListeners.add(cb)
  return () => {
    completeListeners.delete(cb)
  }
}

// Notified with the quest id each time a quest is freshly unlocked (locked →
// active) during play.
export function subscribeQuestUnlock(cb: (id: string) => void): () => void {
  unlockListeners.add(cb)
  return () => {
    unlockListeners.delete(cb)
  }
}

export function getQuest(id: string): Quest | undefined {
  return BY_ID.get(id)
}

// Seed defaults at module load so the tree is usable before any save is read.
resetQuests()
