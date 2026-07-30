/**
 * Roadmap 1.6 — the in-run doctrine draft, and the three ways it could quietly be wrong.
 *
 * The initiative's own risk is **interaction explosion and power creep**, and its stated
 * mitigation is *sidegrades only plus a hard slot cap*. Both are claims that can be checked
 * rather than asserted, so they are. So are the three "the obvious answer is wrong" warnings
 * the roadmap attaches to this item, and each one gets a negative control beside it, because
 * an assertion nobody has watched fail is an assertion nobody should trust:
 *
 * 1. **The cap is a mechanic, not a disabled button.** The control is a deliberately wrong
 *    "equip" that pushes straight into the ledger — it *does* reach four, so the shipped
 *    one refusing at three is a measurement rather than a coincidence.
 * 2. **An offer never moves another stream.** The control is a deliberately wrong offer that
 *    shuffles with a stream it was handed — it *does* shift that stream's state, so the
 *    shipped one leaving all six untouched means something.
 * 3. **The doctrine set never enters the world fingerprint.** The control is a deliberately
 *    wrong fingerprint that folds the ruleset into the world hash — it *does* give one world
 *    two identities, which is exactly what the roadmap says folding it in would cost.
 *
 * The two success signals are measured on `tests/runHarness.ts` and on the shipped catalogue
 * rather than argued for, and the convergence control is the one that decides whether the
 * second number means anything: a pool of three unlocked cards has **exactly one** reachable
 * equipped set, so the draft is a formality until profile currency has widened the pool.
 * That is the same sentence as "profile currency has somewhere to go", said in sets.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import { getThreatTier } from '../src/game/types.ts'
import {
  BOON_CATALOGUE,
  computeRunCompletionReward,
} from '../src/game/run/profile.ts'
import {
  DEFAULT_DOCTRINE_IDS,
  DOCTRINE_CATALOGUE,
  DOCTRINE_DRAFT_TIERS,
  DOCTRINE_OFFER_SIZE,
  MAX_EQUIPPED_DOCTRINES,
  advanceDoctrineAnchors,
  createDoctrineRunState,
  equipDoctrine,
  getDoctrineOffer,
  getUnlockedDoctrineIds,
  isDoctrineUnlocked,
  normalizeDoctrineRunState,
  pendingDoctrineDraftIndex,
  resolveDoctrineEffects,
  rollDoctrineOffer,
  serializeDoctrineRunState,
  unlockDoctrine,
  type DoctrineEffects,
  type DoctrineId,
} from '../src/game/run/doctrine.ts'
import {
  canonicalizeRunRuleset,
  computeRunRulesetFingerprint,
} from '../src/game/run/ruleset.ts'
import { buildRunEpilogue } from '../src/game/run/epilogue.ts'
import {
  createDefaultProfile,
  normalizeActiveRunSaveV3,
} from '../src/game/run/storage.ts'
import type { ActiveRunSaveV3 } from '../src/game/run/runTypes.ts'
import { describeRunEpilogue } from '../src/game/content/gameCopy.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import {
  canonicalizeWorldBlueprint,
  computeWorldFingerprint,
} from '../src/game/world/WorldValidator.ts'
import { buildDoctrineView } from '../src/game/world/CampaignView.ts'
import { runHarness, type DoctrinePolicy, type RunReport } from './runHarness.ts'

const SEED = 1_606_060
const FULL_POOL: readonly DoctrineId[] = DOCTRINE_CATALOGUE.map(
  (definition) => definition.id,
)

/** The engine's own six, derived exactly as `GameEngine` derives them. */
function runStreams(seed: number): Record<string, RandomStream> {
  return {
    combat: new RandomStream(deriveSeed(seed, 'gameplay:combat')),
    director: new RandomStream(deriveSeed(seed, 'gameplay:director')),
    event: new RandomStream(deriveSeed(seed, 'gameplay:event')),
    loot: new RandomStream(deriveSeed(seed, 'gameplay:loot')),
    chronicle: new RandomStream(deriveSeed(seed, 'gameplay:chronicle')),
    rumour: new RandomStream(deriveSeed(seed, 'gameplay:rumour')),
  }
}

function stateOf(streams: Record<string, RandomStream>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(streams).map(([key, stream]) => [key, stream.getState()]),
  )
}

// ---------------------------------------------------------------------------
// Rules, not stats
// ---------------------------------------------------------------------------

