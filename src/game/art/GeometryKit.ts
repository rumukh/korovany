import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { fbm3, ridgeNoise3 } from './ArtNoise.ts'
import type { ArtVariation } from './ArtRandom.ts'

/**
 * Procedural geometry construction for КОРОВАНЫ.
 *
 * Everything the game draws is generated in code — there is not a single imported
 * mesh in the repository and there never will be. This module is the vocabulary
 * that makes that affordable: lofted angular bodies, lathe and extrude profiles,
 * curve-driven branches, seeded noise displacement, deterministic merging, and the
 * vertex-attribute bakes (colour, occlusion, outline normals) that carry detail
 * without spending a single byte of texture memory.
 *
 * It depends on `three` and `src/game/random/` and nothing else, so it stays
 * importable from a Node test with no DOM.
 */

export interface Vec2Like {
  x: number
  y: number
}

export interface Vec3Like {
  x: number
  y: number
  z: number
}

/** Welded, crack-free normals used by the ink-outline shells. */
export const OUTLINE_NORMAL_ATTRIBUTE = 'outlineNormal'

const UP = new THREE.Vector3(0, 1, 0)
const FORWARD = new THREE.Vector3(0, 0, 1)

// ---------------------------------------------------------------------------
// Lofted bodies
// ---------------------------------------------------------------------------

export interface LoftSection {
  /** Height of this section along the loft axis. */
  y: number
  /** Cross-section scale on X. Defaults to `1`. */
  scaleX?: number
  /** Cross-section scale on Z. Defaults to `scaleX`. */
  scaleZ?: number
  /** Lateral offset, for leaning or sheared shapes. */
  offsetX?: number
  offsetZ?: number
  /** Twist around the loft axis, in radians. */
  rotation?: number
}

export interface LoftOptions {
  /** Closed cross-section polygon, counter-clockwise seen from +Y. */
  profile: readonly Vec2Like[]
  sections: readonly LoftSection[]
  /** Smooth normals around the profile. Faceted by default — this is a comic. */
  smooth?: boolean
  capBottom?: boolean
  capTop?: boolean
  name?: string
}

/**
 * Lofts a closed 2D profile through a stack of sections.
 *
 * This is the workhorse behind tapered boxes, bevelled boxes, capsules, trunks and
 * most hand-carved props. Output is non-indexed so faceted shading is exact and a
 * later `mergeAll` never has to reconcile index buffers.
 *
 * The profile must be **convex**: caps are triangulated as a fan from the first
 * point. `rectProfile` and `polygonProfile` both satisfy that. For a concave
 * silhouette use `extrudeProfile`, which runs a real triangulator.
 */
export function loftProfile(options: LoftOptions): THREE.BufferGeometry {
  const profile = options.profile
  const sections = options.sections
  if (profile.length < 3) {
    throw new RangeError('A loft profile needs at least three points')
  }
  if (sections.length < 2) {
    throw new RangeError('A loft needs at least two sections')
  }

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const ringCount = sections.length
  const pointCount = profile.length
  const rings: number[][] = []
  for (let ring = 0; ring < ringCount; ring += 1) {
    const section = sections[ring]
    const scaleX = section.scaleX ?? 1
    const scaleZ = section.scaleZ ?? scaleX
    const rotation = section.rotation ?? 0
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const coordinates: number[] = []
    for (let point = 0; point < pointCount; point += 1) {
      const source = profile[point]
      const scaledX = source.x * scaleX
      const scaledZ = source.y * scaleZ
      coordinates.push(
        scaledX * cos - scaledZ * sin + (section.offsetX ?? 0),
        section.y,
        scaledX * sin + scaledZ * cos + (section.offsetZ ?? 0),
      )
    }
    rings.push(coordinates)
  }

  const minY = sections[0].y
  const maxY = sections[ringCount - 1].y
  const span = maxY - minY || 1

  const smooth = options.smooth === true
  const radialNormal = new THREE.Vector3()
  const edgeA = new THREE.Vector3()
  const edgeB = new THREE.Vector3()
  const faceNormal = new THREE.Vector3()

  const pushVertex = (
    ring: number,
    point: number,
    normal: THREE.Vector3,
    u: number,
  ): void => {
    const offset = point * 3
    const x = rings[ring][offset]
    const y = rings[ring][offset + 1]
    const z = rings[ring][offset + 2]
    positions.push(x, y, z)
    normals.push(normal.x, normal.y, normal.z)
    uvs.push(u, (y - minY) / span)
  }

  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    for (let point = 0; point < pointCount; point += 1) {
      const next = (point + 1) % pointCount
      const lowerOffset = point * 3
      const nextOffset = next * 3
      const bottomLeft = rings[ring]
      const topLeft = rings[ring + 1]

      edgeA.set(
        bottomLeft[nextOffset] - bottomLeft[lowerOffset],
        bottomLeft[nextOffset + 1] - bottomLeft[lowerOffset + 1],
        bottomLeft[nextOffset + 2] - bottomLeft[lowerOffset + 2],
      )
      edgeB.set(
        topLeft[lowerOffset] - bottomLeft[lowerOffset],
        topLeft[lowerOffset + 1] - bottomLeft[lowerOffset + 1],
        topLeft[lowerOffset + 2] - bottomLeft[lowerOffset + 2],
      )
      faceNormal.crossVectors(edgeB, edgeA)
      if (faceNormal.lengthSq() < 1e-12) {
        // A collapsed ring zeroes its own tangential edge, and `edgeA` is taken
        // from the LOWER one -- so a downward spike (a `bottomScale: 0` taper, a
        // hanging horn, a mid-list pinch) used to fall through to the fixed
        // up-vector below and shade as though it pointed at the sky, ink shell
        // included. The opposite ring still has a tangential edge running the
        // same way round, so re-crossing against it keeps the orientation
        // instead of inventing one. Upward spikes never hit this path, which is
        // why the bug was asymmetric: the guard was, not the geometry.
        edgeA.set(
          topLeft[nextOffset] - topLeft[lowerOffset],
          topLeft[nextOffset + 1] - topLeft[lowerOffset + 1],
          topLeft[nextOffset + 2] - topLeft[lowerOffset + 2],
        )
        faceNormal.crossVectors(edgeB, edgeA)
      }
      if (faceNormal.lengthSq() < 1e-12) faceNormal.set(0, 1, 0)
      else faceNormal.normalize()

      const u0 = point / pointCount
      const u1 = (point + 1) / pointCount

      const normalFor = (pointIndex: number): THREE.Vector3 => {
        if (!smooth) return faceNormal
        const source = profile[pointIndex]
        radialNormal.set(source.x, 0, source.y)
        if (radialNormal.lengthSq() < 1e-12) radialNormal.copy(faceNormal)
        else radialNormal.normalize().setY(faceNormal.y).normalize()
        return radialNormal
      }

      // Counter-clockwise seen from outside, so the winding agrees with the
      // outward normals written above. Reversing these six pushes turns every
      // loft inside out: `FrontSide` would draw the far wall and the `BackSide`
      // ink shell would cover the mesh instead of haloing it.
      pushVertex(ring, point, normalFor(point), u0)
      pushVertex(ring + 1, next, normalFor(next), u1)
      pushVertex(ring, next, normalFor(next), u1)

      pushVertex(ring, point, normalFor(point), u0)
      pushVertex(ring + 1, point, normalFor(point), u0)
      pushVertex(ring + 1, next, normalFor(next), u1)
    }
  }

  const capNormal = new THREE.Vector3()
  const pushCap = (ring: number, upward: boolean): void => {
    const coordinates = rings[ring]
    capNormal.set(0, upward ? 1 : -1, 0)
    for (let point = 1; point < pointCount - 1; point += 1) {
      // Fan winding has to match the cap normal, same reasoning as the walls.
      const order = upward ? [0, point + 1, point] : [0, point, point + 1]
      for (const index of order) {
        const offset = index * 3
        positions.push(
          coordinates[offset],
          coordinates[offset + 1],
          coordinates[offset + 2],
        )
        normals.push(capNormal.x, capNormal.y, capNormal.z)
        uvs.push(profile[index].x + 0.5, profile[index].y + 0.5)
      }
    }
  }

  if (options.capBottom !== false) pushCap(0, false)
  if (options.capTop !== false) pushCap(ringCount - 1, true)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.name = options.name ?? 'art-loft'
  return geometry
}

