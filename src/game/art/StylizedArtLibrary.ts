import * as THREE from 'three'
import { hasOutlineNormals } from './GeometryKit.ts'
import {
  applyOutlineShader,
  applyStylizedShader,
  hasStylizedShader,
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
 * Anything the library owns is marked with a module-private symbol, on materials,
 * geometries and textures alike, so every teardown path in the codebase can use one
 * predicate (`isLibraryOwned`) instead of guessing. Use `markLibraryOwned()` to hand
 * a caller-built resource over; the marker is deliberately not a `userData` key, so
 * cloning a shared resource cannot forge ownership.
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

export interface StylizedAdoptOptions {
  /** Surface preset whose banding, rim and roughness feel the material inherits. */
  surface?: StylizedSurface
  bandStrength?: number
  rimStrength?: number
}

export interface ContactShadowOptions {
  /** World radius of the ink pool. */
  radius?: number
  /** Shared per value, quantized to 1/100. Each distinct value is one material. */
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

/**
 * Ownership marker.
 *
 * A symbol on the resource, not a `userData` key: `Material.copy()` deep-clones
 * `userData` through JSON, so a string key would make every clone of a shared
 * material falsely claim library ownership — and the engine's teardown paths
 * skip disposing anything that claims it, leaking the clone forever.
 */
const ART_LIBRARY_OWNED = Symbol('artLibraryOwned')

type OwnableResource = THREE.Material | THREE.BufferGeometry | THREE.Texture

function markOwned(resource: OwnableResource): void {
  ;(resource as unknown as Record<symbol, boolean>)[ART_LIBRARY_OWNED] = true
}

const OUTLINE_MARKER = 'comicOutline'
/** Holds a shell's own instance buffer while it borrows its source's. */
const SHELL_OWN_MATRIX = 'comicOutlineOwnMatrix'
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
  private readonly contactShadowMaterials = new Map<string, THREE.MeshBasicMaterial>()
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
   * Every material this library will dispose: shared, outline and contact shadow.
   *
   * This is the quantity `ART_LIBRARY_MATERIALS` in `docs/08` bounds. It exists so
   * the budget is observable rather than merely asserted in prose — two sibling
   * sessions are adding surfaces against a frozen ceiling, and an unenforced budget
   * is one that has already drifted.
   */
  get libraryOwnedMaterialCount(): number {
    return (
      this.sharedMaterials.size +
      this.outlineMaterials.size +
      this.contactShadowMaterials.size
    )
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
    this.assertActive('create a material')
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
    markOwned(material)
    this.sharedMaterials.set(key, material)
    return material
  }

  /**
   * Applies the stylized look to a material the caller already built.
   *
   * For meshes constructed elsewhere in the engine that still have to band, catch
   * the rim and follow the shadow tint. **Ownership does not move** — the caller
   * disposes it, and `isLibraryOwned` stays false. Adopting twice is a no-op.
   *
   * This is also the repair path for a cloned material. `Material.clone()` copies
   * `userData` but not `onBeforeCompile`, so a clone of a stylized material
   * renders unstyled; passing it here reinstates the injection.
   */
  adoptMaterial(
    material: THREE.MeshStandardMaterial,
    options: StylizedAdoptOptions = {},
  ): THREE.MeshStandardMaterial {
    if (this.disposed) {
      throw new Error('Cannot adopt a material into a disposed art library')
    }
    // Keyed off the injection itself, not `userData.stylizedSurface`: a clone
    // inherits the marker through the userData copy while losing the shader, so
    // trusting userData here would refuse to repair exactly the case that needs it.
    if (hasStylizedShader(material)) return material
    const surface = options.surface ?? 'cloth'
    const preset = SURFACE_PRESETS[surface]
    material.userData.stylizedSurface = surface
    applyStylizedShader(material, this.sharedUniforms, {
      bandStrength: options.bandStrength ?? preset.bandStrength,
      rimStrength: options.rimStrength ?? preset.rimStrength,
      rimPower: preset.rimPower,
    })
    // A repaired clone already has a compiled program; force the recompile.
    material.needsUpdate = true
    return material
  }

  getOutlineMaterial(kind: OutlineKind, smooth: boolean): THREE.MeshBasicMaterial {
    // Without this guard a post-dispose call would repopulate the cleared map
    // with a fresh library-owned material, and the idempotent second `dispose()`
    // returns early — so that material would never be freed.
    this.assertActive('build an outline material')
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
    markOwned(material)
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
    this.assertActive('apply an outline')
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
      if (source instanceof THREE.InstancedMesh && shell instanceof THREE.InstancedMesh) {
        // `count` is mutable: density and LOD passes lower it at runtime. Tracking
        // it here rather than snapshotting means a shell can never draw instances
        // its source has hidden, and callers cannot forget to resync.
        shell.onBeforeRender = () => {
          shell.count = source.count
        }
      }
      source.add(shell)
      return shell
    })

    return { root, shells, kind }
  }

  /**
   * Detaches shells and releases the renderer state they own.
   *
   * Shells share `geometry`, `material` and (when instanced) `instanceMatrix` with
   * their source, so none of those are freed here — but an instanced shell still
   * holds a vertex array object of its own, and that has to go.
   */
  releaseOutline(binding: OutlineBinding): void {
    for (const shell of binding.shells) disposeShell(shell)
    binding.shells.length = 0
  }

  /**
   * An ink pool that grounds an object.
   *
   * Shadow maps are tight, cheap and sometimes off; a soft dark ellipse under a
   * thing costs one shared geometry and one shared 64x64 texture for the entire
   * game, and it is the difference between an actor standing on the ground and an
   * actor hovering a centimetre above it.
   *
   * Materials are shared per opacity, so asking for a lighter pool really gets one
   * — but every distinct opacity is another material against the library budget.
   * Quantized to 1/100 so near-identical requests still collapse onto one.
   */
  createContactShadow(options: ContactShadowOptions = {}): THREE.Mesh {
    if (this.disposed) {
      throw new Error('Cannot create a contact shadow from a disposed art library')
    }
    if (!this.contactShadowGeometry) {
      const geometry = new THREE.CircleGeometry(1, 18)
      geometry.rotateX(-Math.PI / 2)
      geometry.name = 'contact-shadow'
      markOwned(geometry)
      this.contactShadowGeometry = geometry
    }
    if (!this.contactShadowTexture) {
      const texture = createContactShadowTexture()
      markOwned(texture)
      this.contactShadowTexture = texture
    }
    const opacity = THREE.MathUtils.clamp(options.opacity ?? 0.34, 0, 1)
    const key = (Math.round(opacity * 100) / 100).toFixed(2)
    let material = this.contactShadowMaterials.get(key)
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        map: this.contactShadowTexture,
        color: this.inkColors.player,
        transparent: true,
        opacity: Number(key),
        depthWrite: false,
        toneMapped: false,
        fog: true,
      })
      material.name = `contact-shadow:${key}`
      markOwned(material)
      material.userData.noComicOutline = true
      this.contactShadowMaterials.set(key, material)
    }
    const mesh = new THREE.Mesh(this.contactShadowGeometry, material)
    mesh.name = options.name ?? 'contact-shadow'
    mesh.scale.setScalar(options.radius ?? 0.8)
    mesh.position.y = 0.02
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = 1
    mesh.userData.noComicOutline = true
    return mesh
  }

  /**
   * Disposal is terminal for every factory on this library.
   *
   * Producing a resource after `dispose()` would attach the disposed ramp
   * texture and, for the cached maps, re-add a library-owned material that the
   * idempotent second `dispose()` would never free.
   */
  private assertActive(action: string): void {
    if (this.disposed) {
      throw new Error(`Cannot ${action} on a disposed art library`)
    }
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
    for (const material of this.contactShadowMaterials.values()) material.dispose()
    this.contactShadowMaterials.clear()
    this.contactShadowTexture?.dispose()
    this.contactShadowGeometry = null
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
    return (resource as unknown as Record<symbol, boolean>)[ART_LIBRARY_OWNED] === true
  }

  /**
   * Transfers ownership of a caller-built resource to the library's teardown.
   *
   * Use this instead of writing the marker by hand: the marker is a module-private
   * symbol precisely so it cannot be forged, inherited by a clone, or drift.
   */
  static markLibraryOwned(
    resource: THREE.Material | THREE.BufferGeometry | THREE.Texture,
  ): void {
    markOwned(resource)
  }
}