test('every doctrine changes a rule, costs something, and never adds a number', () => {
  // A floor first: an empty catalogue would satisfy every assertion in the loop below.
  assert.ok(
    DOCTRINE_CATALOGUE.length > MAX_EQUIPPED_DOCTRINES,
    'the pool must be wider than the slots, or a draft is an inventory',
  )

  const effectKeys = new Set<keyof DoctrineEffects>()
  for (const definition of DOCTRINE_CATALOGUE) {
    assert.ok(/[А-Яа-яЁё]/.test(definition.name), `${definition.id} is not named in Russian`)
    assert.ok(definition.rule.length > 30, `${definition.id} has no rule`)
    // Sidegrades only. A card with nothing in `takes` is a boon wearing a doctrine's coat,
    // and that is the exact thing this initiative exists to stop shipping more of.
    assert.ok(definition.gives.length > 20, `${definition.id} gives nothing`)
    assert.ok(definition.takes.length > 20, `${definition.id} costs nothing`)
    for (const line of [definition.rule, definition.gives, definition.takes]) {
      // Rules, not stats: a card describable as "+N to X" is the wrong card, and copy is
      // where that would show first.
      assert.equal(/\d/.test(line), false, `${definition.id} quotes a number: ${line}`)
      assert.ok(/[.!?]$/.test(line), `${definition.id} has a line that is not a sentence`)
    }
    assert.equal(
      effectKeys.has(definition.effect),
      false,
      `${definition.id} shares an effect with another card`,
    )
    effectKeys.add(definition.effect)
  }

  // One card, one rule, and every rule owned by a card. This is the cheap half of the
  // answer to interaction explosion: disjoint effects cannot combine into a fourth thing.
  const allEffects = Object.keys(resolveDoctrineEffects([])) as (keyof DoctrineEffects)[]
  assert.deepEqual([...effectKeys].sort(), [...allEffects].sort())

  // Booleans, all of them. A number here would be the first step back to the flat scalars
  // of `BOON_CATALOGUE`.
  const resolved = resolveDoctrineEffects(FULL_POOL)
  for (const key of allEffects) {
    assert.equal(typeof resolved[key], 'boolean', `${key} is not a rule`)
    assert.equal(resolved[key], true, `${key} is unreachable from the catalogue`)
  }
  assert.deepEqual(
    resolveDoctrineEffects([]),
    Object.fromEntries(allEffects.map((key) => [key, false])),
  )
  // An id from a build that shipped a card this one does not know is forgotten, not fatal.
  assert.deepEqual(resolveDoctrineEffects(['no-such-doctrine']), resolveDoctrineEffects([]))
})

test('the pool is unlocked out of unlockedContentIds, a field nothing used to write', () => {
  const fresh = createDefaultProfile()
  // The field 1.6 was told to use. Before this initiative it only ever held `[]`.
  assert.deepEqual(fresh.unlockedContentIds, [])
  assert.deepEqual(getUnlockedDoctrineIds(fresh), [...DEFAULT_DOCTRINE_IDS])

  const locked = DOCTRINE_CATALOGUE.filter((definition) => !definition.defaultUnlocked)
  assert.ok(locked.length >= 3, 'currency needs more than a token to buy')

  const poor = { ...fresh, profileCurrency: locked[0].unlockCost - 1 }
  assert.equal(unlockDoctrine(poor, locked[0].id).status, 'insufficient-currency')
  assert.equal(unlockDoctrine(poor, 'no-such-doctrine').status, 'unknown-doctrine')

  const rich = { ...fresh, profileCurrency: 500 }
  const bought = unlockDoctrine(rich, locked[0].id)
  assert.equal(bought.status, 'unlocked')
  assert.equal(bought.profile.profileCurrency, 500 - locked[0].unlockCost)
  assert.ok(bought.profile.unlockedContentIds.includes(locked[0].id))
  assert.ok(isDoctrineUnlocked(bought.profile, locked[0].id))
  assert.equal(unlockDoctrine(bought.profile, locked[0].id).status, 'already-unlocked')
  // The purchase does not touch the boon shelf, which is the other thing currency buys.
  assert.deepEqual(bought.profile.unlockedBoonIds, rich.unlockedBoonIds)
})

// ---------------------------------------------------------------------------
// Warning 1 — the cap, and where the state lives
// ---------------------------------------------------------------------------

