import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import { createElement, createRef, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { GameplayPointerCaptures, keepDisclosureKeyLocal } from '../src/game/input/CombatInput.ts'
import { COMPACT_HUD_COPY } from '../src/game/content/gameCopy.ts'
import { buildInitialGameView } from '../src/game/world/CampaignView.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import {
  DEFAULT_VISUAL_PREFERENCES, loadVisualPreferences, saveVisualPreferences,
  visualPreferenceApplication, type HudMode,
} from '../src/game/visualSettings.ts'
import { closeTopGameOverlay, initialGameOverlayState, topGameOverlay } from '../src/game/ui/gameOverlay.ts'

// Use the existing TypeScript compiler and React server renderer, not a second UI runner.
// Only CSS/asset loading is substituted; the complete production GameScreen is rendered.
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier)) {
      for (const extension of ['.ts', '.tsx']) {
        if (existsSync(new URL(`${specifier}${extension}`, context.parentURL))) {
          return nextResolve(`${specifier}${extension}`, context)
        }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }
    if (url.endsWith('.svg')) return { format: 'module', source: `export default ${JSON.stringify(url)}`, shortCircuit: true }
    if (url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        fileName: new URL(url).pathname,
      }).outputText,
    }
    return nextLoad(url, context)
  },
})
const { GameScreen } = await import('../src/App.tsx')
const { VisualSettingsControls } = await import('../src/game/ui/VisualSettingsControls.tsx')
loader.deregister()
const blueprint = generateWorld(20260906)
const noop = () => {}

function fixture(mode: HudMode, faction: 'elf' | 'guard' | 'villain' = 'guard'): ComponentProps<typeof GameScreen> {
  const view = buildInitialGameView({
    blueprint, config: { seed: blueprint.seed, generatorVersion: blueprint.generatorVersion, faction, selectedBoonId: 'provisions' },
    restored: undefined,
  })
  view.health = 73
  view.stamina = 51
  view.prompt = '[E] Действие у маяка'
  view.contracts = [0, 1].map((index) => ({
    ...view.contracts[0], id: `test-contract-${index}`, title: `Выбор ${index + 1}`,
    task: `Задание ${index + 1}`, stake: `Цена решения ${index + 1}`,
    pinned: index === 0, exclusive: true, timeRemaining: index === 0 ? 12.2 : 42,
  }))
  view.rumours = [{
    id: 'rumour-test', kind: 'defend', title: 'Слух с часами', task: 'Защити дом',
    stake: 'Иначе дом сгорит', regionLabel: 'B2', timeRemaining: 8.1, pinned: true, progress: 0.5,
    x: 0, z: 0, outcome: null, outcomeText: null,
  }]
  view.finale = {
    profile: 'huntsmaster', encounterId: 'finale-test', bossId: 'boss-test',
    name: 'Противник', enemyFaction: 'guard', health: 300, maxHealth: 340, phase: 1,
    stage: 'telegraph', cue: 'Сейчас будет удар — уйди вбок', progress: 0.5, escortsAlive: 2,
  }
  return {
    view, worldRef: createRef(), notices: [
      { id: 1, message: 'Первый урок целиком', tone: 'info' },
      { id: 2, message: 'Награда целиком', tone: 'success' },
      { id: 3, message: 'Предупреждение целиком', tone: 'warning' },
      { id: 4, message: 'Опасность целиком', tone: 'danger' },
    ],
    achievementBanner: null, runAchievements: [], activeOverlay: null, simulationPaused: false,
    touchCaptures: new GameplayPointerCaptures(), endResult: null, terminalRun: null,
    onResume: noop, onPause: noop, onSave: noop, onAchievements: noop, onMenu: noop,
    onBuy: noop, onCloseShop: noop, onOpenAtlas: noop, onCloseAtlas: noop, onSelectExpedition: noop,
    onExpeditionPreference: noop, onAttack: noop, onEvade: noop, onAbilityDown: noop, onAbilityUp: noop,
    onInteract: noop, onCommand: noop, onOpenSquadCommand: noop, onCloseSquadCommand: noop,
    onIssueSquadCommand: () => false, onPinRumour: noop, onPinObjective: noop, onTakeDoctrine: noop,
    onPointerLock: noop, onInput: noop, onRetryFinalization: noop, onRestart: noop,
    musicMuted: false, sfxVolume: 0.5, dynamicDayNight: true, weatherEnabled: true,
    bloomEnabled: false, inkOutlinesEnabled: false, foliageQuality: 'low', screenShakeEnabled: false,
    visualPreferences: { ...DEFAULT_VISUAL_PREFERENCES, hudMode: mode },
    activeVisualPolicy: resolveVisualPolicy({ bloomEnabled: false }),
    visualPreferencesError: false, onVisualPreferencesChange: noop,
    onToggleMusic: noop, onSfxVolumeChange: noop, onToggleDynamicDayNight: noop,
    onToggleWeather: noop, onToggleBloom: noop, onToggleInkOutlines: noop,
    onCycleFoliageQuality: noop, onToggleScreenShake: noop,
  }
}

