import * as THREE from 'three'
import { OUTLINE_NORMAL_ATTRIBUTE, hasOutlineNormals } from './GeometryKit.ts'
import {
  applyOutlineShader,
  applyStylizedShader,
  type OutlineSharedUniforms,
  type StylizedSharedUniforms,
} from './stylizedShader.ts'

/**
 * The one material family in the game.
 *
 * Before this existed, characters were `MeshToonMaterial` and the world was
 * `MeshStandardMaterial`: two lighting models sharing one camera, which is why a
 * screenshot read as two drawings stapled together. Everything lit now comes from
 * here, so the ramp, the rim, the ambient tint and the ink are decided once.
 *
 * Ownership is the other half of the job and it has exactly two answers:
 *
 * - `createMaterial()` hands back a **caller-owned** material. Whoever made it
 *   disposes it, normally through scene-traversal teardown.
 * - `acquireMaterial()` hands back a **library-owned** shared instance. Callers
 *   must never dispose it; `dispose()` here releases it exactly once.
 *
 * Anything the library owns is tagged `userData.artLibraryOwned`, on materials,
 * geometries and textures alike, so every teardown path in the codebase can use one
 * predicate instead of guessing.
 */

export type StylizedSurface =
  | 'cloth'
  | 'skin'
  | 'metal'
  | 'dark'
  | 'leather'
  | 'bark'
  | 'foliage'
  | 'stone'
  | 'ground'
  | 'water'
  | 'glow'

export type OutlineKind = 'player' | 'enemy' | 'interactable' | 'landmark'

export interface StylizedInkPalette {
  player: THREE.ColorRepresentation
  enemy: THREE.ColorRepresentation
  interactable: THREE.ColorRepresentation
  landmark: THREE.ColorRepresentation
}

export interface StylizedArtLibraryOptions {
  ink: StylizedInkPalette
  /** Rim colour. Normally the sky colour of the current day/night keyframe. */
  rimColor?: THREE.ColorRepresentation
  /** Ambient tint applied where a surface is unlit. */
  shadowTint?: THREE.ColorRepresentation
  /** Direct-light luminance that maps to the top of the ramp. */
  keyIntensity?: number
  /** World-space luminance wobble that keeps large flat surfaces from going dead. */
  paperStrength?: number
  /** View-space ink width per unit of depth. */
  outlineThickness?: number
  /** Four ramp stops in `[0, 1]`, dark to light. */
  ramp?: readonly [number, number, number, number]
}

export interface StylizedMaterialOptions {
  color: THREE.ColorRepresentation
  surface: StylizedSurface
  map?: THREE.Texture | null
  emissive?: THREE.ColorRepresentation
  emissiveIntensity?: number
  vertexColors?: boolean
  transparent?: boolean
  opacity?: number
  side?: THREE.Side
  flatShading?: boolean
  depthWrite?: boolean
  roughness?: number
  metalness?: number
  /** `0` disables banding for this surface, `1` is full comic. */
  bandStrength?: number
  rimStrength?: number
  name?: string
}

export interface OutlineOptions {
  /** Also shell `InstancedMesh` sources. Off by default. */
  instanced?: boolean
  /** Extra predicate on top of the standard eligibility rules. */
  include?: (mesh: THREE.Mesh) => boolean
}

export interface OutlineBinding {
  root: THREE.Object3D
  shells: THREE.Mesh[]
  kind: OutlineKind
}

export interface ContactShadowOptions {
  /** World radius of the ink pool. */
  radius?: number
  opacity?: number
  name?: string
}

interface SurfacePreset {
  roughness: number
  metalness: number
  bandStrength: number
  rimStrength: number
  rimPower: number
  flatShading: boolean
}

const ART_LIBRARY_OWNED = 'artLibraryOwned'
const OUTLINE_MARKER = 'comicOutline'
/**
 * The first stop is zero on purpose.
 *
 * The injection can only see the aggregate direct-light term, which already has the
 * shadow factor folded in. A non-zero floor would therefore lift every shadowed
 * fragment back to 30% of full key light and erase cast shadows entirely. Direct
 * light bands down to nothing and the hemisphere ambient carries the dark side,
 * which is also what makes the shadowed half read as a colour rather than as grey.
 */