test('the slot cap is enforced by the mechanic, and a wrong equip proves it is', () => {
  const state = createDoctrineRunState(FULL_POOL)
  // Four anchors' worth of pressure against three slots. There are only three anchors, so
  // this is deliberately more than a run can generate.
  state.anchors = DOCTRINE_DRAFT_TIERS.length + 1

  const taken: string[] = []
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const offer = getDoctrineOffer(state, SEED)
    if (offer.length === 0) break
    if (equipDoctrine(state, SEED, offer[0])) taken.push(offer[0])
  }
  assert.equal(taken.length, MAX_EQUIPPED_DOCTRINES)
  assert.equal(state.equipped.length, MAX_EQUIPPED_DOCTRINES)
  assert.equal(new Set(state.equipped).size, MAX_EQUIPPED_DOCTRINES)
  // With three slots full there is nothing left to draft, whatever the anchors say.
  assert.equal(pendingDoctrineDraftIndex(state), null)
  assert.deepEqual(getDoctrineOffer(state, SEED), [])

  // A card that is not on the table cannot be taken, or the draft would be a menu of
  // everything unlocked and two runs would stop differing.
  const fresh = createDoctrineRunState(FULL_POOL)
  fresh.anchors = 1
  const offered = getDoctrineOffer(fresh, SEED)
  const notOffered = FULL_POOL.find((id) => !offered.includes(id))
  assert.ok(notOffered, 'the offer should be a subset of the pool')
  assert.equal(equipDoctrine(fresh, SEED, notOffered), false)
  assert.equal(equipDoctrine(fresh, SEED, 'no-such-doctrine'), false)
  assert.equal(fresh.equipped.length, 0)

  // The control. A "cap" that lived in the panel would look exactly like the assertions
  // above right up until a second caller appeared, so here is that second caller.
  const wrong = createDoctrineRunState(FULL_POOL)
  for (const id of FULL_POOL) wrong.equipped.push(id)
  assert.ok(
    wrong.equipped.length > MAX_EQUIPPED_DOCTRINES,
    'the wrong equip must be able to exceed the cap, or the check above is vacuous',
  )
  // And the ledger re-applies the cap on the way back in from a save, because a
  // hand-edited localStorage is a caller too.
  const clamped = normalizeDoctrineRunState(serializeDoctrineRunState(wrong))
  assert.equal(clamped.equipped.length, MAX_EQUIPPED_DOCTRINES)
})

test('the draft opens on the threat-tier anchors and the ledger rides in directorState', () => {
  const state = createDoctrineRunState(FULL_POOL)
  assert.equal(pendingDoctrineDraftIndex(state), null)

  // 3, 6 and 9 minutes, expressed the way the engine expresses them: through the tier that
  // already exists, is already persisted and already paces the run.
  const opened: number[] = []
  for (let elapsed = 0; elapsed <= 600; elapsed += 10) {
    if (advanceDoctrineAnchors(state, getThreatTier(elapsed))) opened.push(elapsed)
  }
  assert.deepEqual(opened, [180, 360, 540])
  assert.equal(state.anchors, DOCTRINE_DRAFT_TIERS.length)
  assert.deepEqual(
    DOCTRINE_DRAFT_TIERS.map((tier) => (tier - 1) * 180),
    opened,
  )
  // Idempotent: a frame that crosses nothing must not owe the player a fourth draft.
  assert.equal(advanceDoctrineAnchors(state, 5), false)

  // An ignored offer waits rather than stacking: the index follows what is equipped, so a
  // player who walks past draft one meets draft one again.
  const patient = createDoctrineRunState(FULL_POOL)
  patient.anchors = 3
  assert.equal(pendingDoctrineDraftIndex(patient), 0)
  const first = getDoctrineOffer(patient, SEED)
  equipDoctrine(patient, SEED, first[0])
  assert.equal(pendingDoctrineDraftIndex(patient), 1)
  assert.notDeepEqual(getDoctrineOffer(patient, SEED), first)
})

