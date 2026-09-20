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
  onStart: noop, onContinueGenerated: noop, onAbandonGenerated: noop,
  onSeedInput: noop, onRandomSeed: noop, onSelectBoon: noop, onUnlockBoon: noop,
  onUnlockDoctrine: noop, onAchievements: noop, onToggleTheme: noop,
  onToggleDynamicDayNight: noop, onToggleWeather: noop, onToggleBloom: noop,
  onToggleInkOutlines: noop, onCycleFoliageQuality: noop, onToggleScreenShake: noop,
  onSfxVolumeChange: noop,
}

test('all three faction launch actions render before optional run configuration', () => {
  const html = renderToStaticMarkup(createElement(MenuScreen, menuProps))
  const setup = html.indexOf('class="run-options"')
  assert.ok(setup > 0)
  for (const label of Object.values(FACTION_INFO).map((faction) => `Играть: ${faction.shortName}`)) {
    const action = html.indexOf(label)
    assert.ok(action > 0 && action < setup, `${label} must precede seed/boon setup`)
  }
  assert.match(html, /<details class="menu-preferences">/)
  assert.match(html, /<details class="run-options">/)
  assert.doesNotMatch(html, /<details[^>]*\bopen[=\s>]/)
  assert.match(html, /id="world-seed"/)
  assert.match(html, /Громкость эффектов/)
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
  onInteract: noop, onCommand: noop, onOpenSquadCommand: noop, onCloseSquadCommand: noop,
  onIssueSquadCommand: () => true, onOpenJournal: noop, onCloseJournal: noop,
  onBridgeChoice: noop, onTrackBridge: noop, onPinRumour: noop, onPinObjective: noop, onTakeDoctrine: noop,
  onPointerLock: noop, onInput: noop, onRetryFinalization: noop, onRestart: noop,
  musicMuted: true, sfxVolume: 0.8, dynamicDayNight: true, weatherEnabled: true,
  bloomEnabled: true, inkOutlinesEnabled: true, foliageQuality: 'high', screenShakeEnabled: true,
  onToggleMusic: noop, onSfxVolumeChange: noop, onToggleDynamicDayNight: noop,
  onToggleWeather: noop, onToggleBloom: noop, onToggleInkOutlines: noop,
  onCycleFoliageQuality: noop, onToggleScreenShake: noop,
}

test('normal gameplay leaves full objectives and chronicle in the paused journal', () => {
  const playing = renderToStaticMarkup(createElement(GameScreen, gameProps))
  assert.match(playing, /class="game-screen focused-hud/)
  assert.match(playing, /aria-label="Журнал похода"/)
  assert.doesNotMatch(playing, /class="objective-list"/)
  assert.doesNotMatch(playing, /aria-label="Хроника мира"/)
  const planning = renderToStaticMarkup(createElement(GameScreen, {
    ...gameProps, activeOverlay: 'journal', simulationPaused: true,
  }))
  assert.match(planning, /role="dialog" aria-modal="true" aria-labelledby="journal-title"/)
  assert.match(planning, /class="objective-list"/)
  assert.match(planning, /aria-label="Хроника мира"/)
  assert.match(planning, /class="gameplay-layer" inert=""/)
})
