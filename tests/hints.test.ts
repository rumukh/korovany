/**
 * The coverage gate for diegetic first-time lines, and the controls that keep it honest.
 *
 * The claim 0.4 has to back is "every mechanic with a HUD element has a first-time line".
 * Asserting that in prose is worthless, so it is asserted against the enumeration the HUD
 * actually draws from: the `GameView`. Every field of a real, generated view must be
 * claimed by a mechanic or exempted with a written reason — which means a Phase 1 feature
 * that adds a HUD element adds a view field, and fails this file until somebody decides
 * whether it teaches itself.
 *
 * Three classes of control run alongside it, because a coverage test that cannot fail is
 * worse than no coverage test:
 *
 * - *Vacuity.* The checker is re-run against mutated registries — a missing mechanic, a
 *   stale field, a blank reason, an unreachable hint — and each mutation must be reported.
 *   A floor on the number of enumerated fields catches the degenerate case where the
 *   enumeration itself came back empty.
 * - *Reachability.* Every trigger is driven with a view built to trip it, so a predicate
 *   that can never be true is a failure rather than silent coverage.
 * - *Once.* The whole point of `seenHints` is that a line fires once. Duplicate emissions
 *   fail, and every "no duplicates" assertion is paired with a floor proving something was
 *   emitted at all.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { HINT_IDS, describeHint, type HintId } from '../src/game/content/gameCopy.ts'
import {
  HINT_MIN_GAP_SECONDS,
  HUD_MECHANICS,
  HUD_VIEW_EXEMPTIONS,
  HintDirector,
  findHudCoverageGaps,
  type HudMechanic,
} from '../src/game/content/hints.ts'
import type { GameView, NoticeTone } from '../src/game/types.ts'
import type { RunConfig } from '../src/game/run/runTypes.ts'
import { buildInitialGameView } from '../src/game/world/CampaignView.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { WORLD_GENERATOR_VERSION } from '../src/game/world/worldTypes.ts'

const SEED = 20_260_729

function launchView(): GameView {
  const blueprint = generateWorld(SEED)
  const config: RunConfig = {
    seed: SEED,
    generatorVersion: WORLD_GENERATOR_VERSION,
    faction: 'elf',
    // Deliberately not `scout-map`: that boon reveals the neighbours at launch, and the
    // map trigger needs undiscovered squares left to discover.
    selectedBoonId: 'provisions',
  }
  return buildInitialGameView({ blueprint, config, restored: undefined })
}

function discovered(view: GameView): number {
  return view.worldMap.regions.filter((region) => region.discovered).length
}

/**
 * One view per hint, built to trip exactly that mechanic and nothing else.
 *
 * This is the reachability control. It is also the place a trigger's meaning is written
 * down in executable form: if `stamina` ever starts firing on a full bar, this map is what
 * disagrees.
 */
