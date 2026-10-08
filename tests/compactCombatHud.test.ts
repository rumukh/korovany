import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname, isAbsolute } from 'node:path'
import test from 'node:test'
import { createElement, createRef, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { GameplayPointerCaptures, keepDisclosureKeyLocal } from '../src/game/input/CombatInput.ts'
import { COMPACT_HUD_COPY, describeHint } from '../src/game/content/gameCopy.ts'
import { buildInitialGameView } from '../src/game/world/CampaignView.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import {
  DEFAULT_VISUAL_PREFERENCES, loadVisualPreferences, saveVisualPreferences,
  type HudMode,
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
      { id: 1, message: 'Первый урок целиком', tone: 'info', count: 1 },
      { id: 2, message: 'Награда целиком', tone: 'success', count: 1 },
      { id: 3, message: 'Предупреждение целиком', tone: 'warning', count: 1 },
      { id: 4, message: 'Опасность целиком', tone: 'danger', count: 1 },
    ],
    runAchievements: [], activeOverlay: null, simulationPaused: false,
    touchCaptures: new GameplayPointerCaptures(), endResult: null, terminalRun: null,
    onResume: noop, onPause: noop, onSave: noop, onAchievements: noop, onMenu: noop,
    onBuy: noop, onCloseShop: noop, onOpenAtlas: noop, onCloseAtlas: noop, onSelectExpedition: noop,
    onExpeditionPreference: noop, onAttack: noop, onEvade: noop, onAbilityDown: noop, onAbilityUp: noop,
    onBowAimDown: noop, onBowAimUp: noop,
    onInteract: noop, onCommand: noop, onOpenSquadCommand: noop, onCloseSquadCommand: noop,
    onIssueSquadCommand: () => false, onOpenJournal: noop, onCloseJournal: noop,
    onBeatChoice: noop, onTrackBeat: noop,
    onPinRumour: noop, onPinObjective: noop, onTakeDoctrine: noop,
    onPointerLock: noop, onInput: noop, onRetryFinalization: noop, onRestart: noop,
    musicMuted: false, sfxVolume: 0.5, dynamicDayNight: true, weatherEnabled: true,
    bloomEnabled: false, inkOutlinesEnabled: false, foliageQuality: 'low', screenShakeEnabled: false,
    visualPreferences: { ...DEFAULT_VISUAL_PREFERENCES, hudMode: mode },
    visualPreferencesError: false, onVisualPreferencesChange: noop,
    onToggleMusic: noop, onSfxVolumeChange: noop, onToggleDynamicDayNight: noop,
    onToggleWeather: noop, onToggleBloom: noop, onToggleInkOutlines: noop,
    onCycleFoliageQuality: noop, onToggleScreenShake: noop,
  }
}

/** The outer markup of the first `<div class="…">` with this class, by counting nested divs. */
function elementSlice(html: string, className: string): string {
  const start = html.indexOf(`<div class="${className}"`)
  assert.notEqual(start, -1, `Missing ${className}`)
  const tags = /<div\b|<\/div>/g
  tags.lastIndex = start
  let depth = 0
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    depth += match[0] === '</div>' ? -1 : 1
    if (depth === 0) return html.slice(start, match.index + match[0].length)
  }
  assert.fail(`Unclosed ${className}`)
}

if (process.env.GFX_NOTICE_COMPONENT_OUTPUT) {
  test('export the production HUD fixture for explicitly staged browser layout evidence', () => {
    const output = process.env.GFX_NOTICE_COMPONENT_OUTPUT!
    assert.ok(isAbsolute(output))
    const cases = (['compact', 'full'] as const).flatMap((mode) => [true, false].map((finale) => {
      const props = fixture(mode)
      if (!finale) props.view.finale = null
      props.notices = [{ id: 1, message: describeHint('perfectGuard').text, tone: describeHint('perfectGuard').tone, count: 1 }]
      // W3-6 — the lane depends on the layout, so each case carries the markup for both.
      return { id: `${mode}-${finale ? 'finale' : 'ordinary'}`, mode, finale,
        markup: renderToStaticMarkup(createElement(GameScreen, props)),
        narrowMarkup: renderToStaticMarkup(createElement(GameScreen, { ...props, columnLane: true })) }
    }))
    writeFileSync(output, JSON.stringify({
      kind: 'production-hud-component-layout-v2',
      limitation: 'STAGED COMPONENT LAYOUT: real GameScreen/FinaleHud markup and notice copy, not engine boss gameplay or a native notice trigger.',
      cases,
    }, null, 2), { flag: 'wx' })
  })
}

