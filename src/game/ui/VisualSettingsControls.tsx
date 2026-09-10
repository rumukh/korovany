import { useId } from 'react'
import {
  VISUAL_MODE_LABELS,
  VISUAL_QUALITY_LABELS,
  VISUAL_SETTINGS_COPY,
  HUD_MODE_LABELS,
  COMPACT_HUD_COPY,
} from '../content/gameCopy.ts'
import { VISUAL_PREVIEW_AVAILABLE, type VisualQualityPolicy } from '../visualPolicy.ts'
import {
  normalizeVisualPreferences,
  visualPreferenceApplication,
  type VisualPreferences,
} from '../visualSettings.ts'

export interface VisualPreferencesControlProps {
  visualPreferences: VisualPreferences
  activeVisualPolicy?: VisualQualityPolicy | null
  visualPreferencesError: boolean
  onVisualPreferencesChange: (preferences: VisualPreferences) => void
}

export function VisualSettingsControls({
  visualPreferences,
  activeVisualPolicy = null,
  visualPreferencesError,
  onVisualPreferencesChange,
}: VisualPreferencesControlProps) {
  const id = useId()
  const application = visualPreferenceApplication(
    visualPreferences,
    activeVisualPolicy?.preferences ?? null,
  )
  const applicationCopy = application === 'reload-required'
    ? VISUAL_SETTINGS_COPY.reloadRequired
    : application === 'current' ? VISUAL_SETTINGS_COPY.current : VISUAL_SETTINGS_COPY.nextLaunch

  return (
    <fieldset className="visual-settings" aria-describedby={`${id}-application ${id}-preview`}>
      <legend>{VISUAL_SETTINGS_COPY.title}</legend>
      <label htmlFor={`${id}-mode`}>
        {VISUAL_SETTINGS_COPY.mode}
        <select
          id={`${id}-mode`}
          value={visualPreferences.visualMode}
          onChange={(event) => onVisualPreferencesChange(normalizeVisualPreferences({
            ...visualPreferences,
            visualMode: event.currentTarget.value,
          }))}
        >
          <option value="legacy">{VISUAL_MODE_LABELS.legacy}</option>
          <option value="enhanced">{VISUAL_MODE_LABELS.enhanced}</option>
        </select>
      </label>
      <label htmlFor={`${id}-quality`}>
        {VISUAL_SETTINGS_COPY.quality}
        <select
          id={`${id}-quality`}
          value={visualPreferences.visualQuality}
          onChange={(event) => onVisualPreferencesChange(normalizeVisualPreferences({
            ...visualPreferences,
            visualQuality: event.currentTarget.value,
          }))}
        >
          <option value="high">{VISUAL_QUALITY_LABELS.high}</option>
          <option value="balanced">{VISUAL_QUALITY_LABELS.balanced}</option>
          <option value="low">{VISUAL_QUALITY_LABELS.low}</option>
        </select>
      </label>
      <label htmlFor={`${id}-hud`}>
        {COMPACT_HUD_COPY.setting}
        <select id={`${id}-hud`} value={visualPreferences.hudMode} aria-describedby={`${id}-hud-help`}
          onChange={(event) => onVisualPreferencesChange(normalizeVisualPreferences({
            ...visualPreferences, hudMode: event.currentTarget.value,
          }))}>
          <option value="full">{HUD_MODE_LABELS.full}</option>
          <option value="compact">{HUD_MODE_LABELS.compact}</option>
        </select>
      </label>
      <p id={`${id}-hud-help`}>{COMPACT_HUD_COPY.settingHelp}</p>
      <p id={`${id}-application`} role="status">
        {activeVisualPolicy ? (
          <strong>
            {VISUAL_SETTINGS_COPY.active}: {VISUAL_MODE_LABELS[activeVisualPolicy.mode]}
            {activeVisualPolicy.mode === 'enhanced'
              ? `, ${VISUAL_QUALITY_LABELS[activeVisualPolicy.quality]}` : ''}.{' '}
          </strong>
        ) : null}
        {applicationCopy}
      </p>
      <p id={`${id}-preview`}>
        {VISUAL_PREVIEW_AVAILABLE ? VISUAL_SETTINGS_COPY.preview : VISUAL_SETTINGS_COPY.unavailable}
        {' '}
        {visualPreferences.visualMode === 'legacy'
          ? VISUAL_SETTINGS_COPY.legacyQuality
          : visualPreferences.visualQuality === 'low' ? VISUAL_SETTINGS_COPY.lowNoPost : ''}
      </p>
      {visualPreferencesError ? (
        <p className="visual-settings-warning" role="status">{VISUAL_SETTINGS_COPY.storageFailed}</p>
      ) : null}
    </fieldset>
  )
}