const DEFAULT_RAMP: readonly [number, number, number, number] = [0, 0.42, 0.72, 1]

/**
 * Surface presets are tuning, not shader permutations: every one of them compiles
 * the same program. `surface` picks how metallic, how banded and how rimmed a thing
 * is, and nothing else.
 */
const SURFACE_PRESETS: Record<StylizedSurface, SurfacePreset> = {
  cloth: {
    roughness: 0.92,
    metalness: 0,
    bandStrength: 1,
    rimStrength: 0.34,
    rimPower: 2.6,
    flatShading: false,
  },
  skin: {
    roughness: 0.78,
    metalness: 0,
    bandStrength: 0.88,
    rimStrength: 0.42,
    rimPower: 2.2,
    flatShading: false,
  },
  metal: {
    roughness: 0.42,
    metalness: 0.35,
    bandStrength: 1,
    rimStrength: 0.62,
    rimPower: 3.2,
    flatShading: false,
  },
  dark: {
    roughness: 0.86,
    metalness: 0.08,
    bandStrength: 1,
    rimStrength: 0.46,
    rimPower: 2.8,
    flatShading: false,
  },
  leather: {
    roughness: 0.88,
    metalness: 0.04,
    bandStrength: 0.94,
    rimStrength: 0.3,
    rimPower: 2.6,
    flatShading: false,
  },
  bark: {
    roughness: 0.98,
    metalness: 0,
    bandStrength: 0.86,
    rimStrength: 0.24,
    rimPower: 2.4,
    flatShading: false,
  },
  foliage: {
    roughness: 0.95,
    metalness: 0,
    bandStrength: 0.78,
    rimStrength: 0.36,
    rimPower: 2,
    flatShading: false,
  },
  stone: {
    roughness: 0.94,
    metalness: 0.02,
    bandStrength: 0.9,
    rimStrength: 0.22,
    rimPower: 2.8,
    flatShading: false,
  },
  ground: {
    roughness: 1,
    metalness: 0,
    bandStrength: 0.62,
    rimStrength: 0,
    rimPower: 3,
    flatShading: false,
  },
  water: {
    roughness: 0.24,
    metalness: 0.06,
    bandStrength: 0.5,
    rimStrength: 0.5,
    rimPower: 2,
    flatShading: false,
  },
  glow: {
    roughness: 0.7,
    metalness: 0,
    bandStrength: 0.25,
    rimStrength: 0.15,
    rimPower: 2,
    flatShading: false,
  },
}

function createInkColor(value: THREE.ColorRepresentation): THREE.Color {
  const color = new THREE.Color(value)
  const hsl = { h: 0, s: 0, l: 0 }
  color.getHSL(hsl)
  color.setHSL(hsl.h, Math.min(0.55, hsl.s), Math.min(0.11, hsl.l))
  return color
}

/**
 * Turns a lighting colour into a *tint*.
 *
 * The ambient tint multiplies `indirectDiffuse`, so it has to sit around 1.0 or it
 * is not a tint at all — it is a dimmer. Feeding the hemisphere's ground colour
 * straight in (a genuinely dark palette value) would multiply the unlit half of
 * every surface by roughly 0.3 and crush it to black. Normalize to the brightest
 * channel, then pull most of the way back to white so only the hue survives.
 */
function writeShadowTint(source: THREE.Color, target: THREE.Color): THREE.Color {
  const peak = Math.max(source.r, source.g, source.b, 1e-4)
  const normalizedR = source.r / peak
  const normalizedG = source.g / peak
  const normalizedB = source.b / peak
  const keep = 0.42
  target.setRGB(
    1 - keep + normalizedR * keep,
    1 - keep + normalizedG * keep,
    1 - keep + normalizedB * keep,
  )
  return target
}

function isOpaqueMaterial(material: THREE.Material | THREE.Material[]): boolean {
  const materials = Array.isArray(material) ? material : [material]
  return (
    materials.length > 0 &&
    materials.every((entry) => !entry.transparent && entry.opacity >= 1)
  )
}

