import { useId } from 'react'
import {
  VISUAL_SETTINGS_COPY,
  HUD_MODE_LABELS,
  COMPACT_HUD_COPY,
} from '../content/gameCopy.ts'
import {
  normalizeVisualPreferences,
  type VisualPreferences,
} from '../visualSettings.ts'

export interface VisualPreferencesControlProps {
  visualPreferences: VisualPreferences
  visualPreferencesError: boolean
  onVisualPreferencesChange: (preferences: VisualPreferences) => void
}

export function VisualSettingsControls({
  visualPreferences,
  visualPreferencesError,
  onVisualPreferencesChange,
}: VisualPreferencesControlProps) {
  const id = useId()
  return (
    <fieldset className="visual-settings">
      <legend>{VISUAL_SETTINGS_COPY.title}</legend>
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
      {visualPreferencesError ? (
        <p className="visual-settings-warning" role="status">{VISUAL_SETTINGS_COPY.storageFailed}</p>
      ) : null}
    </fieldset>
  )
}
