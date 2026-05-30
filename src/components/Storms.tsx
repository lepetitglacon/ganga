import { useEffect, useState } from 'react'
import { Storm } from './Storm.tsx'
import { makeRandomStormSpawn, type StormSpawn } from '@/game/storm.ts'
import { TERRAIN_SIZE } from '@/game/terrain.ts'

// How far from the world centre storms are allowed to roam. Slightly inside the
// terrain half-size so cones never clip the very edge of the map.
const WORLD_HALF = TERRAIN_SIZE / 2 - 100

interface ActiveStorm extends StormSpawn {
  id: number
}

export interface StormsProps {
  // How many storms are alive at the same time. Each is independently random
  // and respawns (as a brand-new random storm) when its lifetime ends.
  maxConcurrent?: number
}

// Orchestrates a steady population of random storms: spawns `maxConcurrent`
// storms, and whenever one reaches the end of its random 10s..60s lifetime it
// despawns and a fresh random storm takes its place.
export const Storms = ({ maxConcurrent = 3 }: StormsProps) => {
  const [storms, setStorms] = useState<ActiveStorm[]>([])

  useEffect(() => {
    let nextId = 0
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let disposed = false

    const spawnOne = () => {
      if (disposed) return
      const id = nextId++
      const spawn = makeRandomStormSpawn(WORLD_HALF)
      setStorms((prev) => [...prev, { id, ...spawn }])

      const timer = setTimeout(() => {
        timers.delete(timer)
        setStorms((prev) => prev.filter((s) => s.id !== id))
        // Respawn so the population stays at maxConcurrent.
        spawnOne()
      }, spawn.lifetimeMs)
      timers.add(timer)
    }

    for (let i = 0; i < maxConcurrent; i++) spawnOne()

    return () => {
      disposed = true
      timers.forEach(clearTimeout)
      timers.clear()
      setStorms([])
    }
  }, [maxConcurrent])

  return (
    <>
      {storms.map((s) => (
        <Storm
          key={s.id}
          configOverrides={s.config}
          velocity={s.velocity}
          bounds={s.bounds}
          lifetimeMs={s.lifetimeMs}
          buildupMs={s.buildupMs}
          dissolveMs={s.dissolveMs}
        />
      ))}
    </>
  )
}