export class StylizedArtLibrary {
  private readonly rampTextureInternal: THREE.DataTexture
  private readonly sharedUniforms: StylizedSharedUniforms
  private readonly outlineUniforms: OutlineSharedUniforms
  private readonly inkColors: Record<OutlineKind, THREE.Color>
  private readonly outlineMaterials = new Map<string, THREE.MeshBasicMaterial>()
  private readonly sharedMaterials = new Map<string, THREE.MeshStandardMaterial>()
  private contactShadowGeometry: THREE.BufferGeometry | null = null
  private contactShadowMaterial: THREE.MeshBasicMaterial | null = null
  private contactShadowTexture: THREE.DataTexture | null = null
  private disposed = false

  constructor(options: StylizedArtLibraryOptions) {
    this.rampTextureInternal = createRampTexture(options.ramp ?? DEFAULT_RAMP)
    this.sharedUniforms = {
      uToonRamp: { value: this.rampTextureInternal },
      uBandReference: { value: options.keyIntensity ?? 2.65 },
      uRimColor: { value: new THREE.Color(options.rimColor ?? 0x9fc4e6) },
      uShadowTint: {
        value: writeShadowTint(
          new THREE.Color(options.shadowTint ?? 0x8fa6c4),
          new THREE.Color(),
        ),
      },
      uPaperStrength: { value: options.paperStrength ?? 0.05 },
    }
    this.outlineUniforms = {
      // Screen width of the ink works out to `thickness * height / (2 tan(fov/2))`
      // pixels — the depth term cancels — so this is a fixed fraction of the frame,
      // about 0.36% of its height, and it looks the same at 720p and at 4K.
      uOutlineThickness: { value: options.outlineThickness ?? 0.0042 },
      uOutlineMinDepth: { value: 2 },
      uOutlineMaxDepth: { value: 42 },
    }
    this.inkColors = {
      player: createInkColor(options.ink.player),
      enemy: createInkColor(options.ink.enemy),
      interactable: createInkColor(options.ink.interactable),
      landmark: createInkColor(options.ink.landmark),
    }
  }

  /** The shared four-band lighting ramp. Library-owned; never dispose it. */
  get rampTexture(): THREE.DataTexture {
    return this.rampTextureInternal
  }

  /** Count of shared materials handed out by {@link acquireMaterial}. */
  get sharedMaterialCount(): number {
    return this.sharedMaterials.size
  }

  /**
   * Keeps the look anchored to the current lighting.
   *
   * All stylized materials point at the same uniform objects, so this is one write
   * per frame regardless of how many materials exist — and it means the library
   * never has to hold a reference to a caller-owned material.
   */
  setLightingReference(reference: {
    keyIntensity?: number
    rimColor?: THREE.Color
    shadowTint?: THREE.Color
  }): void {
    if (reference.keyIntensity !== undefined) {
      this.sharedUniforms.uBandReference.value = Math.max(0.15, reference.keyIntensity)
    }
    if (reference.rimColor) this.sharedUniforms.uRimColor.value.copy(reference.rimColor)
    if (reference.shadowTint) {
      writeShadowTint(reference.shadowTint, this.sharedUniforms.uShadowTint.value)
    }
  }

  /** Creates a **caller-owned** stylized material. */
  createMaterial(options: StylizedMaterialOptions): THREE.MeshStandardMaterial {
    const preset = SURFACE_PRESETS[options.surface]
    const material = new THREE.MeshStandardMaterial({
      color: options.color,
      map: options.map ?? null,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 1,
      roughness: options.roughness ?? preset.roughness,
      metalness: options.metalness ?? preset.metalness,
      vertexColors: options.vertexColors === true,
      transparent: options.transparent === true,
      opacity: options.opacity ?? 1,
      side: options.side ?? THREE.FrontSide,
      flatShading: options.flatShading ?? preset.flatShading,
      depthWrite: options.depthWrite ?? true,
    })
    material.name = options.name ?? `stylized-${options.surface}`
    material.userData.stylizedSurface = options.surface
    applyStylizedShader(material, this.sharedUniforms, {
      bandStrength: options.bandStrength ?? preset.bandStrength,
      rimStrength: options.rimStrength ?? preset.rimStrength,
      rimPower: preset.rimPower,
    })
    return material
  }

