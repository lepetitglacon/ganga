// Player achievements ("hauts faits"). A flat registry of trackable feats, each
// either a running counter (int/float) or a one-shot flag (bool). The live
// values are a mutable singleton mirroring the quests.ts / debug.ts pattern; the
// save system (save.ts) persists them alongside the quest tree.
//
// Each achievement carries a `discovered` flag. A `secret` achievement stays
// hidden in the journal (shown as "?") until the player first makes progress on
// it — used for feats the player isn't told about up front (e.g. stumbling onto
// the wandering caravan). Non-secret achievements are always listed, even at
// zero, so the player can see what there is to chase.

export type AchievementKind = 'int' | 'float' | 'bool'

export type Achievement = {
  id: string
  title: string
  description: string
  kind: AchievementKind
  // Hidden in the UI until discovered (first progress / unlock). Non-secret
  // achievements are listed from the start.
  secret?: boolean
  // Optional target. For counters: the value that reads as "accompli" and fills
  // the progress bar. A bool's target is implicitly 1.
  goal?: number
  // Display suffix for a counter (e.g. "km"). Ignored for bool.
  unit?: string
  // Decimals shown for a float counter. Ignored for int/bool.
  decimals?: number
}

// Add new feats here — the journal renders whatever is in this list, and the
// save schema keys off the ids, so nothing else needs touching.
export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'distance',
    title: 'Grand voyageur',
    description: 'Distance parcourue à travers les dunes.',
    kind: 'float',
    unit: 'km',
    decimals: 2,
    goal: 50,
  },
  {
    id: 'water-carried',
    title: 'Porteur d’eau',
    description: 'Eau transportée jusqu’aux réservoirs du village.',
    kind: 'float',
    unit: 'réserves',
    decimals: 2,
    goal: 1,
  },
  {
    id: 'flaps',
    title: 'Ailes infatigables',
    description: 'Battements d’ailes donnés en plein vol.',
    kind: 'int',
    goal: 500,
  },
  {
    id: 'meet-caravan',
    title: 'Les dromadaires vagabonds',
    description: 'Croiser la caravane de marchands perdue dans le désert.',
    kind: 'bool',
    secret: true,
  },
]

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]))

type Cell = { value: number; discovered: boolean }

// id → live state. Mutable singleton, seeded below at module load.
const cells: Record<string, Cell> = {}
function seed(): void {
  for (const a of ACHIEVEMENTS) cells[a.id] = { value: 0, discovered: false }
}
seed()

const listeners = new Set<() => void>()

// Counters tick every frame (distance, flaps…), so coalesce the fan-out: queue
// a single flush per microtask instead of notifying on every increment. The UI
// re-renders at most once per frame; the autosave debounce absorbs the rest.
let notifyQueued = false
function notify(): void {
  if (notifyQueued) return
  notifyQueued = true
  queueMicrotask(() => {
    notifyQueued = false
    listeners.forEach((cb) => cb())
  })
}

export function getAchievement(id: string): Achievement | undefined {
  return BY_ID.get(id)
}

export function getValue(id: string): number {
  return cells[id]?.value ?? 0
}

export function isDiscovered(id: string): boolean {
  return cells[id]?.discovered ?? false
}

// Adds to a counter. The first progress discovers the achievement (reveals it if
// secret). No-op for an unknown id or a zero delta.
export function addProgress(id: string, delta: number): void {
  const cell = cells[id]
  if (!cell || delta === 0) return
  cell.value += delta
  cell.discovered = true
  notify()
}

// Flips a one-shot (bool) achievement on. Idempotent: a no-op once already set,
// so it's safe to call every frame from a proximity test.
export function unlock(id: string): void {
  const cell = cells[id]
  if (!cell || cell.value >= 1) return
  cell.value = 1
  cell.discovered = true
  notify()
}

// --- display helpers (used by the journal UI) ---

// Human-readable value: bool → accompli / —, counters → number (+ unit).
export function formatAchievement(a: Achievement): string {
  const v = getValue(a.id)
  if (a.kind === 'bool') return v >= 1 ? 'Accompli' : '—'
  const n = a.kind === 'int' ? Math.floor(v).toString() : v.toFixed(a.decimals ?? 0)
  return a.unit ? `${n} ${a.unit}` : n
}

// 0..1 progress toward the goal; bool uses its on/off state.
export function achievementProgress(a: Achievement): number {
  const v = getValue(a.id)
  if (a.kind === 'bool') return v >= 1 ? 1 : 0
  if (!a.goal) return 0
  return Math.min(1, v / a.goal)
}

export function isComplete(a: Achievement): boolean {
  const v = getValue(a.id)
  if (a.kind === 'bool') return v >= 1
  return a.goal != null && v >= a.goal
}

// --- persistence hooks (used by save.ts) ---

export type AchievementSave = Record<string, { v: number; d: boolean }>

export function serializeAchievements(): AchievementSave {
  const out: AchievementSave = {}
  for (const a of ACHIEVEMENTS) {
    const c = cells[a.id]
    out[a.id] = { v: c.value, d: c.discovered }
  }
  return out
}

// Applies a saved blob (tolerating missing/extra ids as the registry evolves).
export function loadAchievements(saved: AchievementSave | undefined): void {
  for (const a of ACHIEVEMENTS) {
    const s = saved?.[a.id]
    cells[a.id] = {
      value: typeof s?.v === 'number' ? s.v : 0,
      discovered: !!s?.d,
    }
  }
  notify()
}

export function resetAchievements(): void {
  seed()
  notify()
}

export function subscribeAchievements(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
