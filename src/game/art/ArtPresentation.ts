import * as THREE from 'three'

export const ART_SURFACE_ATTRIBUTE = 'artSurfaceResponse'
export const ART_WEATHER_ATTRIBUTE = 'artWeatherResponse'
export const ART_WIND_ATTRIBUTE = 'artWind'
export const ART_WATER_ATTRIBUTE = 'artWater'
export const ART_VISIBILITY_ATTRIBUTE = 'artVisibility'
export const ART_SHADOW_ATTRIBUTE = 'artShadowParticipation'

export interface ArtAttributeLayout {
  readonly surfaceResponse?: boolean
  readonly weatherResponse?: boolean
  readonly wind?: boolean
  readonly water?: boolean
  readonly visibility?: boolean
}

export type ArtMapping = 'uv' | 'world-xz' | 'world-triplanar'

export interface StylizedAtmosphere {
  readonly color: THREE.Color
  readonly nearDepth: number
  readonly midDepth: number
  readonly farDepth: number
  readonly midOpacity: number
  readonly farOpacity: number
  readonly baseHeight: number
  readonly heightFalloff: number
  readonly heightInfluence: number
}

export interface StylizedPresentationEnvironment {
  readonly timeSeconds: number
  readonly windX: number
  readonly windZ: number
  readonly windStrength: number
  readonly rain: number
  readonly snow: number
  readonly wetness: number
  readonly skyColor: THREE.Color
  readonly horizonColor: THREE.Color
  readonly atmosphere?: StylizedAtmosphere
}

export interface ArtShaderFeatures {
  readonly enhanced: boolean
  readonly attributes: ArtAttributeLayout
  readonly mapping: ArtMapping
  readonly metersPerRepeat: number
  readonly shadowParticipation?: boolean
}

export interface ArtEnvironmentUniforms {
  uArtTime: { value: number }
  uArtWind: { value: THREE.Vector3 }
  uArtSky: { value: THREE.Color }
  uArtHorizon: { value: THREE.Color }
  uArtWeather: { value: THREE.Vector3 }
  uArtAtmosphereEnabled: { value: number }
  uArtAtmosphereColor: { value: THREE.Color }
  uArtAtmosphereDepth: { value: THREE.Vector4 }
  uArtAtmosphereHeight: { value: THREE.Vector4 }
}

const MATERIAL_FEATURES = new WeakMap<THREE.Material, ArtShaderFeatures>()

export function setArtMaterialFeatures(material: THREE.Material, features: ArtShaderFeatures): void {
  MATERIAL_FEATURES.set(material, Object.freeze({
    ...features, attributes: Object.freeze({ ...features.attributes }),
  }))
  // WebGLBindingStates supports constant attributes on any material. Unbound
  // enhanced sources are fully visible; explicitly opted-in layouts are validated.
  Object.defineProperty(material, 'defaultAttributeValues', {
    value: { color: [1, 1, 1], uv: [0, 0], uv1: [0, 0], artVisibility: [1], artShadowParticipation: [1] },
    configurable: true,
  })
}

export function getArtMaterialFeatures(material: THREE.Material): ArtShaderFeatures | undefined {
  return MATERIAL_FEATURES.get(material)
}

/** Deformation is object-wide: rigid vertices in a wind layout have zero flex. */
export function validateArtDeformationLayout(source: THREE.Mesh): boolean {
  const materials = Array.isArray(source.material) ? source.material : [source.material]
  const wind = getArtMaterialFeatures(materials[0])?.attributes.wind === true
  if (materials.some((material) => (getArtMaterialFeatures(material)?.attributes.wind === true) !== wind)) {
    throw new Error('Art material slots must share one wind deformation layout; use zero flex for rigid vertices')
  }
  return wind
}

export function artShaderKey(features: ArtShaderFeatures): string {
  return [
    features.enhanced ? 'enhanced' : 'legacy', features.mapping,
    ...['surfaceResponse', 'weatherResponse', 'wind', 'water', 'visibility']
      .map((key) => features.attributes[key as keyof ArtAttributeLayout] ? key : ''),
    features.shadowParticipation ? 'shadow-mask' : '',
  ].join(':')
}

export function validateArtEnvironment(environment: StylizedPresentationEnvironment): void {
  const { timeSeconds, windX, windZ, windStrength, rain, snow, wetness, skyColor, horizonColor } = environment
  if (!Number.isFinite(timeSeconds) || !Number.isFinite(windX) || !Number.isFinite(windZ) ||
      !Number.isFinite(windStrength) || !unitValue(rain) || !unitValue(snow) || !unitValue(wetness) ||
      !finiteColor(skyColor) || !finiteColor(horizonColor) ||
      timeSeconds < 0 || windStrength < 0 || windStrength > 2 ||
      (Math.hypot(windX, windZ) > 1e-6 && Math.abs(Math.hypot(windX, windZ) - 1) > 1e-4)) {
    throw new RangeError('Invalid stylized presentation environment')
  }
  const atmosphere = environment.atmosphere
  if (atmosphere && (!finiteColor(atmosphere.color) ||
      !Number.isFinite(atmosphere.nearDepth) || !Number.isFinite(atmosphere.midDepth) ||
      !Number.isFinite(atmosphere.farDepth) || atmosphere.nearDepth < 0 ||
      atmosphere.midDepth <= atmosphere.nearDepth || atmosphere.farDepth <= atmosphere.midDepth ||
      !unitValue(atmosphere.midOpacity) || !unitValue(atmosphere.farOpacity) ||
      atmosphere.farOpacity < atmosphere.midOpacity || !Number.isFinite(atmosphere.baseHeight) ||
      !Number.isFinite(atmosphere.heightFalloff) || atmosphere.heightFalloff < 0 ||
      !unitValue(atmosphere.heightInfluence))) {
    throw new RangeError('Invalid stylized atmosphere profile')
  }
}

