import {
  foliageQualityDensity,
  normalizeVisualSettings,
  type VisualMode,
  type VisualQuality,
  type VisualSettings,
} from './visualSettings.ts'

// GFX-02 foundation is available only by explicit opt-in. This is neither
// default promotion nor approval of later art, atmosphere or device tiers.
export const VISUAL_PREVIEW_AVAILABLE: boolean = true
export const LEGACY_VISUAL_REVISION = 'legacy-f36ee7c'
export const ENHANCED_VISUAL_REVISION = 'illustrated-v1'

export interface VisualRenderPolicy {
  readonly scale: number
  readonly maxPixelRatio: number
  readonly maxPixels: number | null
}

export interface VisualPerformanceBudget {
  readonly provisional: true
  readonly frameTimeP95Ms: number
  readonly wholeFrameDrawCalls: number
  readonly mainViewTriangles: number
  readonly trackedGpuBytes: number
}

export interface VisualQualityPolicy {
  /** Requested settings, including independent effect-off preferences. */
  readonly preferences: VisualSettings
  readonly mode: VisualMode
  /** Ignored by the legacy path, but retained for the next enhanced launch. */
  readonly quality: VisualQuality
  readonly previewAvailable: boolean
  readonly revision: string
  readonly reducedMotion: boolean
  readonly cameraEffects: boolean
  readonly camera: {
    readonly collision: 'legacy-ray' | 'volume'
    readonly foregroundFade: boolean
  }
  readonly render: VisualRenderPolicy
  readonly post: {
    readonly enabled: boolean
    readonly bloom: boolean
    readonly grade: boolean
    readonly antialiasing: 'none' | 'fxaa'
  }
  readonly shadows: {
    readonly mapSize: 512 | 1024 | 2048
    readonly worldDistance: number
    readonly worldCasterBudget: number
    readonly worldInstanceBudget: number
    readonly worldTriangleBudget: number
  }
  readonly ink: {
    readonly enabled: boolean
    readonly minPixels: number
    readonly maxPixels: number
  }
  readonly lod: {
    readonly distanceScale: number
    readonly hysteresis: number
  }
  readonly density: {
    readonly foliage: number
    readonly weather: number
    readonly ambientLife: number
    readonly particles: number
  }
  readonly budget: VisualPerformanceBudget | null
}

export interface VisualPolicyEnvironment {
  readonly reducedMotion?: boolean
  /** Explicit integration/test capability, never inferred from a GPU or user agent. */
  readonly enhancedAvailable?: boolean
}

interface QualityTier {
  readonly render: VisualRenderPolicy
  readonly shadows: VisualQualityPolicy['shadows']
  readonly inkMinPixels: number
  readonly inkMaxPixels: number
  readonly lodDistanceScale: number
  readonly density: VisualQualityPolicy['density']
  readonly budget: VisualPerformanceBudget
}

const MIB = 1024 * 1024

// These are provisional ceilings from the approved plan, not measured device claims.
const QUALITY_TIERS: Readonly<Record<VisualQuality, QualityTier>> = {
  high: {
    render: { scale: 1, maxPixelRatio: 2, maxPixels: 2_100_000 },
    shadows: {
      mapSize: 2048, worldDistance: 40, worldCasterBudget: 16,
      worldInstanceBudget: 48, worldTriangleBudget: 60_000,
    },
    inkMinPixels: 0.75,
    inkMaxPixels: 1.5,
    lodDistanceScale: 1.1,
    density: { foliage: 1, weather: 1, ambientLife: 1, particles: 1 },
    budget: {
      provisional: true, frameTimeP95Ms: 16.7, wholeFrameDrawCalls: 700,
      mainViewTriangles: 600_000, trackedGpuBytes: 256 * MIB,
    },
  },
  balanced: {
    render: { scale: 1, maxPixelRatio: 1.5, maxPixels: 1_400_000 },
    shadows: {
      mapSize: 1024, worldDistance: 28, worldCasterBudget: 8,
      worldInstanceBudget: 24, worldTriangleBudget: 30_000,
    },
    inkMinPixels: 0.65,
    inkMaxPixels: 1.25,
    lodDistanceScale: 1,
    density: { foliage: 0.7, weather: 0.7, ambientLife: 0.7, particles: 0.7 },
    budget: {
      provisional: true, frameTimeP95Ms: 16.7, wholeFrameDrawCalls: 450,
      mainViewTriangles: 300_000, trackedGpuBytes: 192 * MIB,
    },
  },
  low: {
    render: { scale: 0.85, maxPixelRatio: 1, maxPixels: 900_000 },
    shadows: {
      mapSize: 512, worldDistance: 0, worldCasterBudget: 0,
      worldInstanceBudget: 0, worldTriangleBudget: 0,
    },
    inkMinPixels: 0.6,
    inkMaxPixels: 1,
    lodDistanceScale: 0.75,
    density: { foliage: 0.4, weather: 0.4, ambientLife: 0.4, particles: 0.4 },
    budget: {
      provisional: true, frameTimeP95Ms: 33.3, wholeFrameDrawCalls: 300,
      mainViewTriangles: 150_000, trackedGpuBytes: 128 * MIB,
    },
  },
}