test('the ledger survives a save round trip, and RunConfig.modifiers stays untouched', () => {
  const state = createDoctrineRunState(FULL_POOL)
  state.anchors = 3
  for (let draft = 0; draft < MAX_EQUIPPED_DOCTRINES; draft += 1) {
    const offer = getDoctrineOffer(state, SEED)
    equipDoctrine(state, SEED, offer[offer.length - 1])
  }
  assert.equal(state.equipped.length, MAX_EQUIPPED_DOCTRINES)

  const save = terminalRun(state)
  const normalized = normalizeActiveRunSaveV3(save)
  assert.ok(normalized, 'the save with a doctrine ledger must still normalize')
  const restored = normalizeDoctrineRunState(normalized.directorState.doctrines)
  assert.deepEqual(restored.equipped, state.equipped)
  assert.deepEqual(restored.pool, state.pool)
  assert.equal(restored.anchors, state.anchors)

  // Warning 1, stated as an assertion rather than as a comment: doctrines are not launch
  // configuration and must never be written into the field reserved for launch-time
  // challenge rules.
  assert.equal(normalized.config.modifiers, undefined)
  assert.equal(
    JSON.stringify(normalized.config).includes(state.equipped[0]),
    false,
    'a doctrine leaked into RunConfig',
  )

  // The 1.2 provision, filled. `RunEpilogue.doctrines` shipped empty for this item.
  const epilogue = buildRunEpilogue(normalized)
  assert.deepEqual(epilogue.doctrines, state.equipped)
  const copy = describeRunEpilogue(
    {
      runId: normalized.runId,
      status: 'victory',
      seed: normalized.config.seed,
      generatorVersion: normalized.config.generatorVersion,
      faction: normalized.config.faction,
      selectedBoonId: normalized.config.selectedBoonId,
      startedAt: normalized.startedAt,
      endedAt: normalized.updatedAt,
      kills: 12,
      objectivesCompleted: 3,
      endingGold: 80,
      profileCurrencyEarned: 61,
      blueprintFingerprint: normalized.blueprintFingerprint,
      epilogue,
    },
    epilogue,
  )
  assert.ok(copy.doctrines, 'the сводка must now name the doctrines')
  for (const id of state.equipped) {
    const name = DOCTRINE_CATALOGUE.find((definition) => definition.id === id)?.name
    assert.ok(name && copy.doctrines.includes(name), `the сводка dropped ${id}`)
    // Ids are what the save holds; names are what a reader is shown.
    assert.equal(copy.doctrines.includes(id), false, `the сводка printed a raw id: ${id}`)
  }
  assert.ok(copy.text.includes(copy.doctrines))

  // A run that drafted nothing says nothing at all, which is the behaviour 1.2 shipped and
  // this item must not break.
  const bare = buildRunEpilogue(normalizeActiveRunSaveV3(terminalRun(createDoctrineRunState([])))!)
  assert.deepEqual(bare.doctrines, [])
})

// ---------------------------------------------------------------------------
// Warning 2 — the offer's own stream
// ---------------------------------------------------------------------------

test('a doctrine offer never moves a stream the run is going to draw from', () => {
  const streams = runStreams(SEED)
  const before = stateOf(streams)

  // Every offer a run can ever produce, taken back to back.
  const state = createDoctrineRunState(FULL_POOL)
  state.anchors = DOCTRINE_DRAFT_TIERS.length
  for (let draft = 0; draft < MAX_EQUIPPED_DOCTRINES; draft += 1) {
    const offer = getDoctrineOffer(state, SEED)
    assert.ok(offer.length > 0)
    equipDoctrine(state, SEED, offer[0])
  }
  // And a hundred more, in case a panel is redrawn.
  for (let repeat = 0; repeat < 100; repeat += 1) {
    rollDoctrineOffer({ seed: SEED, draftIndex: repeat % 3, pool: FULL_POOL, equipped: [] })
  }

  assert.deepEqual(
    stateOf(streams),
    before,
    'an offer shifted a gameplay stream, so opening a panel changed the world',
  )

  // The control. An offer drawn from a handed-in stream — the obvious implementation, and
  // the one the roadmap warns about — *does* move it, so the assertion above is a
  // measurement rather than a tautology about a function that draws nothing.
  const wrongStream = streams.event
  const wrongBefore = wrongStream.getState()
  wrongStream.shuffle(FULL_POOL).slice(0, DOCTRINE_OFFER_SIZE)
  assert.notEqual(
    wrongStream.getState(),
    wrongBefore,
    'the wrong offer must move the stream, or the control proves nothing',
  )
})