const TRIPPING_VIEW: Record<HintId, (base: GameView) => GameView> = {
  health: (base) => ({ ...base, health: base.maxHealth - 12 }),
  stamina: (base) => ({ ...base, stamina: base.maxStamina * 0.5 }),
  bleeding: (base) => ({ ...base, body: { ...base.body, bleeding: 0.42 } }),
  limbLoss: (base) => ({ ...base, body: { ...base.body, leftArm: 'missing' } }),
  prosthetic: (base) => ({ ...base, body: { ...base.body, rightLeg: 'prosthetic' } }),
  gold: (base) => ({ ...base, gold: base.gold + 14 }),
  upgrades: (base) => ({
    ...base,
    damage: base.damage + 3,
    upgrades: { ...base.upgrades, blade: base.upgrades.blade + 1 },
  }),
  shopPrices: (base) => ({ ...base, shopPriceMultiplier: 1.25 }),
  zone: (base) => ({ ...base, zone: base.zone === 'fort' ? 'forest' : 'fort' }),
  objectives: (base) => ({
    ...base,
    objectives: base.objectives.map((objective, index) =>
      index === 0 ? { ...objective, done: true } : objective,
    ),
  }),
  interact: (base) => ({ ...base, prompt: 'E — осмотреть тайник' }),
  map: (base) => ({
    ...base,
    worldMap: {
      ...base.worldMap,
      regions: base.worldMap.regions.map((region) => ({ ...region, discovered: true })),
    },
  }),
  chronicle: (base) => ({
    ...base,
    chronicle: [
      { id: 'chronicle-1', tick: 3, regionLabel: 'B2', text: 'Корован ушёл.', tone: 'info' },
    ],
  }),
  squad: (base) => ({ ...base, squad: 2 }),
  threat: (base) => ({ ...base, threatTier: 2 }),
  ability: (base) => ({ ...base, ability: { ...base.ability, cooldown: 1.4 } }),
  events: (base) => ({
    ...base,
    activeEvent: {
      id: 'event-1',
      kind: 'warband',
      title: 'Чужая ватага',
      description: 'Проредить.',
      tone: 'warning',
    },
  }),
  loot: (base) => ({
    ...base,
    lootToast: { id: 1, rarity: 'rare', title: 'Клинок', detail: 'Урон +2' },
  }),
}

interface Recorded {
  messages: { text: string; tone: NoticeTone }[]
  reported: string[]
  director: HintDirector
}

function recordingDirector(seen: readonly string[] = []): Recorded {
  const messages: { text: string; tone: NoticeTone }[] = []
  const reported: string[] = []
  const director = new HintDirector({
    seen,
    emit: (text, tone) => messages.push({ text, tone }),
    onSeen: (hintId) => reported.push(hintId),
  })
  return { messages, reported, director }
}

function hintsFrom(recorded: Recorded): string[] {
  const byText = new Map(HINT_IDS.map((id) => [describeHint(id).text, id as string]))
  return recorded.messages.map(({ text }) => byText.get(text) ?? `unknown:${text}`)
}

// ---------------------------------------------------------------------------
// The coverage gate
// ---------------------------------------------------------------------------

test('every field the HUD draws from is either a hinted mechanic or an exemption with a reason', () => {
  const fields = Object.keys(launchView())

  // Floor. An empty or truncated enumeration would make the gate below unfailable, which
  // is the exact way a coverage test goes quietly useless.
  assert.ok(fields.length >= 25, `only ${String(fields.length)} view fields enumerated`)
  for (const expected of ['stamina', 'body', 'threatTier', 'chronicle', 'ability', 'gold']) {
    assert.ok(fields.includes(expected), `${expected} vanished from the view`)
  }

  assert.deepEqual(findHudCoverageGaps(fields), [])
})

test('the mechanics named as learned-by-dying are hinted, not exempted', () => {
  // The roadmap's own list. Exempting one of these would satisfy the gate above while
  // giving up the thing 0.4 exists to fix, so it is pinned separately.
  const claimed = new Set(HUD_MECHANICS.flatMap((mechanic) => mechanic.viewFields))
  for (const field of ['stamina', 'ability', 'body', 'threatTier', 'chronicle', 'gold']) {
    assert.ok(claimed.has(field as keyof GameView), `${field} is not claimed by a mechanic`)
    assert.equal(
      Object.hasOwn(HUD_VIEW_EXEMPTIONS, field),
      false,
      `${field} was exempted instead of taught`,
    )
  }
  for (const hint of ['stamina', 'bleeding', 'limbLoss', 'prosthetic', 'threat', 'chronicle']) {
    assert.ok(
      HUD_MECHANICS.some((mechanic) => mechanic.hint === hint),
      `${hint} has no mechanic to fire it`,
    )
  }
})