  /**
   * Returns a **library-owned** shared material for the given key.
   *
   * Use this for anything drawn more than a handful of times. One material per mesh
   * is the fastest way to turn a streamed 5x5 world into a state-change storm.
   */
  acquireMaterial(
    key: string,
    options: StylizedMaterialOptions,
  ): THREE.MeshStandardMaterial {
    if (this.disposed) {
      throw new Error('Cannot acquire a material from a disposed art library')
    }
    const existing = this.sharedMaterials.get(key)
    if (existing) return existing
    const material = this.createMaterial({ ...options, name: options.name ?? key })
    material.userData[ART_LIBRARY_OWNED] = true
    this.sharedMaterials.set(key, material)
    return material
  }

  getOutlineMaterial(kind: OutlineKind, smooth: boolean): THREE.MeshBasicMaterial {
    const key = `${kind}:${smooth ? 'smooth' : 'flat'}`
    const existing = this.outlineMaterials.get(key)
    if (existing) return existing
    const material = new THREE.MeshBasicMaterial({
      color: this.inkColors[kind],
      side: THREE.BackSide,
      depthTest: true,
      // Writing depth is what stops a wall drawn later from painting over the ink
      // that sits outside its owner's silhouette.
      depthWrite: true,
      toneMapped: false,
      fog: true,
    })
    material.name = `ink-outline:${key}`
    material.userData[ART_LIBRARY_OWNED] = true
    applyOutlineShader(material, this.outlineUniforms, smooth)
    this.outlineMaterials.set(key, material)
    return material
  }

  /**
   * Shells every eligible opaque mesh under `root` with an inverted hull.
   *
   * Shells are parented to their source, so limb pivots, weapon swings and corpse
   * poses move their ink for free — no per-frame transform copy anywhere.
   */
  applyOutline(
    root: THREE.Object3D,
    kind: OutlineKind,
    options: OutlineOptions = {},
  ): OutlineBinding {
    const sources: THREE.Mesh[] = []
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      if (object instanceof THREE.InstancedMesh && options.instanced !== true) return
      if (object.userData[OUTLINE_MARKER] === true) return
      if (object.userData.noComicOutline === true) return
      if (object.name === 'faction-ring') return
      if (!isOpaqueMaterial(object.material)) return
      if (options.include && !options.include(object)) return
      sources.push(object)
    })

    const shells = sources.map((source) => {
      const smooth = hasOutlineNormals(source.geometry)
      const material = this.getOutlineMaterial(kind, smooth)
      const shell =
        source instanceof THREE.InstancedMesh
          ? createInstancedShell(source, material)
          : new THREE.Mesh(source.geometry, material)
      shell.name = `${source.name || 'mesh'}-ink`
      shell.castShadow = false
      shell.receiveShadow = false
      shell.frustumCulled = source.frustumCulled
      shell.renderOrder = source.renderOrder - 1
      shell.userData[OUTLINE_MARKER] = true
      source.add(shell)
      return shell
    })

    return { root, shells, kind }
  }

  /**
   * Detaches shells without touching shared resources.
   *
   * Instanced shells share `instanceMatrix` with their source, so calling
   * `InstancedMesh.dispose()` on one would free a buffer the source still draws
   * from. Removing them is the whole cleanup.
   */
  releaseOutline(binding: OutlineBinding): void {
    for (const shell of binding.shells) shell.removeFromParent()
    binding.shells.length = 0
  }

  /**
   * An ink pool that grounds an object.
   *
   * Shadow maps are tight, cheap and sometimes off; a soft dark ellipse under a
   * thing costs one shared geometry, one shared material and one 64x64 texture for
   * the entire game, and it is the difference between an actor standing on the
   * ground and an actor hovering a centimetre above it.
   */
  createContactShadow(options: ContactShadowOptions = {}): THREE.Mesh {
    if (this.disposed) {
      throw new Error('Cannot create a contact shadow from a disposed art library')
    }
    if (!this.contactShadowGeometry) {
      const geometry = new THREE.CircleGeometry(1, 18)
      geometry.rotateX(-Math.PI / 2)
      geometry.name = 'contact-shadow'
      geometry.userData[ART_LIBRARY_OWNED] = true
      this.contactShadowGeometry = geometry
    }
    if (!this.contactShadowMaterial) {
      const texture = createContactShadowTexture()
      texture.userData[ART_LIBRARY_OWNED] = true
      this.contactShadowTexture = texture
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: this.inkColors.player,
        transparent: true,
        opacity: options.opacity ?? 0.34,
        depthWrite: false,
        toneMapped: false,
        fog: true,
      })
      material.name = 'contact-shadow'
      material.userData[ART_LIBRARY_OWNED] = true
      material.userData.noComicOutline = true
      this.contactShadowMaterial = material
    }
    const mesh = new THREE.Mesh(this.contactShadowGeometry, this.contactShadowMaterial)
    mesh.name = options.name ?? 'contact-shadow'
    mesh.scale.setScalar(options.radius ?? 0.8)
    mesh.position.y = 0.02
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = 1
    mesh.userData.noComicOutline = true
    return mesh
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.rampTextureInternal.dispose()
    for (const material of this.outlineMaterials.values()) material.dispose()
    this.outlineMaterials.clear()
    for (const material of this.sharedMaterials.values()) material.dispose()
    this.sharedMaterials.clear()
    this.contactShadowGeometry?.dispose()
    this.contactShadowMaterial?.dispose()
    this.contactShadowTexture?.dispose()
    this.contactShadowGeometry = null
    this.contactShadowMaterial = null
    this.contactShadowTexture = null
  }

  /**
   * True for anything the library disposes itself.
   *
   * Scene-traversal teardown must skip these or a shared ramp gets freed while
   * another engine instance is still drawing with it.
   */
  static isLibraryOwned(
    resource: THREE.Material | THREE.BufferGeometry | THREE.Texture,
  ): boolean {
    return resource.userData[ART_LIBRARY_OWNED] === true
  }
}

