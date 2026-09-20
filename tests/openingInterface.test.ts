import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { summarizeAchievements } from '../src/game/achievements.ts'
import { createDefaultProfile } from '../src/game/run/storage.ts'
import { FACTION_INFO } from '../src/game/types.ts'
import { buildInitialGameView } from '../src/game/world/CampaignView.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { GameplayPointerCaptures } from '../src/game/input/CombatInput.ts'
import { DEFAULT_VISUAL_PREFERENCES } from '../src/game/visualSettings.ts'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier) && context.parentURL) {
      for (const extension of ['.ts', '.tsx']) {
        if (existsSync(new URL(specifier + extension, context.parentURL))) {
          return nextResolve(specifier + extension, context)
        }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export {}' }
    if (url.endsWith('.svg')) {
      return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)}` }
    }
    if (url.endsWith('.tsx')) {
      return {
        format: 'module', shortCircuit: true,
        source: transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
        }).outputText,
      }
    }
    return nextLoad(url, context)
  },
})
const { MenuScreen, GameScreen } = await import('../src/App.tsx')
const { BridgeAmbushHud } = await import('../src/game/ui/BridgeAmbushHud.tsx')
loader.deregister()

const noop = () => {}
const menuProps: ComponentProps<typeof MenuScreen> = {
  activeRun: null, activeRunError: null, profile: createDefaultProfile(),
  seedInput: '7', canonicalSeed: 7, achievementSummary: summarizeAchievements([]),
  theme: 'dark', dynamicDayNight: true, weatherEnabled: true, bloomEnabled: true,
  inkOutlinesEnabled: true, foliageQuality: 'high', screenShakeEnabled: true, sfxVolume: 0.8,
  visualPreferences: DEFAULT_VISUAL_PREFERENCES, visualPreferencesError: false,
  onVisualPreferencesChange: noop,
  onStart: noop, onContinueGenerated: noop, onAbandonGenerated: noop,
  onSeedInput: noop, onRandomSeed: noop, onSelectBoon: noop, onUnlockBoon: noop,
  onUnlockDoctrine: noop, onAchievements: noop, onToggleTheme: noop,
  onToggleDynamicDayNight: noop, onToggleWeather: noop, onToggleBloom: noop,
  onToggleInkOutlines: noop, onCycleFoliageQuality: noop, onToggleScreenShake: noop,
  onSfxVolumeChange: noop,
}

test('all three faction launches precede run setup while settings stay at the bottom', () => {
  const html = renderToStaticMarkup(createElement(MenuScreen, menuProps))
  const launchStart = html.indexOf('class="faction-grid"')
  const setup = html.indexOf('class="run-setup"')
  const lower = html.indexOf('class="menu-lower"')
  const settings = html.indexOf('id="menu-settings-title"')
  assert.ok(launchStart > 0 && launchStart < setup)
  const launchMarkup = html.slice(launchStart, setup)
  assert.equal((launchMarkup.match(/Начать · seed 7/g) ?? []).length, 3)
  for (const faction of Object.values(FACTION_INFO)) {
    assert.match(launchMarkup, new RegExp(faction.name))
  }
  assert.ok(lower > setup && settings > lower)
  assert.doesNotMatch(html, /menu-preferences|run-options/)
  assert.match(html, /id="world-seed"/)
  assert.match(html, /Достижения \d+\/\d+/)
  assert.match(html, /Громкость эффектов/)
  assert.match(html, /Боевой интерфейс/)
})

const bridge: NonNullable<ComponentProps<typeof BridgeAmbushHud>['view']> = {
  phase: 'approach', title: 'Корован у моста', description: 'Обоз ждёт на переправе.',
  hint: 'Подойди по дороге.', distance: 85, bearing: 0.6,
  remainingEnemies: 3, totalEnemies: 3, cargoHealth: 100, cargoMaxHealth: 100,
  progress: 0, canChoose: false, outcome: null, consequence: null,
}
function bridgeMarkup(overrides: Partial<typeof bridge>, paused = false, inJournal = false): string {
  return renderToStaticMarkup(createElement(BridgeAmbushHud, {
    view: { ...bridge, ...overrides }, paused, inJournal, onChoose: noop, onSquad: noop, onTrack: noop,
  }))
}

test('bridge approach teaches squad staging without offering unearned cargo', () => {
  const html = bridgeMarkup({})
  assert.match(html, /К мосту/)
  assert.match(html, /Отряд/)
  assert.doesNotMatch(html, /Забрать груз/)
  assert.match(html, /85 м/)
})

test('an inactive bridge leaves the field compass alone but remains discoverable in the journal', () => {
  assert.equal(bridgeMarkup({ active: false }), '')
  const journal = bridgeMarkup({ active: false }, false, true)
  assert.match(journal, /К мосту/)
  assert.match(journal, /Обоз ждёт на переправе/)
})

test('bridge cargo decisions are disabled out of range and while paused', () => {
  for (const [canChoose, paused] of [[false, false], [true, true]] as const) {
    const html = bridgeMarkup({ phase: 'secured', canChoose }, paused)
    assert.equal((html.match(/<button[^>]*disabled=""/g) ?? []).length, 2)
  }
  const ready = bridgeMarkup({ phase: 'secured', canChoose: true })
  assert.doesNotMatch(ready, /disabled=/)
  assert.match(ready, /Забрать груз/)
  assert.match(ready, /Довести обоз/)
  const rewards = bridgeMarkup({
    phase: 'secured', canChoose: true,
    seizeDetail: '+85 золота; груз не попадёт в склады.',
    deliverDetail: '+2 пайка и снабжение региона C3.',
  })
  assert.match(rewards, /\+85 золота/)
  assert.match(rewards, /\+2 пайка и снабжение региона C3/)
})

test('bridge delivery and settled views report progress and consequences, not new rewards', () => {
  const delivering = bridgeMarkup({ phase: 'delivering', progress: 0.4 })
  assert.match(delivering, /<progress max="1" value="0.4"/)
  assert.doesNotMatch(delivering, /Забрать груз/)
  const resolved = bridgeMarkup({ phase: 'resolved', distance: 0, outcome: 'deliver', consequence: 'Посёлок получил припасы.' })
  assert.match(resolved, /Посёлок получил припасы/)
  assert.doesNotMatch(resolved, /<button/)
  assert.equal(bridgeMarkup({ phase: 'resolved', distance: 61 }), '')
})

const gameProps: ComponentProps<typeof GameScreen> = {
  view: buildInitialGameView({
    blueprint: generateWorld(7),
    config: { seed: 7, generatorVersion: 1, faction: 'elf', selectedBoonId: 'provisions' },
  }),
  worldRef: { current: null }, notices: [], achievementBanner: null, runAchievements: [],
  activeOverlay: null, simulationPaused: false, touchCaptures: new GameplayPointerCaptures(),
  endResult: null, terminalRun: null, onResume: noop, onPause: noop, onSave: noop,
  onAchievements: noop, onMenu: noop, onBuy: noop, onCloseShop: noop,
  onOpenAtlas: noop, onCloseAtlas: noop, onSelectExpedition: noop, onExpeditionPreference: noop,
  onAttack: noop, onEvade: noop, onAbilityDown: noop, onAbilityUp: noop,
  onBowAimDown: noop, onBowAimUp: noop,
  onInteract: noop, onCommand: noop, onOpenSquadCommand: noop, onCloseSquadCommand: noop,
  onIssueSquadCommand: () => true, onOpenJournal: noop, onCloseJournal: noop,
  onBridgeChoice: noop, onTrackBridge: noop, onPinRumour: noop, onPinObjective: noop, onTakeDoctrine: noop,
  onPointerLock: noop, onInput: noop, onRetryFinalization: noop, onRestart: noop,
  musicMuted: true, sfxVolume: 0.8, dynamicDayNight: true, weatherEnabled: true,
  bloomEnabled: true, inkOutlinesEnabled: true, foliageQuality: 'high', screenShakeEnabled: true,
  visualPreferences: { ...DEFAULT_VISUAL_PREFERENCES, hudMode: 'compact' },
  visualPreferencesError: false, onVisualPreferencesChange: noop,
  onToggleMusic: noop, onSfxVolumeChange: noop, onToggleDynamicDayNight: noop,
  onToggleWeather: noop, onToggleBloom: noop, onToggleInkOutlines: noop,
  onCycleFoliageQuality: noop, onToggleScreenShake: noop,
}

test('compact field HUD keeps journal access and the paused journal renders full campaign boards', () => {
  const playing = renderToStaticMarkup(createElement(GameScreen, gameProps))
  assert.match(playing, /class="game-screen faction-elf/)
  assert.match(playing, /data-hud="compact"/)
  assert.match(playing, /aria-label="Журнал похода"/)
  assert.equal((playing.match(/class="compact-hud-disclosure"/g) ?? []).length, 2)
  const planning = renderToStaticMarkup(createElement(GameScreen, {
    ...gameProps, activeOverlay: 'journal', simulationPaused: true,
  }))
  const journal = planning.slice(planning.indexOf('class="campaign-journal"'))
  assert.match(journal, /role="dialog" aria-modal="true" aria-labelledby="journal-title"/)
  assert.match(journal, /class="journal-missions"/)
  assert.match(journal, /class="objective-list"/)
  assert.match(journal, /aria-label="Хроника мира"/)
  assert.match(journal, /class="journal-world"/)
  assert.match(planning, /class="gameplay-layer" inert=""/)
})

test('bow hold and bridge actions keep dedicated engine callback contracts', () => {
  const gameScreen = appSource.slice(
    appSource.indexOf('export function GameScreen'),
    appSource.indexOf('function App()'),
  )
  assert.match(gameScreen, /onBowAimDown:\s*\(\) => void/)
  assert.match(gameScreen, /onBowAimUp:\s*\(\) => void/)
  assert.match(gameScreen, /const abilityDown = view\.ability\.id === 'bow' \? onBowAimDown : onAbilityDown/)
  assert.match(gameScreen, /const abilityUp = view\.ability\.id === 'bow' \? onBowAimUp : onAbilityUp/)

  const appWiring = appSource.slice(appSource.lastIndexOf('<GameScreen'))
  const genericAbility = appWiring.slice(
    appWiring.indexOf('onAbilityDown='),
    appWiring.indexOf('onBowAimDown='),
  )
  assert.doesNotMatch(genericAbility, /setBowAiming|faction === 'elf'/)
  assert.match(appWiring, /onBowAimDown=\{\(\) => engineRef\.current\?\.setBowAiming\(true, 'button'\)\}/)
  assert.match(appWiring, /onBowAimUp=\{\(\) => engineRef\.current\?\.setBowAiming\(false, 'button'\)\}/)
  assert.match(appWiring, /onBridgeChoice=\{\(choice\) => \{ engineRef\.current\?\.chooseBridgeAmbush\(choice\) \}\}/)
  assert.match(appWiring, /onTrackBridge=\{\(\) => \{ engineRef\.current\?\.trackBridgeAmbush\(\) \}\}/)
})