/**
 * A closed rectangular cross-section, optionally chamfered at the corners.
 *
 * A chamfer is the cheapest way to stop a box reading as a box: it catches a
 * highlight on the corner and gives the ink outline something to follow.
 */
export function rectProfile(
  width: number,
  depth: number,
  bevel = 0,
): Vec2Like[] {
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const chamfer = Math.max(0, Math.min(bevel, Math.min(halfWidth, halfDepth) * 0.95))
  if (chamfer <= 1e-5) {
    return [
      { x: -halfWidth, y: -halfDepth },
      { x: halfWidth, y: -halfDepth },
      { x: halfWidth, y: halfDepth },
      { x: -halfWidth, y: halfDepth },
    ]
  }
  return [
    { x: -halfWidth + chamfer, y: -halfDepth },
    { x: halfWidth - chamfer, y: -halfDepth },
    { x: halfWidth, y: -halfDepth + chamfer },
    { x: halfWidth, y: halfDepth - chamfer },
    { x: halfWidth - chamfer, y: halfDepth },
    { x: -halfWidth + chamfer, y: halfDepth },
    { x: -halfWidth, y: halfDepth - chamfer },
    { x: -halfWidth, y: -halfDepth + chamfer },
  ]
}

/** A regular polygon cross-section. `sides = 8` is the house default for trunks. */
export function polygonProfile(
  radius: number,
  sides: number,
  phase = 0,
): Vec2Like[] {
  const count = Math.max(3, Math.floor(sides))
  const points: Vec2Like[] = []
  for (let index = 0; index < count; index += 1) {
    const angle = phase + (index / count) * Math.PI * 2
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
  }
  return points
}

export interface TaperedBoxOptions {
  width: number
  height: number
  depth: number
  /** Cross-section scale at the top. `1` is a plain box. */
  topScale?: number
  topDepthScale?: number
  bottomScale?: number
  bottomDepthScale?: number
  /** Lateral offset of the top face, for leaning or sheared bodies. */
  shearX?: number
  shearZ?: number
  /** Corner chamfer in world units. */
  bevel?: number
  /** Extra intermediate sections, for later noise displacement. */
  segments?: number
  /** Places the origin at the base instead of the centre. */
  anchor?: 'center' | 'base'
  name?: string
}

/** A box that is allowed to taper, lean and lose its corners. */
export function taperedBox(options: TaperedBoxOptions): THREE.BufferGeometry {
  const segments = Math.max(1, Math.floor(options.segments ?? 1))
  const bottomScale = options.bottomScale ?? 1
  const bottomDepthScale = options.bottomDepthScale ?? bottomScale
  const topScale = options.topScale ?? 1
  const topDepthScale = options.topDepthScale ?? topScale
  const baseY = options.anchor === 'base' ? 0 : -options.height / 2
  const sections: LoftSection[] = []
  for (let index = 0; index <= segments; index += 1) {
    const amount = index / segments
    sections.push({
      y: baseY + options.height * amount,
      scaleX: bottomScale + (topScale - bottomScale) * amount,
      scaleZ: bottomDepthScale + (topDepthScale - bottomDepthScale) * amount,
      offsetX: (options.shearX ?? 0) * amount,
      offsetZ: (options.shearZ ?? 0) * amount,
    })
  }
  return loftProfile({
    profile: rectProfile(options.width, options.depth, options.bevel ?? 0),
    sections,
    name: options.name ?? 'art-tapered-box',
  })
}

export interface StylizedCapsuleOptions {
  radius: number
  /** Length of the straight middle section. */
  height: number
  radialSegments?: number
  capSegments?: number
  /** Squashes the cross-section on Z, for limbs that should not be cylinders. */
  depthScale?: number
  /** Radius multiplier at the top of the shaft. */
  topScale?: number
  bottomScale?: number
  anchor?: 'center' | 'base'
  smooth?: boolean
  name?: string
}

/**
 * A faceted capsule: rounded caps, a taperable shaft, and few enough sides that
 * the silhouette still reads as carved rather than extruded.
 */
export function stylizedCapsule(
  options: StylizedCapsuleOptions,
): THREE.BufferGeometry {
  const radialSegments = Math.max(3, Math.floor(options.radialSegments ?? 8))
  const capSegments = Math.max(1, Math.floor(options.capSegments ?? 2))
  const depthScale = options.depthScale ?? 1
  const topScale = options.topScale ?? 1
  const bottomScale = options.bottomScale ?? 1
  const totalHeight = options.height + options.radius * 2
  const baseY = options.anchor === 'base' ? 0 : -totalHeight / 2

  // Floor the finished ring scale, not just the sine. `max(0.04, sin) * scale`
  // still collapses to zero whenever the caller passes `bottomScale: 0`, so the
  // guard only ever protected the default capsule -- the one shape that did not
  // need it.
  const sections: LoftSection[] = []
  for (let index = 0; index <= capSegments; index += 1) {
    const amount = index / capSegments
    const angle = (amount * Math.PI) / 2
    const ringScale = Math.max(0.04, Math.sin(angle) * bottomScale)
    sections.push({
      y: baseY + options.radius * (1 - Math.cos(angle)),
      scaleX: ringScale,
      scaleZ: ringScale * depthScale,
    })
  }
  sections.push({
    y: baseY + options.radius + options.height,
    scaleX: topScale,
    scaleZ: topScale * depthScale,
  })
  for (let index = 1; index <= capSegments; index += 1) {
    const amount = index / capSegments
    const angle = (amount * Math.PI) / 2
    const ringScale = Math.max(0.04, Math.cos(angle) * topScale)
    sections.push({
      y: baseY + options.radius + options.height + options.radius * Math.sin(angle),
      scaleX: ringScale,
      scaleZ: ringScale * depthScale,
    })
  }

  return loftProfile({
    profile: polygonProfile(options.radius, radialSegments),
    sections,
    smooth: options.smooth ?? true,
    name: options.name ?? 'art-capsule',
  })
}