test('bow HUD separates aim availability from shot readiness in both HUD modes', () => {
  for (const mode of ['full', 'compact'] as const) for (const aiming of [false, true]) {
    const props = fixture(mode, 'elf')
    props.view.ability.active = aiming
    props.view.ability.ready = false
    props.view.ability.aimAvailable = true
    props.view.ability.cooldown = 0.5
    const html = renderToStaticMarkup(createElement(GameScreen, props))
    const ability = html.match(/<button[^>]*aria-label="Лук: удерживать для прицеливания"[^>]*>/)?.[0]
    assert.ok(ability)
    assert.doesNotMatch(ability, /disabled/)
    assert.match(ability, new RegExp(`aria-pressed="${aiming}"`))
    if (aiming) {
      assert.match(html, /crosshair bow-aim reloading/)
      assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Выстрел из лука"/)
      assert.match(html, /Перезарядка: 0.5 с/)
      assert.doesNotMatch(html, /<small>ЛКМ — выстрел<\/small>/)
    } else assert.doesNotMatch(html, /crosshair bow-aim/)
  }
})

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
      assert.equal(elementSlice(rendered, 'left-hud').includes('class="notice-stack"'), false, 'wide layouts keep GFX-05 lanes')
      if (mode === 'compact') {
        assert.ok(side.indexOf('class="notice-stack"') > side.indexOf('finale-hud'), 'finale cues retain priority above notices')
        assert.ok(side.indexOf('class="notice-stack"') < side.indexOf('compact-hud-disclosure'), 'notices are not buried below optional world news')
      }
      // W3-6 — the narrow layout moves the same single region to the foot of the left column.
      const narrow = renderToStaticMarkup(createElement(GameScreen, { ...props, columnLane: true }))
      assert.equal((narrow.match(/class="notice-stack"/g) ?? []).length, 1, `${mode}/${faction}: narrow duplicated the live region`)
      const leftHud = elementSlice(narrow, 'left-hud')
      const mission = elementSlice(narrow, 'mission-hud')
      assert.ok(leftHud.indexOf('class="notice-stack"') > leftHud.indexOf('class="status-hud"'))
      assert.ok(leftHud.indexOf('class="notice-stack"') > leftHud.indexOf('class="mission-hud"') + mission.length - 1,
        `${mode}/${faction}: the notices are not after the mission panel`)
      const stack = elementSlice(narrow, 'notice-stack')
      assert.ok(leftHud.endsWith(`${stack}</div>`), `${mode}/${faction}: the notices are not the last thing in the column`)
      assert.equal(elementSlice(narrow, 'top-hud-side').includes('notice-stack'), false)
      for (const disclosure of narrow.matchAll(/<details class="compact-hud-disclosure">[\s\S]*?<\/details>/g)) {
        assert.doesNotMatch(disclosure[0], /notice-stack/)
      }
      for (const notice of props.notices) assert.ok(leftHud.includes(notice.message))
      // The narrow lane grows upward from the column's foot, so the newest notice is on top.
      const order = props.notices.map((notice) => stack.indexOf(notice.message))
      assert.deepEqual([...order].sort((first, second) => second - first), order, 'narrow lists the newest first')
      // Control: the wide stack grows downward and keeps the oldest first.
      const wideStack = elementSlice(rendered, 'notice-stack')
      const wideOrder = props.notices.map((notice) => wideStack.indexOf(notice.message))
      assert.deepEqual([...wideOrder].sort((first, second) => first - second), wideOrder)
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

