import type { StorageLike, StorageWarning } from './run/storage.ts'

export type VisualMode = 'legacy' | 'enhanced'
export type VisualQuality = 'high' | 'balanced' | 'low'
export type FoliageQuality = 'off' | 'low' | 'high'
export type HudMode = 'full' | 'compact'

export interface VisualLaunchPreferences {
  readonly visualMode: VisualMode
  readonly visualQuality: VisualQuality
}

export interface VisualPreferences {
  readonly hudMode: HudMode
}

/** The visual subset of GameEngineSettings, not a second engine options object. */
export interface VisualSettings extends VisualLaunchPreferences {
  readonly dynamicDayNight: boolean
  readonly weatherEnabled: boolean
  readonly bloomEnabled: boolean
  readonly inkOutlinesEnabled: boolean
  readonly screenShakeEnabled: boolean
  readonly foliageQuality: FoliageQuality
}

export const VISUAL_PREFERENCES_KEY = 'korovany-visual-preferences'
export const VISUAL_PREFERENCES_VERSION = 2

export const DEFAULT_VISUAL_PREFERENCES: VisualPreferences = Object.freeze({
  hudMode: 'full',
})

export const DEFAULT_VISUAL_SETTINGS: VisualSettings = Object.freeze({
  visualMode: 'enhanced',
  visualQuality: 'high',
  dynamicDayNight: true,
  weatherEnabled: true,
  bloomEnabled: true,
  inkOutlinesEnabled: true,
  screenShakeEnabled: true,
  foliageQuality: 'high',
})

const warnVisualSettings: StorageWarning = (message, error) => {
  if (error === undefined) console.warn(message)
  else console.warn(message, error)
}

function isPreferenceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function preferenceRecord(
  value: unknown,
  onWarning: StorageWarning,
): Record<string, unknown> {
  if (value === undefined) return {}
  if (isPreferenceRecord(value)) return value
  onWarning('Korovany: invalid visual preferences ignored; an object was expected.')
  return {}
}

function enumPreference<T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
  field: string,
  onWarning: StorageWarning,
): T {
  if (value === undefined) return fallback
  for (const choice of choices) if (value === choice) return choice
  onWarning(`Korovany: invalid ${field} preference ignored.`)
  return fallback
}

function booleanPreference(
  value: unknown,
  fallback: boolean,
  field: string,
  onWarning: StorageWarning,
): boolean {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  onWarning(`Korovany: invalid ${field} preference ignored.`)
  return fallback
}

export function normalizeVisualPreferences(
  value: unknown,
  onWarning: StorageWarning = warnVisualSettings,
): VisualPreferences {
  const record = preferenceRecord(value, onWarning)
  return Object.freeze({
    hudMode: enumPreference(record.hudMode, ['full', 'compact'], 'full', 'hudMode', onWarning),
  })
}

export function normalizeVisualSettings(
  value: unknown,
  onWarning: StorageWarning = warnVisualSettings,
): VisualSettings {
  const record = preferenceRecord(value, onWarning)
  return Object.freeze({
    visualMode: enumPreference(
      record.visualMode, ['legacy', 'enhanced'], DEFAULT_VISUAL_SETTINGS.visualMode, 'visualMode', onWarning,
    ),
    visualQuality: enumPreference(
      record.visualQuality, ['high', 'balanced', 'low'], DEFAULT_VISUAL_SETTINGS.visualQuality, 'visualQuality', onWarning,
    ),
    dynamicDayNight: booleanPreference(record.dynamicDayNight, true, 'dynamicDayNight', onWarning),
    weatherEnabled: booleanPreference(record.weatherEnabled, true, 'weatherEnabled', onWarning),
    bloomEnabled: booleanPreference(record.bloomEnabled, true, 'bloomEnabled', onWarning),
    inkOutlinesEnabled: booleanPreference(record.inkOutlinesEnabled, true, 'inkOutlinesEnabled', onWarning),
    screenShakeEnabled: booleanPreference(record.screenShakeEnabled, true, 'screenShakeEnabled', onWarning),
    foliageQuality: enumPreference(
      record.foliageQuality, ['off', 'low', 'high'], 'high', 'foliageQuality', onWarning,
    ),
  })
}

export function loadVisualPreferences(
  storage: Pick<StorageLike, 'getItem'>,
  onWarning: StorageWarning = warnVisualSettings,
): VisualPreferences {
  let raw: string | null
  try {
    raw = storage.getItem(VISUAL_PREFERENCES_KEY)
  } catch (error) {
    onWarning('Korovany: visual preferences could not be read.', error)
    return DEFAULT_VISUAL_PREFERENCES
  }
  if (raw === null) return DEFAULT_VISUAL_PREFERENCES

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    onWarning('Korovany: malformed visual preferences ignored.', error)
    return DEFAULT_VISUAL_PREFERENCES
  }
  const record = preferenceRecord(value, onWarning)
  if (record.version !== 1 && record.version !== VISUAL_PREFERENCES_VERSION) {
    onWarning('Korovany: unsupported visual preferences version ignored.')
    return DEFAULT_VISUAL_PREFERENCES
  }
  return normalizeVisualPreferences(record, onWarning)
}

export function saveVisualPreferences(
  storage: Pick<StorageLike, 'setItem'>,
  preferences: VisualPreferences,
  onWarning: StorageWarning = warnVisualSettings,
): boolean {
  const normalized = normalizeVisualPreferences(preferences, onWarning)
  try {
    storage.setItem(
      VISUAL_PREFERENCES_KEY,
      JSON.stringify({ version: VISUAL_PREFERENCES_VERSION, ...normalized }),
    )
    return true
  } catch (error) {
    onWarning('Korovany: visual preferences could not be saved.', error)
    return false
  }
}

export function foliageQualityDensity(quality: FoliageQuality): number {
  return quality === 'off' ? 0 : quality === 'low' ? 0.55 : 1
}
