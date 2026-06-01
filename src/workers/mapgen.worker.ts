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
  generateTerrainData,
  computeNormals,
  setFlattenPlaces,
  type FlattenPlace,
} from '@/game/terrainGen.ts'
import { generateRockMesh } from '@/game/rocks.ts'

type JobPayload = { places: FlattenPlace[] }

type JobResult = { result: unknown; transfer: Transferable[] }

const jobs: Record<string, (payload: JobPayload) => JobResult> = {
  terrain({ places }) {
    setFlattenPlaces(places)
    const t = generateTerrainData()
    return {
      result: t,
      transfer: [
        t.heights.buffer,
        t.positions.buffer,
        t.indices.buffer,
        t.normals.buffer,
        t.uvs.buffer,
        t.colors.buffer,
      ],
    }
  },

  rocks({ places }) {
    setFlattenPlaces(places)
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
