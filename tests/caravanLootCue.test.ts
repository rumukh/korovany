/**
 * W1-2 — the HUD half of somebody else loading a caravan, rendered through the production
 * `GameScreen` the same way `compactCombatHud.test.ts` does it: real TSX, real copy, CSS
 * replaced by nothing.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import { createElement, createRef, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { GameplayPointerCaptures } from '../src/game/input/CombatInput.ts'
import { describeCaravanLootCue } from '../src/game/content/gameCopy.ts'
import { buildInitialGameView } from '../src/game/world/CampaignView.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { DEFAULT_VISUAL_PREFERENCES, type HudMode } from '../src/game/visualSettings.ts'
import type { CaravanLootView } from '../src/game/world/CaravanClaim.ts'

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
loader.deregister()

const blueprint = generateWorld(20261006)
const noop = () => {}

type ScreenProps = ComponentProps<typeof GameScreen>

function screen(mode: HudMode, prompt: string, caravanLoot: CaravanLootView | null): string {
  const view = buildInitialGameView({
    blueprint,
    config: { seed: blueprint.seed, generatorVersion: blueprint.generatorVersion, faction: 'elf', selectedBoonId: 'provisions' },
    restored: undefined,
  })
  assert.equal(view.caravanLoot, null, 'nobody loads a cart before the first frame')
  view.prompt = prompt
  view.caravanLoot = caravanLoot
  // Every callback is a no-op: a static render never calls one. The proxy keeps this file
  // about the cue rather than about every callback another feature adds to the screen.
  const props: Record<string, unknown> = {
    view, worldRef: createRef(), notices: [], runAchievements: [],
    activeOverlay: null, simulationPaused: false, touchCaptures: new GameplayPointerCaptures(),
    endResult: null, terminalRun: null, onIssueSquadCommand: () => false,
    musicMuted: false, sfxVolume: 0.5, dynamicDayNight: true, weatherEnabled: true,
    bloomEnabled: false, inkOutlinesEnabled: false, foliageQuality: 'low', screenShakeEnabled: false,
    visualPreferences: { ...DEFAULT_VISUAL_PREFERENCES, hudMode: mode }, visualPreferencesError: false,
  }
  return renderToStaticMarkup(createElement(GameScreen, new Proxy(props, {
    get: (target, key) => (key in target ? Reflect.get(target, key) : noop),
  }) as unknown as ScreenProps))
}

function actionPrompt(html: string): string | null {
  const start = html.indexOf('class="action-prompt')
  if (start < 0) return null
  const open = html.lastIndexOf('<div', start)
  let depth = 0
  for (let index = open; index < html.length; index += 1) {
    if (html.startsWith('<div', index)) depth += 1
    if (html.startsWith('</div>', index)) {
      depth -= 1
      if (depth === 0) return html.slice(open, index + 6)
    }
  }
  return null
}

test('the looting cue rides in the action prompt in both HUD modes, above any E prompt', () => {
  const cue: CaravanLootView = { progress: 0.4, looter: 'raider', defend: false, distance: 18 }
  for (const mode of ['full', 'compact'] as const) {
    const withPrompt = actionPrompt(screen(mode, '[E] ГРАБИТЬ КОРОВАН', cue))
    assert.ok(withPrompt, `${mode}: no action prompt`)
    assert.match(withPrompt, /class="action-prompt caravan-looting"/)
    assert.ok(withPrompt.includes(describeCaravanLootCue('raider', false)))
    assert.match(withPrompt, /role="meter"[^>]*aria-valuenow="40"/)
    assert.match(withPrompt, /scaleX\(0\.4\)/)
    assert.ok(withPrompt.includes('18 м'))
    assert.ok(withPrompt.indexOf('caravan-loot-cue') < withPrompt.indexOf('[E] ГРАБИТЬ КОРОВАН'),
      'the cue explains the race before the action that wins it')

    // Far from the cart there is no E to press, and the cue still has a lane of its own.
    const alone = actionPrompt(screen(mode, '', cue))
    assert.ok(alone, `${mode}: the cue vanished without a prompt`)
    assert.ok(alone.includes(describeCaravanLootCue('raider', false)))
    assert.doesNotMatch(alone, /action-prompt-text/)

    // Negative control: no channel, no cue — and an ordinary prompt renders as it always did.
    const plain = actionPrompt(screen(mode, '[E] Осмотреть: Лавка', null))
    assert.ok(plain)
    assert.doesNotMatch(plain, /caravan-loot|caravan-looting|role="meter"/)
    assert.ok(plain.includes('[E] Осмотреть: Лавка'))
    assert.equal(actionPrompt(screen(mode, '', null)), null)
  }
})

test('the cue names the looter and the side the player is on', () => {
  const lines = new Set<string>()
  for (const looter of ['raider', 'beast'] as const) {
    for (const defend of [false, true]) {
      const html = actionPrompt(screen('full', '', { progress: 1, looter, defend, distance: 3 }))
      assert.ok(html)
      const line = describeCaravanLootCue(looter, defend)
      assert.ok(html.includes(line))
      assert.match(html, /aria-valuenow="100"/)
      lines.add(line)
    }
  }
  assert.equal(lines.size, 4, 'each looter and side gets its own line')
  assert.ok(describeCaravanLootCue('raider', true).includes('сбей'))
  assert.ok(describeCaravanLootCue('raider', false).includes('успей'))
})