export function resolveVisualPolicy(
  settings: Partial<VisualSettings>,
  environment: VisualPolicyEnvironment = {},
): VisualQualityPolicy {
  const preferences = normalizeVisualSettings(settings)
  const previewAvailable = environment.enhancedAvailable ?? VISUAL_PREVIEW_AVAILABLE
  const enhanced = previewAvailable && preferences.visualMode === 'enhanced'
  const tier = QUALITY_TIERS[preferences.visualQuality]
  const reducedMotion = environment.reducedMotion ?? false
  const postEnabled = preferences.bloomEnabled && (!enhanced || preferences.visualQuality !== 'low')
  const requestedFoliage = foliageQualityDensity(preferences.foliageQuality)

  return Object.freeze({
    preferences,
    mode: enhanced ? 'enhanced' : 'legacy',
    quality: preferences.visualQuality,
    previewAvailable,
    revision: enhanced ? ENHANCED_VISUAL_REVISION : LEGACY_VISUAL_REVISION,
    reducedMotion,
    cameraEffects: preferences.screenShakeEnabled && !reducedMotion,
    camera: Object.freeze({
      collision: enhanced ? 'volume' : 'legacy-ray',
      foregroundFade: enhanced,
    }),
    render: Object.freeze(enhanced
      ? { ...tier.render }
      : { scale: 1, maxPixelRatio: 1.75, maxPixels: null }),
    post: Object.freeze({
      enabled: postEnabled,
      bloom: postEnabled,
      grade: postEnabled,
      antialiasing: enhanced && postEnabled ? 'fxaa' : 'none',
    }),
    shadows: Object.freeze(enhanced ? { ...tier.shadows } : {
      mapSize: 2048, worldDistance: 0, worldCasterBudget: 0,
      worldInstanceBudget: 0, worldTriangleBudget: 0,
    }),
    ink: Object.freeze({
      enabled: preferences.inkOutlinesEnabled,
      minPixels: enhanced ? tier.inkMinPixels : 0,
      maxPixels: enhanced ? tier.inkMaxPixels : 0,
    }),
    lod: Object.freeze({
      distanceScale: enhanced ? tier.lodDistanceScale : 1,
      hysteresis: enhanced ? 0.15 : 0,
    }),
    density: Object.freeze({
      foliage: enhanced ? Math.min(requestedFoliage, tier.density.foliage) : requestedFoliage,
      weather: preferences.weatherEnabled ? enhanced ? tier.density.weather : 1 : 0,
      ambientLife: enhanced ? tier.density.ambientLife : 1,
      particles: enhanced ? Math.min(tier.density.particles, reducedMotion ? 0.5 : 1) : 1,
    }),
    budget: enhanced ? Object.freeze({ ...tier.budget }) : null,
  })
}

export interface VisualViewport {
  readonly cssWidth: number
  readonly cssHeight: number
  readonly devicePixelRatio: number
  readonly pixelRatio: number
  readonly drawingBufferWidth: number
  readonly drawingBufferHeight: number
}

/** Only the 3D buffer scales; callers retain CSS-sized layout and camera aspect. */
export function resolveVisualViewport(
  render: VisualRenderPolicy,
  width: number,
  height: number,
  devicePixelRatio: number,
): VisualViewport {
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0 ||
      !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0 ||
      !Number.isFinite(render.scale) || render.scale <= 0 ||
      !Number.isFinite(render.maxPixelRatio) || render.maxPixelRatio <= 0 ||
      (render.maxPixels !== null && (!Number.isFinite(render.maxPixels) || render.maxPixels < 1))) {
    throw new RangeError('Visual viewport dimensions and render policy must be finite and positive')
  }
  const cssWidth = Math.max(1, Math.floor(width))
  const cssHeight = Math.max(1, Math.floor(height))
  let pixelRatio = Math.min(devicePixelRatio, render.maxPixelRatio) * render.scale
  if (render.maxPixels !== null) {
    pixelRatio = Math.min(
      pixelRatio,
      Math.sqrt(render.maxPixels / cssWidth / cssHeight),
      render.maxPixels / Math.max(cssWidth, cssHeight),
    )
  }
  return Object.freeze({
    cssWidth,
    cssHeight,
    devicePixelRatio,
    pixelRatio,
    drawingBufferWidth: Math.max(1, Math.floor(cssWidth * pixelRatio)),
    drawingBufferHeight: Math.max(1, Math.floor(cssHeight * pixelRatio)),
  })
}