test('production HUD retains essential combat/navigation/interaction and every notice outside compact disclosures for all factions', () => {
  for (const faction of ['elf', 'guard', 'villain'] as const) {
    for (const mode of ['full', 'compact'] as const) {
      const props = fixture(mode, faction)
      const rendered = renderToStaticMarkup(createElement(GameScreen, props))
      assert.ok(rendered.includes(`data-hud="${mode}"`))
      const disclosures = [...rendered.matchAll(/<details class="compact-hud-disclosure">[\s\S]*?<\/details>/g)].map((match) => match[0])
      assert.equal(disclosures.length, mode === 'compact' ? 2 : 0)
      for (const disclosure of disclosures) {
        assert.doesNotMatch(disclosure, /vitals|combat-mastery-hud|squad-command-strip|expedition-compass|action-prompt|finale-hud|notice-stack/)
      }
      for (const essential of ['vitals', '73/100', '51/100', 'ability-chip', 'combat-mastery-hud',
        'squad-command-strip', 'expedition-compass', 'action-prompt', props.view.prompt, 'finale-hud', props.view.finale!.cue]) {
        assert.ok(rendered.includes(essential), `${mode}/${faction} lost ${essential}`)
      }
      for (const notice of props.notices) assert.ok(rendered.includes(notice.message))
      assert.equal((rendered.match(/class="notice (?:info|success|warning|danger)"/g) ?? []).length, 4)
      assert.ok(rendered.includes('aria-live="polite"'))
      assert.equal((rendered.match(/class="notice-stack"/g) ?? []).length, 1, 'one live notice region, not duplicate responsive copies')
      const side = rendered.slice(rendered.indexOf('class="top-hud-side"'), rendered.indexOf('class="left-hud"'))
      assert.equal(side.includes('class="notice-stack"'), mode === 'compact')
      if (mode === 'compact') {
        assert.ok(side.indexOf('class="notice-stack"') > side.indexOf('finale-hud'), 'finale cues retain priority above notices')
        assert.ok(side.indexOf('class="notice-stack"') < side.indexOf('compact-hud-disclosure'), 'notices are not buried below optional world news')
      }
      for (const entry of props.view.contracts) {
        assert.ok(rendered.includes(entry.task))
        assert.ok(rendered.includes(entry.stake))
      }
      assert.ok(rendered.includes('Иначе дом сгорит'))
      if (mode === 'compact') {
        const summary = disclosures.map((part) => part.slice(0, part.indexOf('</summary>'))).join('')
        assert.ok(summary.includes('Подряды на выбор'))
        assert.ok(summary.includes('13 с'))
        assert.ok(summary.includes('42 с'))
        assert.ok(summary.includes('9 с'))
      }
    }
  }
})