test('an offer is the same three cards for a seed and a draft, and different across seeds', () => {
  const args = { draftIndex: 0, pool: FULL_POOL, equipped: [] as string[] }
  const once = rollDoctrineOffer({ seed: SEED, ...args })
  assert.equal(once.length, DOCTRINE_OFFER_SIZE)
  // Stability is what makes a reload show the player the same table they were looking at.
  for (let repeat = 0; repeat < 20; repeat += 1) {
    assert.deepEqual(rollDoctrineOffer({ seed: SEED, ...args }), once)
  }
  // Different draft, different table — otherwise the second draft is the first one again.
  assert.notDeepEqual(rollDoctrineOffer({ seed: SEED, ...args, draftIndex: 1 }), once)

  // Across seeds it has to actually vary, or "the offer is seeded" would be decoration.
  const tables = new Set<string>()
  for (let index = 0; index < 120; index += 1) {
    tables.add(
      rollDoctrineOffer({ seed: 5_000 + index * 977, ...args }).join('+'),
    )
  }
  assert.ok(tables.size >= 6, `only ${String(tables.size)} distinct opening tables`)

  // The offer is recomputed, never stored, so a save and a restore cannot disagree with the
  // frame before them.
  const state = createDoctrineRunState(FULL_POOL)
  state.anchors = 1
  const live = getDoctrineOffer(state, SEED)
  const reloaded = normalizeDoctrineRunState(serializeDoctrineRunState(state))
  assert.deepEqual(getDoctrineOffer(reloaded, SEED), live)

  // A pool shorter than the table is offered whole rather than padded.
  assert.equal(
    rollDoctrineOffer({ seed: SEED, draftIndex: 0, pool: ['vanguard'], equipped: [] }).length,
    1,
  )
  assert.deepEqual(
    rollDoctrineOffer({ seed: SEED, draftIndex: 0, pool: FULL_POOL, equipped: FULL_POOL }),
    [],
  )
})

// ---------------------------------------------------------------------------
// Warning 3 — two fingerprints, two questions
// ---------------------------------------------------------------------------

test('the doctrine set stays out of the world fingerprint and lands in the run one', () => {
  const first = generateWorld(SEED)
  const second = generateWorld(SEED)
  assert.equal(first.fingerprint, second.fingerprint)
  assert.equal(computeWorldFingerprint(first), first.fingerprint)

  // The world hash cannot even see a doctrine: no id from the catalogue appears in the
  // canonical string it is taken over.
  const canonical = canonicalizeWorldBlueprint(first)
  for (const definition of DOCTRINE_CATALOGUE) {
    assert.equal(
      canonical.includes(definition.id),
      false,
      `${definition.id} reached the world canonicalisation`,
    )
  }

  const base = {
    seed: first.seed,
    generatorVersion: first.generatorVersion,
    faction: 'elf' as const,
    selectedBoonId: 'provisions',
  }
  const bare = computeRunRulesetFingerprint({ ...base, doctrines: [] })
  const drafted = computeRunRulesetFingerprint({
    ...base,
    doctrines: ['vanguard', 'pathfinder'],
  })
  assert.notEqual(bare, drafted, 'the ruleset fingerprint ignored the doctrines')
  // Order is not identity: drafting the same three cards in a different order is the same
  // run, and a fingerprint that disagreed would make the share block lie.
  assert.equal(
    drafted,
    computeRunRulesetFingerprint({ ...base, doctrines: ['pathfinder', 'vanguard'] }),
  )
  assert.equal(
    drafted,
    computeRunRulesetFingerprint({
      ...base,
      doctrines: ['pathfinder', 'vanguard', 'vanguard'],
    }),
  )
  // A shared seed still means one world; a shared seed *and* ruleset mean one run.
  assert.ok(first.fingerprint.startsWith('wg1-'))
  assert.ok(drafted.startsWith('rs1-'))
  assert.ok(canonicalizeRunRuleset({ ...base, doctrines: ['vanguard'] }).includes('vanguard'))
  // The launch config is in there too, so two different boons on one seed are two runs.
  assert.notEqual(
    drafted,
    computeRunRulesetFingerprint({
      ...base,
      selectedBoonId: 'sturdy-gear',
      doctrines: ['vanguard', 'pathfinder'],
    }),
  )

  // The control. Folding the ruleset into the world hash — the obvious shortcut — gives two
  // *identical* worlds two different world identities, which is precisely the cost the
  // roadmap names and the reason the value above lives in its own file.
  const foldedBare = computeWorldFingerprint({
    ...first,
    doctrines: [],
  } as unknown as typeof first)
  const foldedDrafted = computeWorldFingerprint({
    ...first,
    doctrines: ['vanguard'],
  } as unknown as typeof first)
  assert.notEqual(
    foldedBare,
    foldedDrafted,
    'the wrong fingerprint must split one world in two, or the control proves nothing',
  )
  assert.equal(first.fingerprint, second.fingerprint)
})