function unitValue(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function finiteColor(color: THREE.Color): boolean {
  return Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b) &&
    color.r >= 0 && color.g >= 0 && color.b >= 0
}

export function validateArtGeometry(
  source: THREE.Mesh,
  geometry: THREE.BufferGeometry = source.geometry,
): void {
  validateArtDeformationLayout(source)
  const position = geometry.getAttribute('position')
  if (!position || position.itemSize !== 3 || position.count === 0) throw new Error('Art geometry requires positions')
  const count = position.count
  const materials = Array.isArray(source.material) ? source.material : [source.material]
  const check = (name: string, size: number, minimum = -Infinity, maximum = Infinity, instanced = false): void => {
    const attribute = geometry.getAttribute(name)
    const expected = instanced && source instanceof THREE.InstancedMesh ? source.instanceMatrix.count : count
    if (!attribute || attribute.itemSize !== size || attribute.count !== expected ||
        (instanced && source instanceof THREE.InstancedMesh &&
          (!(attribute instanceof THREE.InstancedBufferAttribute) || attribute.meshPerAttribute !== 1))) {
      throw new Error(`Art attribute ${name} has an incompatible layout`)
    }
    for (let index = 0; index < attribute.count; index++) {
      for (let component = 0; component < size; component++) {
        const value = attribute.getComponent(index, component)
        if (!Number.isFinite(value) || value < minimum || value > maximum) {
          throw new RangeError(`Art attribute ${name} contains invalid data`)
        }
      }
    }
  }
  check('position', 3)
  check('normal', 3, -1.001, 1.001)
  if (geometry.hasAttribute('outlineNormal')) check('outlineNormal', 3, -1.001, 1.001)
  for (const material of materials) {
    const features = getArtMaterialFeatures(material)
    if (!features) throw new Error('Render-source binding requires a stylized material')
    if ('vertexColors' in material && material.vertexColors) check('color', 3, 0, 1)
    if ('map' in material && material.map && features.mapping === 'uv') check('uv', 2)
    const layout = features.attributes
    if (layout.surfaceResponse) check(ART_SURFACE_ATTRIBUTE, 4, 0, 1)
    if (layout.weatherResponse) {
      // Float32 attributes round decimal ceilings (notably 0.3) slightly upward.
      check(ART_WEATHER_ATTRIBUTE, 2, 0, Math.fround(0.3))
      const response = geometry.getAttribute(ART_WEATHER_ATTRIBUTE)
      for (let index = 0; index < count; index++) {
        if (response.getY(index) > Math.fround(0.22)) throw new RangeError('Art weather value response exceeds its bound')
      }
    }
    if (layout.wind) check(ART_WIND_ATTRIBUTE, 2, 0, 1)
    if (layout.water) {
      check(ART_WATER_ATTRIBUTE, 4)
      const water = geometry.getAttribute(ART_WATER_ATTRIBUTE)
      for (let index = 0; index < count; index++) {
        if (Math.abs(Math.hypot(water.getX(index), water.getY(index)) - 1) > 1e-4 ||
            water.getZ(index) < 0 || water.getZ(index) > 1 || water.getW(index) < 0) {
          throw new RangeError('Invalid art water flow, shoreline or depth')
        }
      }
    }
    if (layout.visibility || geometry.hasAttribute(ART_VISIBILITY_ATTRIBUTE)) {
      check(ART_VISIBILITY_ATTRIBUTE, 1, 0, 1, true)
    }
  }
  if (geometry.hasAttribute(ART_SHADOW_ATTRIBUTE)) check(ART_SHADOW_ATTRIBUTE, 1, 0, 1, true)
  if (source instanceof THREE.SkinnedMesh) {
    if (!source.skeleton) throw new Error('Skinned art source requires a bound skeleton')
    check('skinIndex', 4, 0, source.skeleton.bones.length - 1)
    check('skinWeight', 4, 0, 1)
    const indices = geometry.getAttribute('skinIndex')
    const weights = geometry.getAttribute('skinWeight')
    for (let index = 0; index < count; index++) {
      let total = 0
      for (let component = 0; component < 4; component++) {
        if (!Number.isInteger(indices.getComponent(index, component))) throw new Error('Skin indices must be integers')
        total += weights.getComponent(index, component)
      }
      if (Math.abs(total - 1) > 1e-4) throw new Error('Skin weights must be normalized')
    }
  }
  const index = geometry.getIndex()
  if (index) {
    for (let offset = 0; offset < index.count; offset++) {
      const vertex = index.getX(offset)
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= count) throw new Error('Art index is outside its vertex buffer')
    }
  }
}

export function artGeometryBytes(geometry: THREE.BufferGeometry): number {
  const arrays = new Set<ArrayBufferLike>()
  for (const attribute of Object.values(geometry.attributes)) arrays.add(attribute.array.buffer)
  if (geometry.index) arrays.add(geometry.index.array.buffer)
  return [...arrays].reduce((total, buffer) => total + buffer.byteLength, 0)
}