// ---------------------------------------------------------------------------
// Profile-driven bodies
// ---------------------------------------------------------------------------

export interface LatheProfileOptions {
  segments?: number
  phiStart?: number
  phiLength?: number
  name?: string
}

/**
 * Revolves a silhouette. Best tool in the kit for pots, bells, helmets, cairns,
 * mushroom caps and anything else whose shape is a drawn outline.
 *
 * `normalizeNormals()` is not decoration. `THREE.LatheGeometry` writes the *last*
 * profile point's normal from `prevNormal`, which it copies before normalising it,
 * so the whole final ring comes out scaled by the length of the last profile
 * segment. Measured on this game's own art: `buildHeadgear('cap')` ends
 * `(0.24, 0.24) -> (0.001, 0.3)`, giving |n| = 0.246416, and `('hood')` ends
 * `(0.08, 0.5) -> (0.001, 0.54)`, giving |n| = 0.088549 — both exactly the length
 * of that segment, which is how the mechanism was identified rather than guessed.
 *
 * It went unnoticed because `transformed()` launders it: `applyMatrix4` runs
 * `applyNormalMatrix`, which normalises, so every lathe that happened to be
 * positioned came out clean and only the three that are used at the origin —
 * `cap`, `hood`, `ragHood` — carried it. That is the worst possible distribution
 * for a defect, because the callers that expose it look identical to the ones that
 * do not.
 *
 * What it costs: `bakeOutlineNormals` averages normals per welded position, so a
 * normal 11x shorter than its neighbours is 11x under-weighted and the ink shell
 * extrudes the wrong way at a hood's peak — the one vertex where the silhouette is
 * a single point and the error has nowhere to hide.
 */
export function latheProfile(
  points: readonly Vec2Like[],
  options: LatheProfileOptions = {},
): THREE.BufferGeometry {
  if (points.length < 2) {
    throw new RangeError('A lathe profile needs at least two points')
  }
  const geometry = new THREE.LatheGeometry(
    points.map((point) => new THREE.Vector2(Math.max(1e-4, point.x), point.y)),
    Math.max(3, Math.floor(options.segments ?? 10)),
    options.phiStart ?? 0,
    options.phiLength ?? Math.PI * 2,
  )
  geometry.normalizeNormals()
  geometry.name = options.name ?? 'art-lathe'
  return geometry
}

export interface ExtrudeProfileOptions {
  depth?: number
  bevelSize?: number
  bevelThickness?: number
  bevelSegments?: number
  steps?: number
  curveSegments?: number
  /** Centres the extrusion on Z instead of starting at Z=0. */
  centered?: boolean
  name?: string
}

/**
 * Extrudes a drawn outline. Used for plaques, blades, shields, signs and banners —
 * anything that is a flat shape with thickness.
 */
export function extrudeProfile(
  points: readonly Vec2Like[],
  options: ExtrudeProfileOptions = {},
): THREE.BufferGeometry {
  if (points.length < 3) {
    throw new RangeError('An extrude profile needs at least three points')
  }
  const shape = new THREE.Shape()
  shape.moveTo(points[0].x, points[0].y)
  for (let index = 1; index < points.length; index += 1) {
    shape.lineTo(points[index].x, points[index].y)
  }
  shape.closePath()

  const depth = options.depth ?? 0.2
  const bevelSize = options.bevelSize ?? 0
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevelSize > 0,
    bevelSize,
    bevelThickness: options.bevelThickness ?? bevelSize,
    bevelSegments: Math.max(1, Math.floor(options.bevelSegments ?? 1)),
    steps: Math.max(1, Math.floor(options.steps ?? 1)),
    curveSegments: Math.max(1, Math.floor(options.curveSegments ?? 4)),
  })
  if (options.centered !== false) geometry.translate(0, 0, -depth / 2)
  geometry.computeVertexNormals()
  geometry.name = options.name ?? 'art-extrude'
  return geometry
}

// ---------------------------------------------------------------------------
// Curve-driven bodies
// ---------------------------------------------------------------------------

export interface TubeOptions {
  /** Constant radius, or a function of the normalized distance along the curve. */
  radius?: number | ((t: number) => number)
  radialSegments?: number
  tubularSegments?: number
  capStart?: boolean
  capEnd?: boolean
  smooth?: boolean
  name?: string
}

/**
 * Builds a tapering tube along a Catmull-Rom curve using parallel transport.
 *
 * `THREE.TubeGeometry` cannot vary its radius, and varying radius is the entire
 * point for branches, roots, ropes, horns and tails.
 */
