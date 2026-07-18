import * as THREE from 'three'

export type ComicSurface = 'cloth' | 'skin' | 'metal' | 'dark'
export type OutlineKind = 'player' | 'enemy' | 'interactable'

export interface ComicMaterialOptions {
  color: THREE.ColorRepresentation
  surface: ComicSurface
  map?: THREE.Texture | null
  emissive?: THREE.ColorRepresentation
  emissiveIntensity?: number
}

export interface OutlineBinding {
  root: THREE.Object3D
  shells: THREE.Mesh[]
  kind: OutlineKind
}

export interface ComicOutlinePalette {
  player: THREE.ColorRepresentation
  enemy: THREE.ColorRepresentation
  interactable: THREE.ColorRepresentation
}

const OUTLINE_CHARACTER_SCALE = 1.045
const OUTLINE_INTERACTABLE_SCALE = 1.035
const COMIC_LIBRARY_OWNED = 'comicLibraryOwned'

function createInkColor(value: THREE.ColorRepresentation): THREE.Color {
  const color = new THREE.Color(value)
  const hsl = { h: 0, s: 0, l: 0 }
  color.getHSL(hsl)
  color.setHSL(hsl.h, Math.min(0.55, hsl.s), Math.min(0.11, hsl.l))
  return color
}

function isOpaqueMaterial(
  material: THREE.Material | THREE.Material[],
): material is THREE.Material | THREE.Material[] {
  const materials = Array.isArray(material) ? material : [material]
  return materials.length > 0 && materials.every((entry) => !entry.transparent && entry.opacity >= 1)
}

export class ComicMaterialLibrary {
  private readonly gradientMap: THREE.DataTexture
  private readonly outlineMaterials: Record<OutlineKind, THREE.MeshBasicMaterial>
  private disposed = false

  constructor(palette: ComicOutlinePalette) {
    this.gradientMap = new THREE.DataTexture(
      new Uint8Array([71, 133, 199, 255]),
      4,
      1,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    )
    this.gradientMap.name = 'comic-four-band-ramp'
    this.gradientMap.minFilter = THREE.NearestFilter
    this.gradientMap.magFilter = THREE.NearestFilter
    this.gradientMap.generateMipmaps = false
    this.gradientMap.colorSpace = THREE.NoColorSpace
    this.gradientMap.needsUpdate = true

    this.outlineMaterials = {
      player: this.createOutlineMaterial(palette.player),
      enemy: this.createOutlineMaterial(palette.enemy),
      interactable: this.createOutlineMaterial(palette.interactable),
    }
  }

  createToonMaterial(options: ComicMaterialOptions): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({
      color: options.color,
      gradientMap: this.gradientMap,
      map: options.map ?? null,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 1,
    })
  }

  getOutlineMaterial(kind: OutlineKind): THREE.MeshBasicMaterial {
    return this.outlineMaterials[kind]
  }

  applyOutline(root: THREE.Object3D, kind: OutlineKind): OutlineBinding {
    const sources: THREE.Mesh[] = []
    root.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) ||
        object instanceof THREE.InstancedMesh ||
        object.userData.comicOutline === true ||
        object.userData.noComicOutline === true ||
        object.name === 'faction-ring' ||
        !isOpaqueMaterial(object.material)
      ) {
        return
      }
      sources.push(object)
    })

    const scale = kind === 'interactable' ? OUTLINE_INTERACTABLE_SCALE : OUTLINE_CHARACTER_SCALE
    const shells = sources.map((source) => {
      const shell = new THREE.Mesh(source.geometry, this.getOutlineMaterial(kind))
      shell.name = `${source.name || 'mesh'}-comic-outline`
      shell.scale.setScalar(scale)
      shell.castShadow = false
      shell.receiveShadow = false
      shell.frustumCulled = source.frustumCulled
      shell.renderOrder = source.renderOrder - 1
      shell.userData.comicOutline = true
      source.add(shell)
      return shell
    })

    return { root, shells, kind }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.gradientMap.dispose()
    Object.values(this.outlineMaterials).forEach((material) => material.dispose())
  }

  static isLibraryOwned(material: THREE.Material): boolean {
    return material.userData[COMIC_LIBRARY_OWNED] === true
  }

  private createOutlineMaterial(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: createInkColor(color),
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    })
    material.userData[COMIC_LIBRARY_OWNED] = true
    return material
  }
}