test('the coverage gate reports a new HUD field, a stale one, a blank reason and a dead hint', () => {
  // Vacuity control. Each mutation is a way the gate could rot; each must be caught, or
  // the clean result above means nothing.
  const fields = Object.keys(launchView())

  assert.deepEqual(findHudCoverageGaps([...fields, 'doctrineDraft']), [
    { subject: 'doctrineDraft', problem: 'unclaimed' },
  ])

  const withoutStamina = HUD_MECHANICS.filter((mechanic) => mechanic.hint !== 'stamina')
  assert.deepEqual(
    findHudCoverageGaps(fields, withoutStamina).filter((gap) => gap.problem === 'unclaimed'),
    [
      { subject: 'stamina', problem: 'unclaimed' },
      { subject: 'maxStamina', problem: 'unclaimed' },
    ],
  )

  const stale: HudMechanic = {
    hint: 'threat',
    viewFields: ['deletedField' as keyof GameView],
    firstSighting: () => false,
  }
  assert.ok(
    findHudCoverageGaps(fields, [...HUD_MECHANICS, stale]).some(
      (gap) => gap.subject === 'deletedField' && gap.problem === 'stale',
    ),
  )

  assert.ok(
    findHudCoverageGaps(fields, HUD_MECHANICS, { ...HUD_VIEW_EXEMPTIONS, kills: '  ' }).some(
      (gap) => gap.subject === 'kills' && gap.problem === 'unexplained',
    ),
  )

  assert.ok(
    findHudCoverageGaps(fields, HUD_MECHANICS, HUD_VIEW_EXEMPTIONS, [
      ...HINT_IDS,
      'writtenButUnreachable',
    ]).some((gap) => gap.subject === 'writtenButUnreachable' && gap.problem === 'unreachable'),
  )
})

test('every hint is reachable: one view per mechanic, and it trips only that mechanic', () => {
  const base = launchView()

  // The trip views assume the launch state leaves room to move. Assert it rather than
  // hoping: a fully-discovered map or a pre-completed objective would make two of them
  // silently trip nothing.
  assert.ok(discovered(base) < base.worldMap.regions.length, 'nothing left to discover')
  assert.ok(base.objectives.length > 0 && base.objectives.every((o) => !o.done))
  assert.notEqual(TRIPPING_VIEW.zone(base).zone, base.zone, 'the zone trip is a no-op')

  assert.deepEqual(
    [...HINT_IDS].sort(),
    HUD_MECHANICS.map((mechanic) => mechanic.hint).sort(),
    'a hint exists with no mechanic, or a mechanic with no hint',
  )

  for (const id of HINT_IDS) {
    const recorded = recordingDirector()
    recorded.director.observe(base)
    recorded.director.observe(TRIPPING_VIEW[id](base))
    assert.deepEqual(hintsFrom(recorded), [id], `${id} did not fire alone`)
  }
})

test('the launch view teaches only what is already on screen', () => {
  // The rejected design, stated precisely rather than generously. No hint may fire before
  // the player has done something — but "done something" is about the HUD, not the clock:
  // a live `GameEngine` spawns the starting squad before its first `emitView`, so the
  // counter really does read three on frame one, and the line about that counter is the
  // one thing that is allowed to arrive unprompted. Everything else must wait.
  //
  // `buildInitialGameView` reports `squad: 0`, so both shapes are driven here. Asserting
  // only the first would claim more than it measures.
  const base = launchView()
  assert.equal(base.squad, 0, 'the launch view builder is expected to report no squad')

  const quiet = recordingDirector()
  quiet.director.observe(base)
  quiet.director.observe({ ...base, elapsed: 30 })
  assert.deepEqual(quiet.messages, [])
  assert.deepEqual(quiet.reported, [])

  // The live engine's first frame: allies exist, so the counter is showing something.
  const withSquad = recordingDirector()
  withSquad.director.observe({ ...base, squad: 3 })
  withSquad.director.observe({ ...base, squad: 3, elapsed: 30 })
  assert.deepEqual(hintsFrom(withSquad), ['squad'], 'launch taught more than the squad')
})