// ---------------------------------------------------------------------------
// The HUD
// ---------------------------------------------------------------------------

test('the draft reaches the view with its cost beside its gain', () => {
  const state = createDoctrineRunState(FULL_POOL)
  const quiet = buildDoctrineView(state, SEED)
  assert.deepEqual(quiet.offer, [])
  assert.deepEqual(quiet.equipped, [])
  assert.equal(quiet.draft, null)
  assert.equal(quiet.slots, MAX_EQUIPPED_DOCTRINES)
  assert.equal(quiet.draftsTotal, DOCTRINE_DRAFT_TIERS.length)

  state.anchors = 1
  const open = buildDoctrineView(state, SEED)
  assert.equal(open.draft, 1)
  assert.equal(open.offer.length, DOCTRINE_OFFER_SIZE)
  for (const card of open.offer) {
    assert.ok(card.name.length > 0)
    assert.ok(card.rule.length > 0)
    assert.ok(card.gives.length > 0)
    assert.ok(card.takes.length > 0, 'a card without a cost is not a sidegrade')
  }

  equipDoctrine(state, SEED, open.offer[0].id)
  const after = buildDoctrineView(state, SEED)
  assert.deepEqual(
    after.equipped.map((card) => card.id),
    [open.offer[0].id],
  )
  assert.equal(after.draft, null, 'the second draft opens on the second anchor, not sooner')
})

// ---------------------------------------------------------------------------
// Signal 1 — profile currency spent past run five
// ---------------------------------------------------------------------------

/**
 * The meta-loop, driven by rewards a real run actually earned.
 *
 * Cheapest-first, which is the strongest case for the *old* shelf: any other order unlocks
 * it later and makes the number below look better than it is.
 */
function currencySpentByRun(
  costs: readonly number[],
  rewards: readonly number[],
): number[] {
  const queue = costs.filter((cost) => cost > 0).sort((left, right) => left - right)
  let currency = 0
  let next = 0
  return rewards.map((reward) => {
    currency += reward
    let spent = 0
    while (next < queue.length && currency >= queue[next]) {
      currency -= queue[next]
      spent += queue[next]
      next += 1
    }
    return spent
  })
}

test('signal 1: profile currency has somewhere to go past run five, and used not to', () => {
  // Rewards from real runs rather than from a guess: the same scripted arm the second
  // signal is measured on, scored with the shipped reward function.
  const rewards = sweep('seeded', FULL_POOL).map((report) =>
    computeRunCompletionReward({
      status: report.outcome === 'victory' ? 'victory' : 'defeat',
      kills: report.kills,
      objectivesCompleted: report.objectivesCompleted,
    }),
  )
  assert.ok(rewards.length >= 12, 'the meta-loop needs more than five runs to be inert in')

  const boonCosts: number[] = BOON_CATALOGUE.map((boon) => boon.unlockCost)
  const doctrineCosts: number[] = DOCTRINE_CATALOGUE.map((doctrine) => doctrine.unlockCost)

  const before = currencySpentByRun(boonCosts, rewards)
  const after = currencySpentByRun([...boonCosts, ...doctrineCosts], rewards)

  const pastFive = (spent: readonly number[]): number =>
    spent.slice(5).reduce((total, value) => total + value, 0)

  // The measured diagnosis, reproduced: the boon shelf is bought out inside five runs and
  // then currency has nowhere to go at all.
  assert.equal(
    pastFive(before),
    0,
    'the boon shelf was supposed to be inert past run five',
  )
  assert.ok(
    before.slice(0, 5).reduce((total, value) => total + value, 0) > 0,
    'the boon shelf must be bought at all, or the comparison is meaningless',
  )
  // And the number this item exists to move.
  assert.ok(
    pastFive(after) > 0,
    'currency still has nowhere to go past run five',
  )
  assert.ok(
    pastFive(after) >= 150,
    `only ${String(pastFive(after))} currency spent past run five`,
  )
  // Not a stat: what the currency buys is a wider table, and the control below is what
  // turns that into a number.
  assert.ok(
    doctrineCosts.reduce((total, cost) => total + cost, 0) >=
      boonCosts.reduce((total, cost) => total + cost, 0),
    'the doctrine shelf should not be cheaper than the shelf it extends',
  )
})

