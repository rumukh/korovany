/**
 * W1-4 — the profile reward, explained where the player reads it.
 *
 * The «gold» hint promises that unspent gold comes back as profile coins. The archive now
 * pays it (`tests/runStorage.test.ts`); these tests render the production end screen and
 * shop with the real React server renderer and check that what they print is what the
 * archive paid. Only CSS and SVG loading is stubbed, as in `compactCombatHud.test.ts`.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import { createElement, createRef, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { GameplayPointerCaptures } from '../src/game/input/CombatInput.ts'
import { describePurseReward, describeRunRewardLines } from '../src/game/content/gameCopy.ts'
import {
  computePurseReward,
  computeRunCompletionReward,
  computeRunCompletionRewardBreakdown,
} from '../src/game/run/profile.ts'
import type { RunHistorySummary } from '../src/game/run/runTypes.ts'
import { DEFAULT_VISUAL_PREFERENCES } from '../src/game/visualSettings.ts'
import { buildInitialGameView } from '../src/game/world/CampaignView.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

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
const { GameScreen } = await import('../src/App.tsx')
loader.deregister()

const blueprint = generateWorld(20261006)
const noop = () => {}

function screen(overrides: Partial<ComponentProps<typeof GameScreen>> = {}): ComponentProps<typeof GameScreen> {
  const view = buildInitialGameView({
    blueprint,
    config: { seed: blueprint.seed, generatorVersion: blueprint.generatorVersion, faction: 'villain', selectedBoonId: 'provisions' },
    restored: undefined,
  })
  return {
    view, worldRef: createRef(), notices: [], achievementBanner: null, runAchievements: [],
    activeOverlay: null, simulationPaused: true, touchCaptures: new GameplayPointerCaptures(),
    endResult: null, terminalRun: null,
    onResume: noop, onPause: noop, onSave: noop, onAchievements: noop, onMenu: noop,
    onBuy: noop, onCloseShop: noop, onOpenAtlas: noop, onCloseAtlas: noop, onSelectExpedition: noop,
    onExpeditionPreference: noop, onAttack: noop, onEvade: noop, onAbilityDown: noop, onAbilityUp: noop,
    onBowAimDown: noop, onBowAimUp: noop,
    onInteract: noop, onCommand: noop, onOpenSquadCommand: noop, onCloseSquadCommand: noop,
    onIssueSquadCommand: () => false, onOpenJournal: noop, onCloseJournal: noop,
    onBridgeChoice: noop, onTrackBridge: noop,
    onPinRumour: noop, onPinObjective: noop, onTakeDoctrine: noop,
    onPointerLock: noop, onInput: noop, onRetryFinalization: noop, onRestart: noop,
    musicMuted: false, sfxVolume: 0.5, dynamicDayNight: true, weatherEnabled: true,
    bloomEnabled: false, inkOutlinesEnabled: false, foliageQuality: 'low', screenShakeEnabled: false,
    visualPreferences: DEFAULT_VISUAL_PREFERENCES,
    visualPreferencesError: false, onVisualPreferencesChange: noop,
    onToggleMusic: noop, onSfxVolumeChange: noop, onToggleDynamicDayNight: noop,
    onToggleWeather: noop, onToggleBloom: noop, onToggleInkOutlines: noop,
    onCycleFoliageQuality: noop, onToggleScreenShake: noop,
    ...overrides,
  }
}

/** The review's villain: died with 114 unspent gold. */
function summary(status: 'victory' | 'defeat', endingGold: number, paid?: number): RunHistorySummary {
  const base: RunHistorySummary = {
    runId: `reward-${status}-${String(endingGold)}`, status, seed: blueprint.seed,
    generatorVersion: blueprint.generatorVersion, faction: 'villain', selectedBoonId: 'provisions',
    startedAt: '2026-10-07T10:00:00.000Z', endedAt: '2026-10-07T10:02:04.000Z',
    kills: 9, objectivesCompleted: 4, endingGold, profileCurrencyEarned: 0,
    blueprintFingerprint: blueprint.fingerprint,
  }
  return { ...base, profileCurrencyEarned: paid ?? computeRunCompletionReward(base) }
}

