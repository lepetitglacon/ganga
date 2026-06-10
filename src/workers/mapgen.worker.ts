// Map generation worker. Runs the heavy, purely-numeric world build off the
// main thread: the terrain height field + mesh, and the procedural rock massifs
// (Surface Nets). Everything here is Babylon-free — it imports only the pure
// generators in game/terrainGen.ts and game/rocks.ts. The main thread turns the
// returned typed arrays into Babylon meshes / Rapier colliders.
//
// Protocol: { id, type, payload } in → { id, result } / { id, error } out, with
// the result's ArrayBuffers transferred (zero-copy). Each job's payload carries
// the resolved place-flattening list so the worker's terrain matches the main
// thread's runtime height queries exactly.

import {
  generateChunkData,
  generateHeightData,
  computeNormals,
  setFlattenPlaces,
  type FlattenPlace,
} from '@/game/terrainGen.ts'
import { generateRockMesh } from '@/game/rocks.ts'

// Places are installed ONCE per worker via the `init` job, so chunk/heights jobs
// carry no payload — avoids re-cloning the array (and re-resolving oases) on
// every chunk request.
type JobPayload = {
  places?: FlattenPlace[]
  cx?: number
  cz?: number
}

type JobResult = { result: unknown; transfer: Transferable[] }

const jobs: Record<string, (payload: JobPayload) => JobResult> = {
  // Install the place footprints for this worker. Run once before chunk/heights.
  init({ places }) {
    setFlattenPlaces(places ?? [])
    return { result: true, transfer: [] }
  },

  // One streamed terrain chunk.
  chunk({ cx, cz }) {
    const c = generateChunkData(cx ?? 0, cz ?? 0)
    return {
      result: c,
      transfer: [
        c.positions.buffer,
        c.indices.buffer,
        c.normals.buffer,
        c.uvs.buffer,
        c.colors.buffer,
      ],
    }
  },

  // Full heightfield for the single Rapier collider (built off-thread once).
  heights() {
    const h = generateHeightData()
    return { result: h, transfer: [h.buffer] }
  },

  rocks() {
    const r = generateRockMesh()
    // Normals are cheap relative to the meshing; compute them here so the main
    // thread only has to call applyToMesh.
    const normals = computeNormals(r.positions, r.indices)
    const result = {
      positions: r.positions,
      indices: r.indices,
      colors: r.colors,
      normals,
    }
    return {
      result,
      transfer: [
        r.positions.buffer,
        r.indices.buffer,
        r.colors.buffer,
        normals.buffer,
      ],
    }
  },
}

self.onmessage = (e: MessageEvent) => {
  const { id, type, payload } = e.data as {
    id: number
    type: string
    payload: JobPayload
  }
  const job = jobs[type]
  if (!job) {
    ;(self as unknown as Worker).postMessage({ id, error: `unknown job: ${type}` })
    return
  }
  try {
    const { result, transfer } = job(payload)
    ;(self as unknown as Worker).postMessage({ id, result }, transfer)
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
