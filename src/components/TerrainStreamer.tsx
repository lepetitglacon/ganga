import { useEffect, useRef } from 'react'
import { useScene, useBeforeRender } from 'react-babylonjs'
import { Mesh, VertexData, type StandardMaterial } from '@babylonjs/core'
import { createSandMaterial, CHUNK_SIZE, type ChunkData } from '@/game/terrain.ts'
import { loadChunk } from '@/workers/mapgen.ts'
import { gameStore } from '@/game/gameStore.ts'

// Streams the terrain mesh as square chunks around the bird. The heavy
// noise/meshing is done off-thread by the map worker pool (loadChunk); here we
// only diff the desired ring against what's loaded, kick off worker jobs for the
// gaps, dispose chunks that fall out of range, and — crucially — rate-limit the
// per-frame mesh CREATION so building never spikes a frame even when many chunks
// arrive at once.
//
// The ring always centers on the BIRD (physics body / mesh), never on the active
// camera — so the free-fly cam (Ctrl+C) roams the already-loaded area without
// dragging the stream with it.

// Ring radius in chunks. 3 × 200 m = 600 m, comfortably past the ~410 m fog.
const LOAD_RADIUS = 3
// Hysteresis: only unload past radius + margin, so a chunk hovering at the edge
// doesn't load/unload every pass.
const UNLOAD_MARGIN = 1
// Seconds between diff passes — no need to re-evaluate the ring every frame.
const RESTREAM_INTERVAL = 0.25
// Max chunk meshes built per frame from the ready queue (applyToMesh + GPU
// upload cost). The worker removed the generation cost; this caps the rest.
const MAX_BUILDS_PER_FRAME = 2

const key = (cx: number, cz: number) => `${cx},${cz}`

export const TerrainStreamer = () => {
  const scene = useScene()
  const matRef = useRef<StandardMaterial | null>(null)
  const loaded = useRef(new Map<string, Mesh>())
  const inFlight = useRef(new Set<string>())
  const desired = useRef(new Set<string>())
  const ready = useRef<{ key: string; data: ChunkData }[]>([])
  const sinceRestream = useRef(RESTREAM_INTERVAL) // force a pass on frame 1

  useEffect(() => {
    if (!scene) return
    matRef.current = createSandMaterial(scene)
    const loadedMap = loaded.current
    const inFlightSet = inFlight.current
    const readyArr = ready.current
    return () => {
      for (const m of loadedMap.values()) m.dispose()
      loadedMap.clear()
      inFlightSet.clear()
      readyArr.length = 0
      matRef.current?.dispose()
      matRef.current = null
    }
  }, [scene])

  useBeforeRender(() => {
    if (!scene) return
    const mat = matRef.current
    if (!mat) return

    const dt = scene.getEngine().getDeltaTime() / 1000

    // --- Periodic diff pass: decide which chunks should exist -------------
    sinceRestream.current += dt
    if (sinceRestream.current >= RESTREAM_INTERVAL) {
      sinceRestream.current = 0

      // Center on the bird (body if it exists, else mesh, else origin).
      const body = gameStore.physics?.playerBody
      const pos = body
        ? body.translation()
        : (gameStore.mesh?.position ?? { x: 0, z: 0 })
      const ccx = Math.floor(pos.x / CHUNK_SIZE)
      const ccz = Math.floor(pos.z / CHUNK_SIZE)

      // Build the desired set (circular ring) and request the missing chunks.
      desired.current.clear()
      for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
        for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
          if (dx * dx + dz * dz > LOAD_RADIUS * LOAD_RADIUS) continue
          const cx = ccx + dx
          const cz = ccz + dz
          const k = key(cx, cz)
          desired.current.add(k)
          if (loaded.current.has(k) || inFlight.current.has(k)) continue
          inFlight.current.add(k)
          loadChunk(cx, cz)
            .then((data) => {
              inFlight.current.delete(k)
              ready.current.push({ key: k, data })
            })
            .catch(() => {
              inFlight.current.delete(k)
            })
        }
      }

      // Unload chunks beyond the ring + hysteresis margin.
      const unloadR = LOAD_RADIUS + UNLOAD_MARGIN
      for (const [k, mesh] of loaded.current) {
        const [cx, cz] = k.split(',').map(Number)
        const dx = cx - ccx
        const dz = cz - ccz
        if (dx * dx + dz * dz > unloadR * unloadR) {
          mesh.dispose()
          loaded.current.delete(k)
        }
      }
    }

    // --- Build a few ready chunks into meshes (rate-limited) --------------
    let built = 0
    while (ready.current.length > 0 && built < MAX_BUILDS_PER_FRAME) {
      const { key: k, data } = ready.current.shift()!
      // Skip if it drifted out of range, or somehow already built, while queued.
      if (!desired.current.has(k) || loaded.current.has(k)) continue

      const vd = new VertexData()
      vd.positions = data.positions
      vd.indices = data.indices
      vd.normals = data.normals
      vd.uvs = data.uvs
      vd.colors = data.colors

      const mesh = new Mesh(`chunk_${k}`, scene)
      vd.applyToMesh(mesh)
      mesh.useVertexColors = true
      mesh.material = mat
      mesh.receiveShadows = true
      loaded.current.set(k, mesh)
      built++
    }
  })

  return null
}