test('a queued hint survives a save and continue of the same run', () => {
  // A transition trigger cannot rediscover its transition after a restore — the gold was
  // already earned, the square already discovered. Without carrying the queue, a line
  // queued behind the pacing gate would die with the engine that queued it.
  const base = launchView()
  const first = recordingDirector()
  first.director.observe(base)
  // Two mechanics inside one gap: the second is still queued when the run is saved.
  first.director.observe({ ...TRIPPING_VIEW.bleeding(base), gold: base.gold + 20 })
  assert.equal(first.messages.length, 1, 'the pacing gate is expected to hold one back')
  const carried = first.director.pending()
  assert.deepEqual(carried, ['gold'])

  // Non-vacuity: dropping the queue on restore loses the line for good, because the gold
  // rise is in the past by the time the new engine sees its first view.
  const dropped = recordingDirector(first.director.snapshot())
  dropped.director.observe({ ...base, gold: base.gold + 20, elapsed: 100 })
  dropped.director.observe({ ...base, gold: base.gold + 20, elapsed: 130 })
  assert.deepEqual(dropped.messages, [])

  const restoredMessages: string[] = []
  const restored = new HintDirector({
    seen: first.director.snapshot(),
    pending: carried,
    emit: (text) => restoredMessages.push(text),
  })
  restored.observe({ ...base, gold: base.gold + 20, elapsed: 100 })
  assert.deepEqual(restoredMessages, [describeHint('gold').text])
  assert.deepEqual(restored.pending(), [], 'the carried hint was not consumed')
})

test('a carried queue cannot smuggle in an unknown, duplicate or already-seen hint', () => {
  const base = launchView()
  const messages: string[] = []
  const director = new HintDirector({
    seen: ['bleeding'],
    pending: ['bleeding', 'gold', 'gold', 'hintFromTheFuture', '', 'toString'],
    emit: (text) => messages.push(text),
  })
  assert.deepEqual(director.pending(), ['gold'])

  for (let step = 0; step < 10; step += 1) {
    director.observe({ ...base, elapsed: step * 10 })
  }
  assert.deepEqual(messages, [describeHint('gold').text])
})

// ---------------------------------------------------------------------------
// Once, and only once
// ---------------------------------------------------------------------------

test('a hint fires once no matter how many frames say it should', () => {
  const base = launchView()
  const tripped = TRIPPING_VIEW.bleeding(TRIPPING_VIEW.interact(base))
  const recorded = recordingDirector()

  recorded.director.observe(base)
  for (let frame = 0; frame < 400; frame += 1) {
    recorded.director.observe({ ...tripped, elapsed: frame * 0.5 })
  }

  const fired = hintsFrom(recorded)
  // Non-vacuity: "no duplicates" is trivially true of an empty list.
  assert.deepEqual([...fired].sort(), ['bleeding', 'interact'])
  assert.equal(new Set(fired).size, fired.length, 'a hint fired twice')
  assert.deepEqual(recorded.reported, fired, 'a hint was shown without being reported')
  assert.deepEqual([...recorded.director.snapshot()].sort(), ['bleeding', 'interact'])
})

test('a hint the profile has already seen never fires again', () => {
  const base = launchView()
  const tripped = TRIPPING_VIEW.bleeding(TRIPPING_VIEW.interact(base))

  const fresh = recordingDirector()
  fresh.director.observe(base)
  for (let frame = 0; frame < 40; frame += 1) {
    fresh.director.observe({ ...tripped, elapsed: frame * 4 })
  }
  // Non-vacuity for the returning case below: the same frames do teach a fresh profile.
  assert.equal(fresh.messages.length, 2)

  const returning = recordingDirector(['bleeding', 'interact'])
  returning.director.observe(base)
  for (let frame = 0; frame < 40; frame += 1) {
    returning.director.observe({ ...tripped, elapsed: frame * 4 })
  }
  assert.deepEqual(returning.messages, [])
  assert.deepEqual(returning.reported, [])

  const partly = recordingDirector(['bleeding'])
  partly.director.observe(base)
  for (let frame = 0; frame < 40; frame += 1) {
    partly.director.observe({ ...tripped, elapsed: frame * 4 })
  }
  assert.deepEqual(hintsFrom(partly), ['interact'])
})