function createInstancedShell(
  source: THREE.InstancedMesh,
  material: THREE.Material,
): THREE.InstancedMesh {
  // Allocated at one instance, not at the source's capacity. The shell never draws
  // from its own buffer — the next line replaces it with the source's, and that is
  // the one the renderer uploads and `count` indexes into. Sizing this to capacity
  // would identity-fill `capacity * 16` floats per shell per region load and throw
  // them away immediately, which on the streaming path is pure garbage.
  const shell = new THREE.InstancedMesh(source.geometry, material, 1)
  // Sharing the matrix buffer is what keeps an outlined forest at one extra draw
  // call. But three.js frees a per-`InstancedMesh` VAO only from the `dispose`
  // event, and that same handler removes `instanceMatrix` — which is now the
  // source's. So park the shell's own buffer here and swap it back before
  // disposing, and the VAO is released without touching the source. The parked
  // buffer was never uploaded, so removing it is a no-op rather than a free.
  shell.userData[SHELL_OWN_MATRIX] = shell.instanceMatrix
  shell.instanceMatrix = source.instanceMatrix
  shell.count = source.count
  shell.instanceColor = null
  return shell
}

/**
 * Frees a shell's renderer state without freeing anything it borrowed.
 *
 * Streamed regions build and drop these constantly; skipping this leaks one vertex
 * array object per shell per region load, for the lifetime of the page.
 */
function disposeShell(shell: THREE.Mesh): void {
  shell.removeFromParent()
  if (!(shell instanceof THREE.InstancedMesh)) return
  const own = shell.userData[SHELL_OWN_MATRIX] as THREE.InstancedBufferAttribute | undefined
  if (own) {
    shell.instanceMatrix = own
    delete shell.userData[SHELL_OWN_MATRIX]
  }
  shell.dispose()
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
  markOwned(texture)
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
