// Main-thread client for the map generation worker. Owns the worker lifecycle,
// memoizes each job so the result is computed once and shared across every
// consumer (e.g. the rock geometry feeds both the rendered mesh and the physics
// collider), and mirrors the place-flattening onto the main-thread terrain
// module so runtime height queries match the worker-built world.

import { createWorkerClient, type WorkerClient } from './rpc.ts'
import { setFlattenPlaces, type FlattenPlace, type TerrainData } from '@/game/terrainGen.ts'

export type RockData = {
  positions: Float32Array
  indices: Uint32Array
  colors: Float32Array
  normals: Float32Array
}

let client: WorkerClient | null = null
let places: FlattenPlace[] = []
let terrainP: Promise<TerrainData> | null = null
let rocksP: Promise<RockData> | null = null

function getClient(): WorkerClient {
  if (!client) {
    client = createWorkerClient(
      new Worker(new URL('./mapgen.worker.ts', import.meta.url), { type: 'module' }),
    )
  }
  return client
}

// Install the resolved place footprints (from Map.tsx, once the GLBs are loaded)
// both on the main thread — so getTerrainHeight/getTerrainNormal are correct for
// gameplay — and as the payload forwarded to the worker jobs. Call before
// loadTerrain()/loadRocks().
export function prepareMapGen(p: FlattenPlace[]): void {
  places = p
  setFlattenPlaces(p)
}

export function loadTerrain(): Promise<TerrainData> {
  return (terrainP ??= getClient().run<TerrainData>('terrain', { places }))
}

export function loadRocks(): Promise<RockData> {
  return (rocksP ??= getClient().run<RockData>('rocks', { places }))
}

// Tear down the worker and clear the memoized results — call when the map
// unmounts so a fresh load (e.g. on remount) recomputes cleanly.
export function disposeMapGen(): void {
  client?.dispose()
  client = null
  places = []
  terrainP = null
  rocksP = null
}
