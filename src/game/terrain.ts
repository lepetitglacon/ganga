export const TERRAIN_SIZE = 200
export const TERRAIN_SUBDIVISIONS = 64

function heightAt(x: number, z: number): number {
  return (
    Math.sin(x * 0.05) * Math.cos(z * 0.04) * 10 +
    Math.sin(x * 0.13 + 0.7) * Math.cos(z * 0.11) * 5 +
    Math.sin(x * 0.3) * Math.cos(z * 0.25 + 1.2) * 2 +
    Math.sin(x * 0.7 + 2.1) * Math.cos(z * 0.6) * 1
  )
}

export function getTerrainHeight(worldX: number, worldZ: number): number {
  return heightAt(worldX, worldZ)
}

export function generateHeightData(): Float32Array {
  const N = TERRAIN_SUBDIVISIONS
  const S = TERRAIN_SIZE
  const heights = new Float32Array((N + 1) * (N + 1))
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = (i / N - 0.5) * S
      const z = (j / N - 0.5) * S
      heights[i * (N + 1) + j] = heightAt(x, z)
    }
  }
  return heights
}
