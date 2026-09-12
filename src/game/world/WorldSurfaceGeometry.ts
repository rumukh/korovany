import * as THREE from 'three'
import type { WorldSurfaceField } from './WorldSurfaceField.ts'
import { paintPropResponse } from '../art/index.ts'
import type { SiteBuildingPlacement } from './SiteComposition.ts'

interface Vertex { x: number; y: number; z: number }
interface PavingVertex extends Vertex { nx: number; ny: number; nz: number }

/** Subdivide only in the original triangle plane; this is not another height field. */
export function createWorldPavingGeometry(
  terrain: THREE.BufferGeometry,
  field: WorldSurfaceField,
): THREE.BufferGeometry | null {
  const position = terrain.getAttribute('position')
  const normal = terrain.getAttribute('normal')
  const indices = terrain.getIndex()
  if (!position || !normal || !indices) throw new Error('Paving requires indexed physical terrain triangles')
  const positions: number[] = [], colors: number[] = [], normals: number[] = []
  const color = new THREE.Color()
  const weights = new WeakMap<PavingVertex, number>()
  const shades = new Map<string, THREE.Color>()
  const weight = (v: PavingVertex): number => {
    const cached = weights.get(v)
    if (cached !== undefined) return cached
    const value = field.pavingAt(v.x, v.z) - 0.12
    weights.set(v, value)
    return value
  }
  const append = (vertices: PavingVertex[]): void => {
    for (let i = 1; i + 1 < vertices.length; i++) {
      for (const vertex of [vertices[0], vertices[i], vertices[i + 1]]) {
        positions.push(vertex.x, vertex.y, vertex.z)
        const length = Math.hypot(vertex.nx, vertex.ny, vertex.nz)
        normals.push(vertex.nx / length, vertex.ny / length, vertex.nz / length)
        const key = `${vertex.x}:${vertex.z}`
        const cached = shades.get(key)
        if (cached) color.copy(cached)
        else {
          field.writePavingColor(vertex.x, vertex.z, color)
          shades.set(key, color.clone())
        }
        colors.push(color.r, color.g, color.b)
      }
    }
  }
  const visit = (a: PavingVertex, b: PavingVertex, c: PavingVertex, level: number): void => {
    if (level === 2 && !field.mayContainPaving({
      minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x),
      minZ: Math.min(a.z, b.z, c.z), maxZ: Math.max(a.z, b.z, c.z),
    })) return
    if (level > 0) {
      const ab = between(a, b, 0.5), bc = between(b, c, 0.5), ca = between(c, a, 0.5)
      visit(a, ab, ca, level - 1); visit(ab, b, bc, level - 1)
      visit(ca, bc, c, level - 1); visit(ab, bc, ca, level - 1)
      return
    }
    const result: PavingVertex[] = []
    let previous = c, previousWeight = weight(c)
    for (const current of [a, b, c]) {
      const currentWeight = weight(current)
      if ((previousWeight >= 0) !== (currentWeight >= 0)) {
        result.push(between(previous, current, previousWeight / (previousWeight - currentWeight)))
      }
      if (currentWeight >= 0) result.push(current)
      previous = current; previousWeight = currentWeight
    }
    if (result.length >= 3) append(result)
  }
  const vertex = (i: number): PavingVertex => ({
    x: position.getX(i), y: position.getY(i), z: position.getZ(i),
    nx: normal.getX(i), ny: normal.getY(i), nz: normal.getZ(i),
  })
  for (let i = 0; i < indices.count; i += 3) {
    visit(vertex(indices.getX(i)), vertex(indices.getX(i + 1)), vertex(indices.getX(i + 2)), 2)
  }
  if (!positions.length) return null
  const geometry = new THREE.BufferGeometry()
  geometry.name = 'world-paving'
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function between(a: PavingVertex, b: PavingVertex, t: number): PavingVertex {
  return {
    x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
    nx: a.nx + (b.nx - a.nx) * t, ny: a.ny + (b.ny - a.ny) * t, nz: a.nz + (b.nz - a.nz) * t,
  }
}

/** A vertical, downward footing inside the existing plinth footprint; never a new floor. */
export function createFoundationContactGeometry(
  building: SiteBuildingPlacement,
  groundAt: (x: number, z: number) => number,
): THREE.BufferGeometry | null {
  const spec = building.spec
  const baseY = groundAt(building.x, building.z)
  const plinth = Math.max(0.16, spec.wallHeight * 0.11)
  const halfX = spec.width / 2 + plinth * 0.75
  const halfZ = spec.depth / 2 + plinth * 0.75
  const cos = Math.cos(building.rotation), sin = Math.sin(building.rotation)
  const points: Vertex[] = []
  const corners = [[-halfX, -halfZ], [-halfX, halfZ], [halfX, halfZ], [halfX, -halfZ]]
  for (let side = 0; side < 4; side++) {
    const a = corners[side], b = corners[(side + 1) % 4]
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))
    for (let i = 0; i < steps; i++) {
      const x = a[0] + (b[0] - a[0]) * i / steps
      const z = a[1] + (b[1] - a[1]) * i / steps
      const localX = building.x + x * cos + z * sin
      const localZ = building.z - x * sin + z * cos
      points.push({ x: localX, y: Math.min(baseY - 0.08, groundAt(localX, localZ) - 0.08), z: localZ })
    }
  }
  if (!points.some((point) => point.y < baseY - 0.14)) return null
  const positions: number[] = [], colors: number[] = []
  const top = new THREE.Color(0x888981), bottom = new THREE.Color(0x63695b)
  const emit = (a: Vertex, b: Vertex, c: Vertex, upper: readonly boolean[]) => {
    for (const [i, v] of [a, b, c].entries()) {
      positions.push(v.x, v.y, v.z)
      const color = upper[i] ? top : bottom
      colors.push(color.r, color.g, color.b)
    }
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    const at = { ...a, y: baseY + plinth * 0.9 }
    const bt = { ...b, y: baseY + plinth * 0.9 }
    // Only the perimeter wall. Its upper edge is buried in the existing solid plinth.
    emit(a, bt, at, [false, true, true]); emit(a, b, bt, [false, false, true])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.name = `foundation-contact:${building.id}`
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return paintPropResponse(geometry, [0.99, 0, 0.5, 0.08])
}