export function tubeAlongPoints(
  points: readonly Vec3Like[],
  options: TubeOptions = {},
): THREE.BufferGeometry {
  if (points.length < 2) {
    throw new RangeError('A tube needs at least two points')
  }
  const radialSegments = Math.max(3, Math.floor(options.radialSegments ?? 6))
  const tubularSegments = Math.max(1, Math.floor(options.tubularSegments ?? 8))
  const radiusAt =
    typeof options.radius === 'function'
      ? options.radius
      : ((): ((t: number) => number) => {
          const constant = options.radius ?? 0.1
          return () => constant
        })()

  const curve = new THREE.CatmullRomCurve3(
    points.map((point) => new THREE.Vector3(point.x, point.y, point.z)),
    false,
    'catmullrom',
    0.5,
  )

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const tangent = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const binormal = new THREE.Vector3()
  const center = new THREE.Vector3()
  const previousNormal = new THREE.Vector3()

  const ringPositions: THREE.Vector3[][] = []
  const ringNormals: THREE.Vector3[][] = []

  for (let step = 0; step <= tubularSegments; step += 1) {
    const t = step / tubularSegments
    curve.getPointAt(t, center)
    curve.getTangentAt(t, tangent).normalize()

    if (step === 0) {
      normal.copy(Math.abs(tangent.y) > 0.92 ? FORWARD : UP)
      normal.cross(tangent)
      if (normal.lengthSq() < 1e-10) normal.set(1, 0, 0)
      normal.normalize()
    } else {
      normal.copy(previousNormal)
      normal.addScaledVector(tangent, -normal.dot(tangent))
      if (normal.lengthSq() < 1e-10) {
        normal.copy(Math.abs(tangent.y) > 0.92 ? FORWARD : UP).cross(tangent)
      }
      normal.normalize()
    }
    previousNormal.copy(normal)
    binormal.crossVectors(tangent, normal).normalize()

    const radius = Math.max(1e-4, radiusAt(t))
    const positionRing: THREE.Vector3[] = []
    const normalRing: THREE.Vector3[] = []
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const outward = new THREE.Vector3()
        .addScaledVector(normal, cos)
        .addScaledVector(binormal, sin)
      normalRing.push(outward.clone())
      positionRing.push(
        new THREE.Vector3().copy(center).addScaledVector(outward, radius),
      )
    }
    ringPositions.push(positionRing)
    ringNormals.push(normalRing)
  }

  const smooth = options.smooth !== false
  const edgeA = new THREE.Vector3()
  const edgeB = new THREE.Vector3()
  const faceNormal = new THREE.Vector3()

  for (let ring = 0; ring < tubularSegments; ring += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments
      const a = ringPositions[ring][segment]
      const b = ringPositions[ring][next]
      const c = ringPositions[ring + 1][next]
      const d = ringPositions[ring + 1][segment]

      edgeA.subVectors(b, a)
      edgeB.subVectors(d, a)
      faceNormal.crossVectors(edgeA, edgeB)
      if (faceNormal.lengthSq() < 1e-12) faceNormal.copy(ringNormals[ring][segment])
      else faceNormal.normalize()

      const u0 = segment / radialSegments
      const u1 = (segment + 1) / radialSegments
      const v0 = ring / tubularSegments
      const v1 = (ring + 1) / tubularSegments

      const push = (
        point: THREE.Vector3,
        vertexNormal: THREE.Vector3,
        u: number,
        v: number,
      ): void => {
        positions.push(point.x, point.y, point.z)
        const chosen = smooth ? vertexNormal : faceNormal
        normals.push(chosen.x, chosen.y, chosen.z)
        uvs.push(u, v)
      }

      push(a, ringNormals[ring][segment], u0, v0)
      push(b, ringNormals[ring][next], u1, v0)
      push(c, ringNormals[ring + 1][next], u1, v1)
      push(a, ringNormals[ring][segment], u0, v0)
      push(c, ringNormals[ring + 1][next], u1, v1)
      push(d, ringNormals[ring + 1][segment], u0, v1)
    }
  }

  const pushCap = (ring: number, outward: THREE.Vector3): void => {
    const positionRing = ringPositions[ring]
    const middle = new THREE.Vector3()
    for (const point of positionRing) middle.add(point)
    middle.multiplyScalar(1 / positionRing.length)
    // Winding has to follow the requested outward direction, not the world up axis:
    // a horizontal or descending tube would otherwise get a back-facing cap, which
    // `FrontSide` culls into a hole. Test the first triangle and flip if it faces in.
    const edgeA = new THREE.Vector3().subVectors(positionRing[0], middle)
    const edgeB = new THREE.Vector3().subVectors(
      positionRing[1 % positionRing.length],
      middle,
    )
    const flip = edgeA.cross(edgeB).dot(outward) < 0
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments
      const first = flip ? positionRing[next] : positionRing[segment]
      const second = flip ? positionRing[segment] : positionRing[next]
      for (const point of [middle, first, second]) {
        positions.push(point.x, point.y, point.z)
        normals.push(outward.x, outward.y, outward.z)
        uvs.push(0.5, 0.5)
      }
    }
  }

  if (options.capStart) {
    curve.getTangentAt(0, tangent).normalize().multiplyScalar(-1)
    pushCap(0, tangent.clone())
  }
  if (options.capEnd) {
    curve.getTangentAt(1, tangent).normalize()
    pushCap(tubularSegments, tangent.clone())
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.name = options.name ?? 'art-tube'
  return geometry
}

export interface BranchStructureOptions {
  variation: ArtVariation
  /** Length of the trunk. */
  height: number
  baseRadius: number
  tipRadius?: number
  /** How many child branches leave the trunk. */
  branchCount?: number
  /** Recursion depth. `0` is a bare trunk. */
  depth?: number
  /** Angle of a child branch away from its parent, in radians. */
  spread?: number
  /** Fraction of the parent's length a child keeps. */
  lengthFalloff?: number
  radialSegments?: number
  segmentsPerBranch?: number
  /** Lateral wander of the trunk, in world units per unit of height. */
  lean?: number
  name?: string
}

/**
 * Grows a deterministic branch skeleton and merges it into one geometry.
 *
 * The world-object pass uses this for trees, roots, driftwood and antlers; the NPC
 * pass uses it for horns and tails. Recursion depth is clamped hard because this
 * runs during region streaming.
 */
export function branchStructure(
  options: BranchStructureOptions,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const maxDepth = Math.max(0, Math.min(3, Math.floor(options.depth ?? 1)))
  const branchCount = Math.max(0, Math.min(6, Math.floor(options.branchCount ?? 3)))
  const spread = options.spread ?? 0.7
  const lengthFalloff = options.lengthFalloff ?? 0.62
  const radialSegments = Math.max(3, Math.floor(options.radialSegments ?? 5))
  const segments = Math.max(2, Math.floor(options.segmentsPerBranch ?? 4))
  const lean = options.lean ?? 0.08
  const variation = options.variation

  const grow = (
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    length: number,
    baseRadius: number,
    tipRadius: number,
    depth: number,
  ): void => {
    const points: Vec3Like[] = []
    const cursor = origin.clone()
    const heading = direction.clone().normalize()
    points.push({ x: cursor.x, y: cursor.y, z: cursor.z })
    for (let step = 1; step <= segments; step += 1) {
      const stepLength = length / segments
      heading.x += variation.signed(lean)
      heading.z += variation.signed(lean)
      heading.y += variation.signed(lean * 0.35)
      heading.normalize()
      cursor.addScaledVector(heading, stepLength)
      points.push({ x: cursor.x, y: cursor.y, z: cursor.z })
    }
    parts.push(
      tubeAlongPoints(points, {
        radius: (t) => baseRadius + (tipRadius - baseRadius) * t,
        radialSegments,
        tubularSegments: segments * 2,
        capEnd: depth === 0,
        name: 'art-branch',
      }),
    )
    if (depth <= 0) return

    for (let index = 0; index < branchCount; index += 1) {
      const attachment = variation.range(0.45, 0.92)
      const attachmentIndex = Math.min(
        points.length - 1,
        Math.max(1, Math.round(attachment * (points.length - 1))),
      )
      const attachmentPoint = points[attachmentIndex]
      const azimuth =
        (index / branchCount) * Math.PI * 2 + variation.signed(0.6)
      const tilt = spread * variation.around(1, 0.28)
      const childDirection = new THREE.Vector3(
        Math.cos(azimuth) * Math.sin(tilt),
        Math.cos(tilt),
        Math.sin(azimuth) * Math.sin(tilt),
      )
        .add(heading.clone().multiplyScalar(0.4))
        .normalize()
      const childLength = length * lengthFalloff * variation.around(1, 0.18)
      const childBase = tipRadius * variation.around(0.95, 0.15)
      grow(
        new THREE.Vector3(
          attachmentPoint.x,
          attachmentPoint.y,
          attachmentPoint.z,
        ),
        childDirection,
        childLength,
        childBase,
        childBase * 0.42,
        depth - 1,
      )
    }
  }

  grow(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 1, 0),
    options.height,
    options.baseRadius,
    options.tipRadius ?? options.baseRadius * 0.42,
    maxDepth,
  )

  return mergeAll(parts, { name: options.name ?? 'art-branch-structure' })
}

