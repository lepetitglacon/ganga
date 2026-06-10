// Main-thread client for the map generation worker(s). Runs a small POOL so
// many terrain chunks can be generated in parallel without one heavy chunk
// blocking the next. The place footprints are installed once per worker (the
// `init` job), then chunk/heights/rocks jobs carry no places payload.
//
// Memoization: heights and rocks are computed once and shared (rocks feeds both
// the rendered mesh and the physics collider). Chunks are NOT memoized here —
// the streamer owns their lifecycle.

import { createWorkerClient, type WorkerClient } from './rpc.ts'
import {
  setFlattenPlaces,
  type FlattenPlace,
  type ChunkData,
} from '@/game/terrainGen.ts'

export type RockData = {
  positions: Float32Array
  indices: Uint32Array
  colors: Float32Array
  normals: Float32Array
}

const POOL_SIZE = 3

let pool: WorkerClient[] | null = null
let nextWorker = 0
let heightsP: Promise<Float32Array> | null = null
let rocksP: Promise<RockData> | null = null

function getPool(): WorkerClient[] {
  if (!pool) {
    pool = Array.from({ length: POOL_SIZE }, () =>
      createWorkerClient(
        new Worker(new URL('./mapgen.worker.ts', import.meta.url), {
          type: 'module',
        }),
      ),
    )
  }
  return pool
}

// Install the resolved place footprints (from Map.tsx, once the GLBs are loaded)
// on the main thread — so getTerrainHeight/getTerrainNormal are correct for
// gameplay — AND on every worker in the pool. Await this before loadChunk /
// loadHeights / loadRocks so the workers' terrain matches the main thread.
export async function prepareMapGen(p: FlattenPlace[]): Promise<void> {
  setFlattenPlaces(p)
  await Promise.all(getPool().map((w) => w.run('init', { places: p })))
}

// Generate one terrain chunk. Round-robins across the pool.
export function loadChunk(cx: number, cz: number): Promise<ChunkData> {
  const workers = getPool()
  const w = workers[nextWorker++ % workers.length]
  return w.run<ChunkData>('chunk', { cx, cz })
}

// Full heightfield for the single Rapier collider. Memoized.
export function loadHeights(): Promise<Float32Array> {
  return (heightsP ??= getPool()[0].run<Float32Array>('heights'))
}

export function loadRocks(): Promise<RockData> {
  return (rocksP ??= getPool()[0].run<RockData>('rocks'))
}

// Tear down the pool and clear memoized results — call when the map unmounts so
// a fresh load (e.g. on remount) recomputes cleanly.
export function disposeMapGen(): void {
  pool?.forEach((w) => w.dispose())
  pool = null
  nextWorker = 0
  heightsP = null
  rocksP = null
}