function createInstancedShell(
  source: THREE.InstancedMesh,
  material: THREE.Material,
): THREE.InstancedMesh {
  const shell = new THREE.InstancedMesh(source.geometry, material, source.count)
  // Sharing the matrix buffer is what keeps an outlined forest at one extra draw
  // call. The shell must never be disposed: that would free the source's buffer.
  shell.instanceMatrix = source.instanceMatrix
  shell.count = source.count
  shell.instanceColor = null
  return shell
}

function createRampTexture(
  stops: readonly [number, number, number, number],
): THREE.DataTexture {
  const bytes = new Uint8Array(
    stops.map((stop) => Math.round(THREE.MathUtils.clamp(stop, 0, 1) * 255)),
  )
  const texture = new THREE.DataTexture(
    bytes,
    stops.length,
    1,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  )
  texture.name = 'stylized-band-ramp'
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  // The ramp is a lighting intensity curve, not a display colour.
  texture.colorSpace = THREE.NoColorSpace
  texture.userData[ART_LIBRARY_OWNED] = true
  texture.needsUpdate = true
  return texture
}

const CONTACT_SHADOW_SIZE = 64

function createContactShadowTexture(): THREE.DataTexture {
  const size = CONTACT_SHADOW_SIZE
  const pixels = new Uint8Array(size * size * 4)
  const center = (size - 1) / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4
      const distance = Math.hypot(x - center, y - center) / center
      const falloff = Math.max(0, 1 - distance)
      // Squared falloff with a soft shoulder: dense in the middle, gone by the rim.
      const alpha = falloff * falloff * (0.55 + 0.45 * falloff)
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = Math.round(THREE.MathUtils.clamp(alpha, 0, 1) * 255)
    }
  }
  const texture = new THREE.DataTexture(
    pixels,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.name = 'contact-shadow-falloff'
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export { OUTLINE_NORMAL_ATTRIBUTE }