// ---------------------------------------------------------------------------
// Organic surfaces
// ---------------------------------------------------------------------------

/**
 * Grid used to decide whether two vertices are "the same corner" before displacing.
 * 1e5 puts the tolerance at 10 microns in world units, far below any seam this
 * toolkit produces and far above float error on a built profile.
 */
const SEAM_WELD_PRECISION = 1e5

export interface DisplaceOptions {
  /** Uint32 noise seed, usually from `artNoiseSeed(worldSeed, label)`. */
  seed: number
  amplitude: number
  frequency?: number
  octaves?: number
  /** `fbm` for lumpy stone and bark, `ridge` for cracked, faceted rock. */
  mode?: 'fbm' | 'ridge'
  /** Leaves vertices within this distance of the lowest point untouched. */
  flatBase?: number
  /** Per-axis weighting, for shapes that should stretch rather than inflate. */
  axisScale?: Vec3Like
  /** Recomputes normals after displacing. On by default. */
  recomputeNormals?: boolean
  /**
   * Re-closes seams that displacement pulls open. **Off by default**, because
   * turning it on moves vertices and so changes every silhouette it touches.
   *
   * Displacement runs along each vertex's own normal. On a non-indexed buffer whose
   * normals are faceted, the several copies of one corner each carry a different
   * normal, travel in different directions, and the surface splits along every hard
   * crease. Nothing in the orientation instruments can see this — signed volume stays
   * positive, winding stays consistent, normals stay in agreement — because a torn
   * surface is still correctly wound. It shows up only as a boundary edge, or on
   * screen as a crack.
   *
   * Turn it on for any shape whose source normals are faceted. It is a measured
   * no-op for shapes whose normals are radial, such as `IcosahedronGeometry` above
   * detail 0, where every copy of a corner shares one normal and they never separate.
   */
  seamless?: boolean
}

/**
 * Buckets vertex indices that currently sit at the same position.
 *
 * Quantised rather than exact, because a seam that arrives from two different
 * construction paths can be a rounding step apart before anything displaces it.
 */