// ---------------------------------------------------------------------------
// Signal 2 — distinct equipped sets, and the control that keeps it honest
// ---------------------------------------------------------------------------

/**
 * The convergence control, and the reason it is the decisive number for this item.
 *
 * It enumerates every equipped set a seed can actually *reach* through the offer tree —
 * three drafts, every card on every table taken in turn. If that count is one, then a run
 * history full of "distinct" sets would be an accident of run *length* rather than of any
 * choice the player made, and the design has failed even though the headline number looks
 * healthy. A pool of three unlocked cards is exactly that case, by construction.
 */
function reachableEquippedSets(seed: number, pool: readonly string[]): Set<string> {
  const sets = new Set<string>()
  const walk = (equipped: readonly string[], draft: number): void => {
    if (draft >= MAX_EQUIPPED_DOCTRINES) {
      sets.add([...equipped].sort().join('+'))
      return
    }
    const offer = rollDoctrineOffer({ seed, draftIndex: draft, pool, equipped })
    if (offer.length === 0) {
      sets.add([...equipped].sort().join('+'))
      return
    }
    for (const card of offer) walk([...equipped, card], draft + 1)
  }
  walk([], 0)
  return sets
}

test('the convergence control: three unlocked cards make the draft a formality', () => {
  for (const seed of [SEED, 77_777, 12_345, 987_654]) {
    // Three unlocked, three slots: whichever way the offers fall, the run ends up holding
    // all three. The draft exists, and it is not a choice.
    assert.equal(
      reachableEquippedSets(seed, DEFAULT_DOCTRINE_IDS).size,
      1,
      `seed ${String(seed)}: a three-card pool should converge`,
    )
    // The full shelf is what currency buys, and it is the difference between a formality
    // and a build.
    assert.ok(
      reachableEquippedSets(seed, FULL_POOL).size >= 10,
      `seed ${String(seed)}: the full pool should reach many builds`,
    )
  }
})

/** One scripted arm, memoised: the harness is the expensive part of this file. */
const SWEEPS = new Map<string, RunReport[]>()

/**
 * A player who takes rumours on, chooses which arm of the fork to do first and lets one
 * contract lapse behind them — which is the arm that actually lasts long enough to meet the
 * anchors. The `beeline` default finishes a campaign in about 131 simulated seconds against
 * a first anchor at 180, and the harness says of itself that its travel times are lower
 * bounds, so measuring the draft on it would be measuring the harness's optimism.
 */
function sweep(policy: DoctrinePolicy, pool: readonly string[]): RunReport[] {
  const key = `${policy}:${pool.join('+')}`
  const cached = SWEEPS.get(key)
  if (cached) return cached
  const factions = ['elf', 'guard', 'villain'] as const
  const reports: RunReport[] = []
  for (let index = 0; index < 15; index += 1) {
    reports.push(
      runHarness({
        seed: 900_100 + index * 7919,
        faction: factions[index % 3],
        policy: 'cautious',
        hz: 30,
        rumourPolicy: 'commit',
        contractPolicy: 'seeded',
        contractOutcome: 'shirk',
        doctrinePolicy: policy,
        doctrinePool: pool,
      }),
    )
  }
  SWEEPS.set(key, reports)
  return reports
}

function distinctSets(reports: readonly RunReport[]): number {
  return new Set(
    reports.map((report) => [...report.doctrines.equipped].sort().join('+')),
  ).size
}