test('W3-6: a merged notice shows its count to the eye only, in either lane; a single one shows none', () => {
  for (const columnLane of [false, true]) {
    const props = fixture('full')
    props.notices = [
      { id: 7, message: 'Нет выносливости.', tone: 'warning', count: 3 },
      { id: 8, message: 'Одна весть.', tone: 'info', count: 1 },
    ]
    const html = renderToStaticMarkup(createElement(GameScreen, { ...props, columnLane }))
    assert.equal((html.match(/<b class="notice-count" aria-hidden="true">×3<\/b>/g) ?? []).length, 1)
    // Control: the single notice carries no badge, so there is exactly one.
    assert.equal((html.match(/class="notice-count"/g) ?? []).length, 1)
    assert.ok(html.includes('<span>Нет выносливости.</span>'), 'the merged line lost its words')
  }
})

test('W3-6b: an achievement and a find are notices in the lane, in every lane, and nothing floats over the HUD', () => {
  for (const columnLane of [false, true]) {
    for (const mode of ['full', 'compact'] as const) {
      const props = fixture(mode)
      props.notices = [
        { id: 11, message: 'Достижение открыто · Редкое. Суть такова. Начать первый забег.', tone: 'success', count: 1,
          art: { kind: 'achievement', rarity: 'rare', label: 'Достижение открыто · Редкое', title: 'Суть такова',
            detail: 'Начать первый забег.' } },
        { id: 12, message: 'Легендарная награда. Кошель. +48 золота', tone: 'success', count: 2,
          art: { kind: 'loot', rarity: 'legendary', label: 'Легендарная награда', title: 'Кошель', detail: '+48 золота' } },
      ]
      // The view still carries the latest find, for the hint director; the HUD draws it only
      // as a notice. Before W3-6b this view alone put a toast over the vitals.
      props.view.lootToast = { id: 5, rarity: 'legendary', title: 'Кошель', detail: '+48 золота' }
      const html = renderToStaticMarkup(createElement(GameScreen, { ...props, columnLane }))
      const stack = elementSlice(html, 'notice-stack')
      const where = `${mode}/${String(columnLane)}`
      assert.match(stack, /class="notice success achievement rarity-rare"/, where)
      assert.match(stack, /class="notice success loot loot-legendary"/, where)
      assert.ok(stack.includes('<span class="notice-art"><small>Достижение открыто · Редкое</small> ' +
        '<strong>Суть такова</strong> <span>Начать первый забег.</span></span>'), where)
      assert.ok(stack.includes('<span class="loot-rarity-shape" aria-hidden="true"><i></i></span>'), where)
      assert.match(stack, /lucide-trophy/, where)
      assert.ok(stack.includes('×2'), where)
      // The words are drawn once, as the art's lines, and not again as the plain message.
      assert.equal(stack.includes(props.notices[0].message), false, where)
      assert.doesNotMatch(html, /achievement-banner|loot-toast/, where)
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
    const preferences = { hudMode }
    assert.equal(saveVisualPreferences(storage, preferences), true)
    assert.deepEqual(loadVisualPreferences(storage), preferences)
    assert.equal(policy.mode, 'enhanced')
    assert.equal(policy.quality, 'high')
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
      if (owner === 'pause') {
        assert.doesNotMatch(html, /Графика: предпросмотр|Режим графики|Качество предпросмотра|Улучшенная \(предпросмотр\)/)
        assert.ok(html.includes(COMPACT_HUD_COPY.setting))
      }
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
    assert.equal((html.match(/<select /g) ?? []).length, 1)
    assert.doesNotMatch(html, /предпросмотр|повторного входа|выберите|value="(?:legacy|enhanced|high|balanced|low)"/i)
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
  assert.doesNotMatch(css, /font-size:\s*[\d.]+px|position:\s*absolute/)
  const viewportLanes = [...css.matchAll(/([^{}]+)\{[^{}]*position:\s*fixed;[^{}]*\}/g)]
  assert.equal(viewportLanes.length, 1)
  assert.equal(viewportLanes[0][1].trim(), '.game-screen[data-hud="compact"]:has(.finale-hud) .notice-stack')
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const change = app.slice(app.indexOf('const changeVisualPreferences ='), app.indexOf('const selectBoon ='))
  assert.doesNotMatch(change, /setPaused|setScreen|destroy|new GameEngine|applyGameOverlays/)
})

test('W2-3: a priced contract card shows its price in Full, Compact, the journal and the atlas; an unpriced one shows none', () => {
  const price = {
    payout: { gold: 300, supplies: 0, heal: 0, damage: 0, companion: false, loot: 'uncommon' as const },
    timeLimit: 150,
    travel: { meters: 370.2, seconds: 46, basis: 'road' as const, danger: ['B2'], unscouted: 1 },
  }
  const lines = ['Плата: 300 золотых и трофей.', 'Срок: 150 с с начала', 'Идти ~46 с, 371 м дороги',
    'Опасно: B2 · в тумане: 1 квадрат']
  for (const mode of ['full', 'compact'] as const) {
    const props = fixture(mode, 'villain')
    // W2-2, PR B — the camp's two caravans are priced in the same language; this test counts
    // contract cards, so the launch view's camp choice is taken off the field.
    props.view.caravanBeats = { ...props.view.caravanBeats, opening: null }
    props.view.contracts = props.view.contracts.map((entry, index) =>
      index === 0 ? { ...entry, ...price } : { ...entry, payout: null, timeLimit: null, travel: null })
    const html = renderToStaticMarkup(createElement(GameScreen, props))
    for (const line of lines) assert.ok(html.includes(line), `${mode} lost «${line}»`)
    // Negative control: the second card carries no price, so exactly one block renders.
    assert.equal((html.match(/class="choice-price"/g) ?? []).length, 1, mode)
    const journal = renderToStaticMarkup(createElement(GameScreen, { ...props, activeOverlay: 'journal', simulationPaused: true }))
    assert.equal((journal.match(/Плата: 300 золотых и трофей\./g) ?? []).length, 2, `${mode}: HUD and journal`)
  }
  const props = fixture('full', 'villain')
  const first = props.view.expedition.targets[0]
  assert.ok(first)
  const priced = { ...first, kind: 'objective' as const, title: 'Жирный корован', ...price }
  props.view.expedition = { ...props.view.expedition, mode: 'selected', target: priced,
    targets: [priced, ...props.view.expedition.targets.slice(1).map((target) => ({ ...target, payout: null, travel: null }))] }
  const atlas = renderToStaticMarkup(createElement(GameScreen, { ...props, activeOverlay: 'atlas', simulationPaused: true }))
  assert.ok(atlas.includes('<span class="expedition-price">300 золотых · идти ~46 с</span>'))
  for (const line of lines) assert.ok(atlas.includes(line), `the atlas detail lost «${line}»`)
  assert.equal((atlas.match(/class="expedition-price"/g) ?? []).length, 1, 'only the priced destination quotes a price')
})

test('W2-3: a taken escort’s card says where its cart is met, in Full and Compact; an untaken rumour does not', () => {
  const card = (id: string, extra: Record<string, unknown>) => ({
    id, kind: 'escort' as const, title: 'Корован без охраны', task: 'Идти рядом с корованом.',
    stake: 'Не пойдёшь — корован ляжет по дороге.', regionLabel: 'B3', timeRemaining: 40, pinned: false,
    progress: 0, x: 0, z: 0, outcome: null, outcomeText: null,
    travel: { meters: 160, seconds: 20, basis: 'road' as const, danger: [], unscouted: 0 },
    reach: 'yes' as const, reward: null, meetLabel: null, ...extra,
  })
  const line = 'встретить в C3 · идти ~20 с · осталось 40 с · успеешь'
  for (const mode of ['full', 'compact'] as const) {
    const props = fixture(mode, 'guard')
    props.view.rumours = [
      card('rumour:escort:taken', { pinned: true, meetLabel: 'C3' }),
      card('rumour:defend:offered', { kind: 'defend', title: 'На домики собираются' }),
    ]
    const html = renderToStaticMarkup(createElement(GameScreen, props))
    assert.ok(html.includes(line), `${mode} lost «${line}»`)
    // Control: the untaken card quotes its walk and clock but names no meeting.
    assert.equal((html.match(/встретить в /g) ?? []).length, mode === 'compact' ? 2 : 1, mode)
    assert.ok(html.includes('идти ~20 с · осталось 40 с · успеешь'))
  }
})