function coincidentGroups(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): number[][] {
  const buckets = new Map<string, number[]>()
  for (let index = 0; index < position.count; index += 1) {
    const key =
      `${Math.round(position.getX(index) * SEAM_WELD_PRECISION)},` +
      `${Math.round(position.getY(index) * SEAM_WELD_PRECISION)},` +
      `${Math.round(position.getZ(index) * SEAM_WELD_PRECISION)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(index)
    else buckets.set(key, [index])
  }
  const groups: number[][] = []
  for (const bucket of buckets.values()) if (bucket.length > 1) groups.push(bucket)
  return groups
}

/**
 * Pushes vertices along their normals with seeded noise.
 *
 * This is what turns a cylinder into bark and a dodecahedron into a boulder without
 * a single extra triangle. It mutates the geometry in place; clone first if the
 * source is shared.
 */
export function displaceGeometry(
  geometry: THREE.BufferGeometry,
  options: DisplaceOptions,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!position) return geometry
  if (!normal) geometry.computeVertexNormals()
  const normals = geometry.getAttribute('normal')

  const frequency = options.frequency ?? 1
  const octaves = options.octaves ?? 3
  const ridged = options.mode === 'ridge'
  const axisScale = options.axisScale
  const flatBase = options.flatBase ?? 0

  // Has to be recorded before anything moves: once the seam is open there is no way
  // to tell which vertices used to be the same corner.
  const seams = options.seamless ? coincidentGroups(position) : null

  let minimumY = Infinity
  if (flatBase > 0) {
    for (let index = 0; index < position.count; index += 1) {
      minimumY = Math.min(minimumY, position.getY(index))
    }
  }

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const sample = ridged
      ? ridgeNoise3(x * frequency, y * frequency, z * frequency, options.seed, octaves) *
          2 -
        1
      : fbm3(x * frequency, y * frequency, z * frequency, options.seed, octaves)
    let strength = options.amplitude * sample
    if (flatBase > 0) {
      const above = y - minimumY
      strength *= Math.min(1, above / Math.max(1e-4, flatBase))
    }
    position.setXYZ(
      index,
      x + normals.getX(index) * strength * (axisScale?.x ?? 1),
      y + normals.getY(index) * strength * (axisScale?.y ?? 1),
      z + normals.getZ(index) * strength * (axisScale?.z ?? 1),
    )
  }
  // Collapse each recorded seam back onto one point. Positions only — the normals are
  // recomputed below from the repaired triangles, so a hard crease stays hard and the
  // face normals describe the geometry that is actually there.
  //
  // The `moved` guard is defensive, not load-bearing, and a mutation campaign proved
  // it: deleting it leaves all four seam tests green. Positions are Float32-backed, so
  // summing n identical values needs at most 24 + log2(n) bits and is exact in double
  // precision, and a correctly-rounded division by n then returns the value itself. It
  // is kept for the case this reasoning does not cover — a Float64 attribute carrying
  // values that need the full mantissa — and for the writes it skips. Do not write a
  // test claiming to pin it; there is no input that can tell the two versions apart.
  if (seams) {
    for (const group of seams) {
      const firstX = position.getX(group[0])
      const firstY = position.getY(group[0])
      const firstZ = position.getZ(group[0])
      let x = 0
      let y = 0
      let z = 0
      let moved = false
      for (const index of group) {
        const vertexX = position.getX(index)
        const vertexY = position.getY(index)
        const vertexZ = position.getZ(index)
        if (vertexX !== firstX || vertexY !== firstY || vertexZ !== firstZ) moved = true
        x += vertexX
        y += vertexY
        z += vertexZ
      }
      if (!moved) continue
      x /= group.length
      y /= group.length
      z /= group.length
      for (const index of group) position.setXYZ(index, x, y, z)
    }
  }
  position.needsUpdate = true
  if (options.recomputeNormals !== false) geometry.computeVertexNormals()
  // Ink normals were welded against the *undisplaced* surface, so leaving them
  // alone makes the hull drift off the silhouette exactly where displacement is
  // strongest. Re-weld whenever the attribute is present.
  if (geometry.getAttribute(OUTLINE_NORMAL_ATTRIBUTE)) {
    geometry.deleteAttribute(OUTLINE_NORMAL_ATTRIBUTE)
    bakeOutlineNormals(geometry)
  }
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

/** Hard-edges a geometry so every triangle keeps its own normal. */
export interface FacetOptions {
  /**
   * Consumes the input instead of leaving it untouched. Off by default —
   * opt in only when you built the input purely to facet it.
   */
  dispose?: boolean
  name?: string
}

/**
 * Returns a hard-edged copy: every triangle gets its own flat normal.
 *
 * **Non-destructive by default.** This is exported to the model passes, and the
 * two ways to break a shared buffer here are disposing a cached input and
 * recomputing normals in place on a geometry other meshes still reference — so
 * neither happens unless `dispose` is set. Never pass a `GeometryCache.acquire`
 * result with `dispose: true`.
 */
export function facetGeometry(
  geometry: THREE.BufferGeometry,
  options: FacetOptions = {},
): THREE.BufferGeometry {
  const faceted = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  faceted.computeVertexNormals()
  faceted.name = options.name ?? geometry.name
  if (options.dispose === true) geometry.dispose()
  return faceted
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export interface MergeOptions {
  /**
   * Disposes the source geometries. On by default; merging is a move, not a copy.
   *
   * With `false` the inputs are left untouched — the merge works on copies, and a
   * single-part merge returns a clone rather than the input itself.
   */
  dispose?: boolean
  /** Keeps per-part draw groups so a merged mesh can use a material array. */
  useGroups?: boolean
  name?: string
}

const MERGE_ATTRIBUTES = ['uv', 'color', OUTLINE_NORMAL_ATTRIBUTE] as const

/**
 * Geometries a previous `mergeAll` has taken ownership of and disposed.
 *
 * Merging is a move. Re-using a moved-from geometry is silent in a way nothing else
 * here is: `dispose()` frees the GPU buffer but leaves the JS object fully readable,
 * so the second merge succeeds, produces correct-looking vertex data, and the fault
 * only surfaces when a draw reads a buffer that was freed underneath it. Measured:
 * after `dispose()` a geometry still reports its full attribute counts and still
 * merges without throwing.
 *
 * Two shapes of the same mistake, both caught here:
 *
 *   - the same geometry twice in one call — `mergeAll([g, g])` silently double-counts
 *     (72 vertices from a 24-vertex box) and disposes `g` twice;
 *   - the same geometry across two calls — and because a single-part merge hands the
 *     input straight back, `mergeAll([g])` twice returns *one object* under two names,
 *     so releasing either disposes the other.
 *
 * The passthrough is why membership is recorded for every input **except** the one
 * returned: ownership of that object goes back to the caller, so composing merges
 * (`mergeAll([mergeAll([a]), b])`) stays legal. `dispose: false` consumes nothing and
 * records nothing.
 *
 * **What this cannot catch, and why the caller must.** A single-part merge returns its
 * input, so `mergeAll([g])` twice and `mergeAll([mergeAll([g]), h])` pass the identical
 * object to a second merge. One is the bug, the other is composition, and no identity
 * here separates them — reusing the *result* and reusing the *source* are the same
 * operation on the same object. Recording the passthrough would reject both.
 *
 * That information exists one layer up: a caller holding a parts list can see one
 * geometry tagged under two surfaces *before* any merge happens, which is what
 * `mergePropParts` checks. Same shape as `GeometryCache.release` — a guard belongs
 * where the identity is, and a foundation guard is not a substitute for it.
 */
const mergedAway = new WeakSet<THREE.BufferGeometry>()

function assertNotAlreadyMerged(
  parts: readonly THREE.BufferGeometry[],
  name: string | undefined,
): void {
  const label = name ?? 'art-merged'
  const withinCall = new Set<THREE.BufferGeometry>()
  for (const part of parts) {
    if (withinCall.has(part)) {
      throw new Error(
        `Cannot merge ${label}: the same geometry appears twice in one merge, which `
        + 'would double its vertices and dispose it twice. Clone it, or pass '
        + '`dispose: false` if the source must survive.',
      )
    }
    if (mergedAway.has(part)) {
      throw new Error(
        `Cannot merge ${label}: this geometry was already consumed by an earlier `
        + 'merge, so its buffer is disposed and belongs to another geometry now. '
        + 'Merging is a move — clone it, or pass `dispose: false` at the first merge.',
      )
    }
    withinCall.add(part)
  }
}

/**
 * Merges parts into one geometry, reconciling attribute sets first.
 *
 * `mergeGeometries` returns `null` when the parts disagree about attributes or
 * indexing, and a silent `null` here is the single most common way this codebase
 * used to leak a half-built prop. So: normalize, merge, and throw loudly.
 *
 * Sources are consumed unless `dispose: false`; re-using one afterwards throws rather
 * than corrupting a frame later. See `mergedAway`.
 *
 * **The output is non-indexed only when there is more than one part.** A real merge
 * calls `toNonIndexed()` on every indexed part first, because mixed indexing is one of
 * the disagreements `mergeGeometries` answers with `null`. The single-part path hands
 * its input straight back, so an indexed input stays indexed:
 *
 *     mergeAll([cylinder])            INDEXED       96 idx / 52 pos
 *     mergeAll([cylinder, cylinder])  non-indexed   192 pos
 *     mergeAll([latheProfile(...)])   INDEXED       96 idx / 27 pos
 *
 * That matters to anything downstream that reads triangles or welds vertices, because
 * an indexed buffer has no duplicate corners to weld and a different attribute count
 * for the same shape — `bakeOutlineNormals` writes 52 entries in the first row above
 * and 96 in the second. Lathe- and revolve-built parts are the common route in, since
 * they are indexed by construction and are frequently a prop's only part.
 *
 * Readers in this kit handle both. Consumers outside it must not assume the count-
 * dependent case away: **write against `geometry.index`, not against what a two-part
 * merge happens to return.**
 *
 * Normalising the single-part path would make the contract uniform and is the obvious
 * tidy-up, but it is not free — `toNonIndexed()` costs +85% vertices on a cylinder and
 * +256% on a lathe profile, on every single-part prop in a streamed world. Priced and
 * deliberately not taken here; see `tests/mergeOwnership.test.ts`, which pins both rows
 * so the behaviour cannot drift silently in either direction.
 */
export function mergeAll(
  parts: readonly THREE.BufferGeometry[],
  options: MergeOptions = {},
): THREE.BufferGeometry {
  if (parts.length === 0) {
    throw new RangeError('Cannot merge an empty geometry list')
  }
  const dispose = options.dispose !== false
  if (dispose) assertNotAlreadyMerged(parts, options.name)
  if (parts.length === 1) {
    // Move semantics hand the input straight back; a copy must not be mutated.
    const single = dispose ? parts[0] : parts[0].clone()
    if (!single.getAttribute('normal')) single.computeVertexNormals()
    if (options.name) single.name = options.name
    return single
  }

  const prepared = parts.map((part) => {
    let geometry = part
    if (geometry.index) {
      const nonIndexed = geometry.toNonIndexed()
      nonIndexed.name = geometry.name
      if (dispose) geometry.dispose()
      geometry = nonIndexed
    } else if (!dispose) {
      // A non-indexed part would otherwise still be the caller's object here, and
      // everything below may add attributes to it. Handing back a geometry we
      // quietly gave a white `color` renders it white under any `vertexColors`
      // material, and a synthesised `outlineNormal` changes which outline material
      // `applyOutline` picks for it. `dispose: false` promises the inputs survive
      // unchanged, so detach before the normalisation pass rather than after.
      const copy = geometry.clone()
      copy.name = geometry.name
      geometry = copy
    }
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
    return geometry
  })

  for (const attribute of MERGE_ATTRIBUTES) {
    if (!prepared.some((geometry) => geometry.getAttribute(attribute))) continue
    for (const geometry of prepared) {
      if (geometry.getAttribute(attribute)) continue
      if (attribute === 'uv') {
        geometry.setAttribute(
          'uv',
          new THREE.Float32BufferAttribute(
            new Float32Array(geometry.getAttribute('position').count * 2),
            2,
          ),
        )
      } else if (attribute === 'color') {
        const count = geometry.getAttribute('position').count
        const values = new Float32Array(count * 3).fill(1)
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(values, 3))
      } else {
        const source = geometry.getAttribute('normal')
        geometry.setAttribute(
          OUTLINE_NORMAL_ATTRIBUTE,
          new THREE.Float32BufferAttribute(
            Float32Array.from(source.array as ArrayLike<number>),
            3,
          ),
        )
      }
    }
  }

  const merged = mergeGeometries(prepared, options.useGroups === true)
  for (const geometry of prepared) {
    const isOriginal = parts.includes(geometry)
    if (dispose || !isOriginal) geometry.dispose()
  }
  // Every source is gone now. Record them so a later merge reports a use-after-move
  // instead of quietly reading a freed buffer. The single-part path above returns its
  // input and so records nothing — see `mergedAway`.
  if (dispose) for (const part of parts) mergedAway.add(part)
  if (!merged) {
    throw new Error(
      `Could not merge ${String(parts.length)} geometries: attribute sets disagree`,
    )
  }
  merged.name = options.name ?? 'art-merged'
  return merged
}

export interface TransformOptions {
  position?: Vec3Like
  rotation?: Vec3Like
  scale?: Vec3Like | number
}

/**
 * Bakes a transform into a geometry. Returns the same geometry for chaining.
 *
 * Baked outline normals are carried through the rotation as well, so the order of
 * `transformed` and `bakeOutlineNormals` does not matter.
 */
/**
 * Swaps the second and third vertex of every triangle, reversing the facing of the
 * whole geometry. Indexed geometry only needs its index triples reordered; a
 * non-indexed one has to swap every attribute in step, or positions and normals
 * would end up describing different vertices.
 */
function reverseWinding(geometry: THREE.BufferGeometry): void {
  const index = geometry.getIndex()
  if (index) {
    for (let triangle = 0; triangle + 2 < index.count; triangle += 3) {
      const swap = index.getX(triangle + 1)
      index.setX(triangle + 1, index.getX(triangle + 2))
      index.setX(triangle + 2, swap)
    }
    index.needsUpdate = true
    return
  }
  for (const attribute of Object.values(geometry.attributes)) {
    const { itemSize } = attribute
    for (let triangle = 0; triangle + 2 < attribute.count; triangle += 3) {
      for (let component = 0; component < itemSize; component += 1) {
        const b = attribute.array[(triangle + 1) * itemSize + component]
        attribute.array[(triangle + 1) * itemSize + component] =
          attribute.array[(triangle + 2) * itemSize + component]
        attribute.array[(triangle + 2) * itemSize + component] = b as number
      }
    }
    attribute.needsUpdate = true
  }
}

export function transformed(
  geometry: THREE.BufferGeometry,
  options: TransformOptions,
): THREE.BufferGeometry {
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  if (options.rotation) {
    quaternion.setFromEuler(
      new THREE.Euler(options.rotation.x, options.rotation.y, options.rotation.z),
    )
  }
  const scale =
    typeof options.scale === 'number'
      ? new THREE.Vector3(options.scale, options.scale, options.scale)
      : new THREE.Vector3(
          options.scale?.x ?? 1,
          options.scale?.y ?? 1,
          options.scale?.z ?? 1,
        )
  matrix.compose(
    new THREE.Vector3(
      options.position?.x ?? 0,
      options.position?.y ?? 0,
      options.position?.z ?? 0,
    ),
    quaternion,
    scale,
  )
  geometry.applyMatrix4(matrix)
  // A mirror (negative determinant) reflects positions but leaves vertex order
  // alone, so the result is inside-out: every triangle winds against its own
  // normal and against the outward direction. `applyMatrix4` will not do this for
  // us, and §5.3 publishes outward winding as an invariant the kit guarantees, so
  // reversing here is what keeps a mirrored left/right pair honest.
  if (matrix.determinant() < 0) reverseWinding(geometry)
  // `applyMatrix4` knows about `position`, `normal` and `tangent`. Baked ink
  // normals are a custom attribute, so without this they stay in the pre-transform
  // frame and the inverted hull extrudes sideways into the mesh it should halo.
  const outlineNormals = geometry.getAttribute(OUTLINE_NORMAL_ATTRIBUTE)
  if (outlineNormals) {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix)
    const carried = new THREE.Vector3()
    for (let index = 0; index < outlineNormals.count; index += 1) {
      carried
        .fromBufferAttribute(outlineNormals as THREE.BufferAttribute, index)
        .applyMatrix3(normalMatrix)
      if (carried.lengthSq() < 1e-12) continue
      carried.normalize()
      outlineNormals.setXYZ(index, carried.x, carried.y, carried.z)
    }
    outlineNormals.needsUpdate = true
  }
  return geometry
}

// ---------------------------------------------------------------------------
// Vertex attributes: colour, occlusion, outline normals
// ---------------------------------------------------------------------------

/** Adds a white `color` attribute when the geometry does not have one yet. */
export function ensureVertexColors(
  geometry: THREE.BufferGeometry,
  base?: THREE.ColorRepresentation,
): THREE.BufferGeometry {
  if (geometry.getAttribute('color')) return geometry
  const count = geometry.getAttribute('position').count
  const values = new Float32Array(count * 3)
  if (base === undefined) {
    values.fill(1)
  } else {
    const color = new THREE.Color(base)
    for (let index = 0; index < count; index += 1) {
      values[index * 3] = color.r
      values[index * 3 + 1] = color.g
      values[index * 3 + 2] = color.b
    }
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(values, 3))
  return geometry
}

export interface VertexPaintContext {
  x: number
  y: number
  z: number
  normalX: number
  normalY: number
  normalZ: number
  index: number
  /** Normalized height inside the geometry's own bounding box. */
  heightRatio: number
}

export type VertexPaint = (
  context: VertexPaintContext,
  out: THREE.Color,
) => void

/**
 * Paints per-vertex colour.
 *
 * Baked vertex colour is the cheapest detail in a procedural game: no texture
 * memory, no sampler, no UV layout, and it survives instancing and merging.
 */
export function paintVertexColors(
  geometry: THREE.BufferGeometry,
  paint: VertexPaint,
): THREE.BufferGeometry {
  ensureVertexColors(geometry)
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const color = geometry.getAttribute('color')
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox
  const minimumY = box ? box.min.y : 0
  const span = box ? Math.max(1e-5, box.max.y - box.min.y) : 1
  const scratch = new THREE.Color()

  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index)
    scratch.setRGB(color.getX(index), color.getY(index), color.getZ(index))
    paint(
      {
        x: position.getX(index),
        y,
        z: position.getZ(index),
        normalX: normal ? normal.getX(index) : 0,
        normalY: normal ? normal.getY(index) : 1,
        normalZ: normal ? normal.getZ(index) : 0,
        index,
        heightRatio: (y - minimumY) / span,
      },
      scratch,
    )
    color.setXYZ(index, scratch.r, scratch.g, scratch.b)
  }
  color.needsUpdate = true
  return geometry
}

export interface GradientColorOptions {
  bottom: THREE.ColorRepresentation
  top: THREE.ColorRepresentation
  /** Shapes the ramp. `1` is linear, `>1` keeps the bottom colour longer. */
  bias?: number
}

/** Bakes a vertical two-colour ramp, the workhorse for foliage and cloth. */
export function gradientVertexColors(
  geometry: THREE.BufferGeometry,
  options: GradientColorOptions,
): THREE.BufferGeometry {
  const bottom = new THREE.Color(options.bottom)
  const top = new THREE.Color(options.top)
  const bias = options.bias ?? 1
  return paintVertexColors(geometry, (context, out) => {
    const amount = Math.pow(Math.min(1, Math.max(0, context.heightRatio)), bias)
    out.setRGB(
      bottom.r + (top.r - bottom.r) * amount,
      bottom.g + (top.g - bottom.g) * amount,
      bottom.b + (top.b - bottom.b) * amount,
    )
  })
}

export interface VerticalOcclusionOptions {
  /** How dark the base gets. `0.35` removes 35% of the colour. */
  strength?: number
  /** World-space height over which the darkening fades out. */
  falloff?: number
  /** Tint the occlusion towards a colour instead of pure black. */
  tint?: THREE.ColorRepresentation
}

/**
 * Bakes contact darkening at the base of a geometry.
 *
 * The cheapest possible "this object touches the ground" cue, and the reason the
 * world stops looking like a set of props hovering a centimetre above the terrain.
 */
export function bakeVerticalOcclusion(
  geometry: THREE.BufferGeometry,
  options: VerticalOcclusionOptions = {},
): THREE.BufferGeometry {
  const strength = Math.min(0.95, Math.max(0, options.strength ?? 0.34))
  if (strength <= 0) return ensureVertexColors(geometry)
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox
  const height = box ? box.max.y - box.min.y : 1
  const falloff = Math.max(1e-4, options.falloff ?? height * 0.42)
  const tint = options.tint === undefined ? null : new THREE.Color(options.tint)
  const minimumY = box ? box.min.y : 0

  return paintVertexColors(geometry, (context, out) => {
    const above = context.y - minimumY
    const shade = 1 - strength * (1 - Math.min(1, above / falloff))
    if (tint) {
      out.setRGB(
        out.r * shade + tint.r * (1 - shade),
        out.g * shade + tint.g * (1 - shade),
        out.b * shade + tint.b * (1 - shade),
      )
    } else {
      out.multiplyScalar(shade)
    }
  })
}

export interface SkyOcclusionOptions {
  /** How dark a fully downward-facing vertex becomes. */
  strength?: number
}

/**
 * Bakes a sky-visibility approximation from the vertex normal.
 *
 * Real screen-space AO costs a depth prepass, a blur and a full-screen pass. For an
 * angular, low-poly, seeded world, `0.5 + 0.5 * normal.y` in the vertex colour gets
 * most of the readability for none of the frame time.
 */
export function bakeSkyOcclusion(
  geometry: THREE.BufferGeometry,
  options: SkyOcclusionOptions = {},
): THREE.BufferGeometry {
  const strength = Math.min(0.9, Math.max(0, options.strength ?? 0.22))
  if (strength <= 0) return ensureVertexColors(geometry)
  return paintVertexColors(geometry, (context, out) => {
    const sky = context.normalY * 0.5 + 0.5
    out.multiplyScalar(1 - strength * (1 - sky))
  })
}

export interface OutlineNormalOptions {
  /** Welding grid size. Vertices closer than this share an averaged normal. */
  precision?: number
}

/**
 * Welds normals by position and stores them in an `outlineNormal` attribute.
 *
 * Inverted-hull outlines extrude along the vertex normal. On a merged, hard-edged
 * prop the shading normals at a corner point in three different directions, so the
 * hull splits open along every sharp edge. Averaging by position closes it, while
 * the shading normals stay faceted for the surface itself.
 */
export function bakeOutlineNormals(
  geometry: THREE.BufferGeometry,
  options: OutlineNormalOptions = {},
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position')
  if (!position) return geometry
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  const normal = geometry.getAttribute('normal')

  const precision = Math.max(1e-5, options.precision ?? 1e-3)
  const inverse = 1 / precision
  const buckets = new Map<string, { x: number; y: number; z: number }>()
  const keys: string[] = new Array<string>(position.count)

  for (let index = 0; index < position.count; index += 1) {
    const key = `${String(Math.round(position.getX(index) * inverse))}|${String(
      Math.round(position.getY(index) * inverse),
    )}|${String(Math.round(position.getZ(index) * inverse))}`
    keys[index] = key
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.x += normal.getX(index)
      bucket.y += normal.getY(index)
      bucket.z += normal.getZ(index)
    } else {
      buckets.set(key, {
        x: normal.getX(index),
        y: normal.getY(index),
        z: normal.getZ(index),
      })
    }
  }

  const values = new Float32Array(position.count * 3)
  for (let index = 0; index < position.count; index += 1) {
    const bucket = buckets.get(keys[index])
    let x = bucket ? bucket.x : normal.getX(index)
    let y = bucket ? bucket.y : normal.getY(index)
    let z = bucket ? bucket.z : normal.getZ(index)
    let length = Math.hypot(x, y, z)
    if (length < 1e-8) {
      x = normal.getX(index)
      y = normal.getY(index)
      z = normal.getZ(index)
      length = Math.hypot(x, y, z) || 1
    }
    values[index * 3] = x / length
    values[index * 3 + 1] = y / length
    values[index * 3 + 2] = z / length
  }
  geometry.setAttribute(
    OUTLINE_NORMAL_ATTRIBUTE,
    new THREE.Float32BufferAttribute(values, 3),
  )
  return geometry
}

/** True when a geometry carries welded outline normals. */
export function hasOutlineNormals(geometry: THREE.BufferGeometry): boolean {
  return geometry.getAttribute(OUTLINE_NORMAL_ATTRIBUTE) !== undefined
}