test('signal 2: a run history holds distinct equipped sets, and the placebo holds one', () => {
  const treatment = sweep('seeded', FULL_POOL)
  const placebo = sweep('none', FULL_POOL)

  // The anchors are actually met, or nothing below is about the draft.
  const drafts = treatment.reduce((total, report) => total + report.doctrines.draftsOpened, 0)
  assert.ok(
    drafts / treatment.length >= 1,
    `only ${(drafts / treatment.length).toFixed(2)} anchors crossed per run`,
  )
  assert.ok(
    treatment.some((report) => report.doctrines.equipped.length >= 2),
    'no run drafted twice',
  )

  // The cap, observed over a whole sweep rather than in a unit test.
  for (const report of [...treatment, ...placebo]) {
    assert.ok(
      report.doctrines.equipped.length <= MAX_EQUIPPED_DOCTRINES,
      'a run equipped more than the cap',
    )
    assert.equal(report.doctrines.capBreaches, 0, 'the cap refused a card it should not have')
    assert.equal(
      new Set(report.doctrines.equipped).size,
      report.doctrines.equipped.length,
      'a run equipped the same card twice',
    )
    for (const id of report.doctrines.equipped) {
      assert.ok(report.doctrines.pool.includes(id), 'a run equipped a card outside its pool')
    }
  }

  // The number.
  const distinct = distinctSets(treatment)
  assert.ok(distinct >= 8, `only ${String(distinct)} distinct equipped sets in 15 runs`)

  // The placebo. Same anchors, same offers computed, nothing taken — so if the treatment's
  // spread came from crossing tiers rather than from drafting, this arm would show it.
  assert.equal(distinctSets(placebo), 1)
  assert.ok(
    placebo.every((report) => report.doctrines.equipped.length === 0),
    'the placebo drafted something',
  )
  assert.ok(
    placebo.every((report) => report.doctrines.offers.length <= 1),
    'an unanswered offer should stay the same offer rather than stack',
  )
  assert.ok(
    placebo.reduce((total, report) => total + report.doctrines.draftsOpened, 0) > 0,
    'the placebo never reached an anchor, so it is not a placebo',
  )

  // And a run that drafts still finishes. A doctrine may never make a campaign
  // unfinishable, so the arm has to keep producing victories.
  assert.ok(
    treatment.filter((report) => report.outcome === 'victory').length >= 8,
    'the drafting arm stopped finishing runs',
  )
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function terminalRun(doctrines: ReturnType<typeof createDoctrineRunState>): ActiveRunSaveV3 {
  return {
    version: 3,
    runId: 'run-doctrines',
    config: {
      seed: SEED,
      generatorVersion: 1,
      faction: 'elf',
      selectedBoonId: 'provisions',
    },
    status: 'victory',
    startedAt: '2026-07-30T10:00:00.000Z',
    updatedAt: '2026-07-30T10:19:00.000Z',
    blueprintFingerprint: 'wg1-deadbeefdeadbeef',
    rulesetFingerprint: computeRunRulesetFingerprint({
      seed: SEED,
      generatorVersion: 1,
      faction: 'elf',
      selectedBoonId: 'provisions',
      doctrines: doctrines.equipped,
    }),
    currentLocation: {
      regionId: 'region-2-1',
      localPosition: [1, 0, 1],
      worldPosition: [10, 0, 10],
      heading: 0,
    },
    player: {
      health: 60,
      maxHealth: 100,
      stamina: 70,
      maxStamina: 100,
      gold: 80,
      kills: 12,
      damage: 26,
      body: {
        leftArm: 'healthy',
        rightArm: 'healthy',
        leftLeg: 'healthy',
        rightLeg: 'healthy',
        leftEye: 'healthy',
        rightEye: 'healthy',
        bleeding: 0,
      },
      objectives: [{ id: 'reach', text: 'Дойти', done: true }],
      upgrades: { blade: 0, vitality: 0, endurance: 0 },
    },
    discoveredRegionIds: ['region-0-0', 'region-2-1'],
    regionDeltas: {},
    directorState: {
      elapsed: 640,
      doctrines: serializeDoctrineRunState(doctrines) as never,
    },
    eventState: {},
    chronicleState: {
      tick: 12,
      factionStrength: { elf: 0.5, guard: 0.5, villain: 0.5 },
      caravans: [],
      log: [],
    },
    rngStates: {},
    achievementRunState: {
      runId: 'run-doctrines',
      faction: 'elf',
      startedAt: '2026-07-30T10:00:00.000Z',
      kills: 12,
      killsSinceDamage: 0,
      bestKillStreak: 4,
      damageTaken: 60,
      injuries: 0,
      limbsLost: 0,
      goldEarned: 120,
      purchases: 1,
      objectivesCompleted: 1,
      eventsCompleted: 2,
      abilitiesUsed: 3,
      shieldBlocks: 0,
      squadCommands: 1,
      caravansRobbed: 1,
      zonesVisited: ['forest'],
      eventKindsCompleted: [],
      unlockedIds: [],
      result: 'victory',
      elapsedAtEnd: 640,
      healthAtEnd: 60,
    },
  }
}