test('an unknown id in the ledger is carried, not dropped and not taught', () => {
  // Forward compatibility for a profile written by a build that knew a hint this one does
  // not: the ledger is persisted whole, so the id survives a round trip through the
  // director without becoming a notice.
  const recorded = recordingDirector(['bleeding', 'hintFromTheFuture'])
  recorded.director.observe(launchView())
  assert.equal(recorded.director.hasSeen('hintFromTheFuture'), true)
  assert.ok(recorded.director.snapshot().includes('hintFromTheFuture'))
  assert.deepEqual(recorded.messages, [])
})

// ---------------------------------------------------------------------------
// Pacing, pausing, and what a hint is not allowed to touch
// ---------------------------------------------------------------------------

test('four mechanics tripped in one frame arrive one at a time, not as a wall', () => {
  const base = launchView()
  const everything = TRIPPING_VIEW.loot(
    TRIPPING_VIEW.threat(TRIPPING_VIEW.bleeding(TRIPPING_VIEW.interact(base))),
  )
  const recorded = recordingDirector()
  recorded.director.observe(base)

  const firedAt: number[] = []
  for (let step = 0; step < 200; step += 1) {
    const elapsed = step * 0.25
    const before = recorded.messages.length
    recorded.director.observe({ ...everything, elapsed })
    if (recorded.messages.length > before) firedAt.push(elapsed)
  }

  assert.equal(firedAt.length, 4, 'not every tripped mechanic was taught')
  assert.equal(new Set(hintsFrom(recorded)).size, 4)
  for (let index = 1; index < firedAt.length; index += 1) {
    assert.ok(
      firedAt[index] - firedAt[index - 1] >= HINT_MIN_GAP_SECONDS,
      `hints ${String(index - 1)} and ${String(index)} shared the notice stack`,
    )
  }
})

test('a paused game holds hints instead of spending them behind the pause screen', () => {
  const base = launchView()
  const tripped = TRIPPING_VIEW.bleeding(base)
  const recorded = recordingDirector()

  recorded.director.observe(base)
  for (let step = 0; step < 20; step += 1) {
    recorded.director.observe({ ...tripped, paused: true, elapsed: step })
  }
  assert.deepEqual(recorded.messages, [], 'a hint was spent while paused')

  recorded.director.observe({ ...tripped, paused: false, elapsed: 21 })
  assert.deepEqual(hintsFrom(recorded), ['bleeding'], 'the held hint was lost')
})

test('firing a hint touches no clock and no random stream', () => {
  // Determinism control. Hints ride the view, so they must not consume from a random
  // stream — a draw taken for a UI event would shift every encounter and loot roll after
  // it — and must not read wall-clock time, which is not part of a seeded run.
  const base = launchView()
  const everything = TRIPPING_VIEW.loot(TRIPPING_VIEW.bleeding(TRIPPING_VIEW.interact(base)))
  const recorded = recordingDirector()

  const realRandom = Math.random
  const realNow = Date.now
  const realPerformanceNow = performance.now
  const forbidden = (name: string) => () => {
    throw new Error(`a hint read ${name}`)
  }
  Math.random = forbidden('Math.random') as typeof Math.random
  Date.now = forbidden('Date.now') as typeof Date.now
  performance.now = forbidden('performance.now') as typeof performance.now
  try {
    recorded.director.observe(base)
    for (let step = 0; step < 120; step += 1) {
      recorded.director.observe({ ...everything, elapsed: step * 0.5 })
    }
  } finally {
    Math.random = realRandom
    Date.now = realNow
    performance.now = realPerformanceNow
  }

  // Non-vacuity: the sequence has to have actually fired hints for the stubs to prove
  // anything about firing one.
  assert.equal(recorded.messages.length, 3)
})