test('full remains the persisted default; changing only HUD mode is live and does not change engine policy', () => {
  const records = new Map<string, string>()
  const storage = { getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value) } }
  assert.equal(loadVisualPreferences(storage).hudMode, 'full')
  const policy = resolveVisualPolicy({ visualMode: 'enhanced', bloomEnabled: false, weatherEnabled: false })
  for (const hudMode of ['compact', 'full'] as const) {
    const preferences = { ...DEFAULT_VISUAL_PREFERENCES, visualMode: 'enhanced' as const, hudMode }
    assert.equal(saveVisualPreferences(storage, preferences), true)
    assert.deepEqual(loadVisualPreferences(storage), preferences)
    assert.equal(visualPreferenceApplication(preferences, policy.preferences), 'current')
    assert.equal(policy.post.enabled, false)
    assert.equal(policy.preferences.weatherEnabled, false)
    assert.equal('hudMode' in policy.preferences, false)
  }
})

test('real blocking overlays remain singular and inert with either presentation; closing a top owner retains underlying pause', () => {
  for (const mode of ['full', 'compact'] as const) {
    for (const owner of ['pause', 'atlas', 'orders', 'shop', 'end'] as const) {
      const props = { ...fixture(mode), activeOverlay: owner, simulationPaused: true,
        endResult: owner === 'end' ? 'defeat' as const : null }
      const html = renderToStaticMarkup(createElement(GameScreen, props))
      assert.match(html, /class="gameplay-layer" inert=""/)
      assert.equal((html.match(/role="dialog"/g) ?? []).length, 1, `${mode}/${owner}`)
    }
    const state = { ...initialGameOverlayState(), paused: true, achievementsOpen: true }
    assert.equal(topGameOverlay(closeTopGameOverlay(state)), 'pause')
    assert.equal(topGameOverlay(closeTopGameOverlay({ ...state, ended: true })), 'end')
  }
})

test('shared visual controls provide native labeled HUD choices and immediate-application copy', () => {
  for (const hudMode of ['full', 'compact'] as const) {
    const html = renderToStaticMarkup(createElement(VisualSettingsControls, {
      visualPreferences: { ...DEFAULT_VISUAL_PREFERENCES, hudMode },
      visualPreferencesError: false, onVisualPreferencesChange: noop,
    }))
    assert.ok(html.includes(COMPACT_HUD_COPY.setting))
    assert.ok(html.includes(COMPACT_HUD_COPY.settingHelp))
    assert.ok(html.includes(`value="${hudMode}" selected=""`))
    assert.match(html, /<label for="[^"]+-hud">/)
    assert.match(html, /<select id="[^"]+-hud" aria-describedby="[^"]+-hud-help">/)
  }
})

test('Space disclosure activation stays local while Escape and overlay shortcuts retain their owner', () => {
  for (const code of ['Space', 'Escape', 'KeyP', 'KeyM', 'KeyT', 'KeyF', 'Enter']) {
    let stopped = 0
    keepDisclosureKeyLocal({ code, stopPropagation: () => { stopped++ } })
    assert.equal(stopped, code === 'Space' ? 1 : 0)
  }
})

test('compact controls keep 44px targets, scalable wrapping and original safe-area regions rather than hiding content', () => {
  const css = readFileSync(new URL('../src/game/ui/compact-combat.css', import.meta.url), 'utf8')
  assert.match(css, /\.compact-hud-disclosure > summary\s*\{[^}]*min-height:\s*44px;/)
  assert.match(css, /overflow-wrap:\s*anywhere;/)
  assert.match(css, /\.compact-hud-details button\s*\{[^}]*min-height:\s*44px;/)
  assert.match(css, /\.compact-hud-details \.hud-card-header\s*\{[^}]*flex-wrap:\s*wrap;/)
  assert.match(css, /\.hud-card-header > \.zone-code\s*\{[^}]*flex-basis:\s*100%;/)
  assert.match(css, /prefers-reduced-motion:\s*reduce/)
  assert.doesNotMatch(css, /(?:vitals|combat-mastery|squad-command|action-prompt|finale-hud)[^{]*\{[^}]*display:\s*none/)
  assert.doesNotMatch(css, /font-size:\s*[\d.]+px|position:\s*(?:absolute|fixed)/)
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const change = app.slice(app.indexOf('const changeVisualPreferences ='), app.indexOf('const selectBoon ='))
  assert.doesNotMatch(change, /setPaused|setScreen|destroy|new GameEngine|applyGameOverlays/)
})