function endScreen(run: RunHistorySummary): string {
  return renderToStaticMarkup(createElement(GameScreen, screen({
    activeOverlay: 'end', endResult: run.status === 'victory' ? 'victory' : 'defeat',
    terminalRun: {
      runId: run.runId, rewardGranted: run.profileCurrencyEarned, summary: run,
      profileCurrency: 140, finalizationPending: false,
    },
  })))
}

function receipt(html: string): { label: string; amount: number }[] {
  const list = html.match(/<dl class="terminal-reward-lines"[^>]*>([\s\S]*?)<\/dl>/)?.[1]
  if (!list) return []
  return [...list.matchAll(/<dt>([^<]*)<\/dt><dd>\+(\d+)<\/dd>/g)].map((match) => ({
    label: match[1].replace(/&quot;/g, '"'),
    amount: Number(match[2]),
  }))
}

test('the end screen itemises the profile reward, purse included, and the lines add up', () => {
  for (const status of ['defeat', 'victory'] as const) {
    const run = summary(status, 114)
    const html = endScreen(run)
    const lines = receipt(html)
    const expected = describeRunRewardLines(run, computeRunCompletionRewardBreakdown(run))
    assert.deepEqual(lines, expected.map(({ label, amount }) => ({ label, amount })))
    assert.equal(lines.length, 4)
    assert.equal(lines.reduce((total, line) => total + line.amount, 0), run.profileCurrencyEarned)
    assert.ok(html.includes(`<strong>+${String(run.profileCurrencyEarned)}</strong>`))
    const gold = lines.at(-1)!
    assert.equal(gold.amount, 11)
    assert.match(gold.label, /114/)
    assert.match(html, /aria-label="Из чего сложилась награда"/)
  }
  // The defeat receipt the review asked for: 12 + 2 + 16 + 11.
  assert.deepEqual(receipt(endScreen(summary('defeat', 114))).map((line) => line.amount), [12, 2, 16, 11])
})

test('a receipt that would not add up to what the archive paid is not printed', () => {
  // Negative control: a run archived before W1-4 paid no purse. Recomputing it today would
  // claim eleven coins it never received, so the screen keeps the bare total instead.
  const old = summary('defeat', 114, computeRunCompletionReward({
    status: 'defeat', kills: 9, objectivesCompleted: 4, endingGold: 0,
  }))
  const html = endScreen(old)
  assert.deepEqual(receipt(html), [])
  assert.doesNotMatch(html, /terminal-reward-lines/)
  assert.ok(html.includes(`<strong>+${String(old.profileCurrencyEarned)}</strong>`))
  // And the matching summary does print one, so the absence above is the guard, not a typo.
  assert.equal(receipt(endScreen(summary('defeat', 114))).length, 4)
})

test('the gold line speaks the bounded rate at its edges', () => {
  const label = (endingGold: number) => receipt(endScreen(summary('victory', endingGold))).at(-1)!
  assert.deepEqual(label(0), { label: 'Кошелёк пуст: всё ушло торговцу, как в Daggerfall', amount: 0 })
  assert.deepEqual(label(7), { label: 'Золото — 7: на монету не наскрёб', amount: 0 })
  assert.deepEqual(label(114), { label: 'Золото — 114: монета за десяток', amount: 11 })
  assert.deepEqual(label(400), { label: 'Золото — 400: больше 15 из кошелька не вытрясти', amount: 15 })
})

test('the shop shows what the purse is worth if it is not spent', () => {
  for (const [gold, text] of [
    [5, 'Десяток не набрался: профилю пока ничего.'],
    [114, 'Доживёт до конца похода — +11 монет профиля.'],
    [21, 'Доживёт до конца похода — +2 монеты профиля.'],
    [400, 'Доживёт до конца похода — +15 монет профиля, больше не дают.'],
  ] as const) {
    const props = screen({ activeOverlay: 'shop' })
    props.view.gold = gold
    const html = renderToStaticMarkup(createElement(GameScreen, props))
    assert.equal(describePurseReward(computePurseReward(gold)), text)
    assert.ok(html.includes(`<small class="shop-purse-reward">${text}</small>`), `${String(gold)}: ${text}`)
  }
})
