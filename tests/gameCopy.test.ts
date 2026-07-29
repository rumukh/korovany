import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  chronicleEventTone,
  createGeneratedObjectiveText,
  describeCaravanRobbed,
  describeChampionDefeated,
  describeChronicleEvent,
  describeEventHandback,
  describeHint,
  describeKillReward,
  describeLimbLost,
  describeLocatedEvent,
  describeLocatedEventOutcome,
  describeLocatedEventStart,
  describeRationEaten,
  describeRazedSite,
  describeSquadOrder,
  describeThreatTier,
  describeThreatWave,
  describeTreasureFound,
  describeWound,
  describeZoneDiscovered,
  formatRegionGridLabel,
  formatRussianCount,
  HINT_IDS,
  isHintId,
  WORLD_EVENT_FAILURE_MESSAGES,
} from '../src/game/content/gameCopy.ts'
import { SITE_PRESENTATIONS } from '../src/game/content/registry.ts'
import {
  CHRONICLE_WORLD_EVENT_KINDS,
  RANDOM_WORLD_EVENT_KINDS,
} from '../src/game/types.ts'
import type { ChronicleEventKind } from '../src/game/world/Chronicle.ts'
import type {
  ObjectiveKind,
  SiteKind,
} from '../src/game/world/worldTypes.ts'

const objectiveKinds = [
  'arrive',
  'interact',
  'claim',
  'defeat',
] as const satisfies readonly ObjectiveKind[]

const siteKinds = Object.keys(SITE_PRESENTATIONS) as SiteKind[]

test('every generated objective and site combination forms a complete sentence', () => {
  const sentenceFor = {
    arrive: (label: string) => `Добраться до точки «${label}»`,
    interact: (label: string) => `Осмотреть точку «${label}»`,
    claim: (label: string) => `Забрать награду в точке «${label}»`,
    defeat: (label: string) => `Победить врагов у точки «${label}»`,
  } satisfies Record<ObjectiveKind, (label: string) => string>

  for (const objectiveKind of objectiveKinds) {
    for (const siteKind of siteKinds) {
      assert.equal(
        createGeneratedObjectiveText(objectiveKind, siteKind),
        sentenceFor[objectiveKind](SITE_PRESENTATIONS[siteKind].label),
      )
    }
  }
})

test('generated objectives remain grammatical when site metadata is unavailable', () => {
  assert.deepEqual(
    objectiveKinds.map((kind) => createGeneratedObjectiveText(kind)),
    [
      'Добраться до цели',
      'Осмотреть цель',
      'Забрать награду',
      'Победить врагов у цели',
    ],
  )
})

test('Russian count forms handle singular, paucal, plural, and teen endings', () => {
  const forms = ['враг', 'врага', 'врагов'] as const
  assert.deepEqual(
    [0, 1, 2, 4, 5, 11, 14, 21, 22, 25, 101, 112].map((count) =>
      formatRussianCount(count, forms),
    ),
    [
      '0 врагов',
      '1 враг',
      '2 врага',
      '4 врага',
      '5 врагов',
      '11 врагов',
      '14 врагов',
      '21 враг',
      '22 врага',
      '25 врагов',
      '101 враг',
      '112 врагов',
    ],
  )
})

const chronicleKinds = [
  'regionCaptured',
  'beastRaid',
  'settlementBurned',
  'caravanLost',
  'caravanArrived',
] as const satisfies readonly ChronicleEventKind[]

test('region grid labels read as map squares', () => {
  assert.deepEqual(
    [
      formatRegionGridLabel(0, 0),
      formatRegionGridLabel(2, 2),
      formatRegionGridLabel(1, 1),
      formatRegionGridLabel(4, 4),
    ],
    ['A1', 'C3', 'B2', 'E5'],
  )
})

test('chronicle copy is deterministic, censored, and names the map square', () => {
  const banned = /\b(бля|хер|нах|сука)/i
  for (const kind of chronicleKinds) {
    for (const variant of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
      const context = {
        kind,
        regionLabel: 'C3',
        faction: 'guard' as const,
        siteLabel: 'Домики деревяные',
      }
      const text = describeChronicleEvent(context, variant)
      assert.equal(describeChronicleEvent(context, variant), text)
      assert.ok(text.length > 20, `${kind}/${variant} is too terse: ${text}`)
      assert.equal(banned.test(text), false, `${kind}/${variant} is not censored`)
      assert.ok(/[.!?]$/.test(text), `${kind}/${variant} is not a full sentence`)
    }
  }

  const squares = chronicleKinds.map((kind) =>
    describeChronicleEvent(
      { kind, regionLabel: 'B2', faction: 'elf', siteLabel: 'Лавка' },
      'square-check',
    ),
  )
  assert.ok(squares.every((text) => text.includes('B2') || text.includes('Лавка')))
})

test('chronicle copy survives missing faction and site metadata', () => {
  for (const kind of chronicleKinds) {
    const text = describeChronicleEvent(
      { kind, regionLabel: 'A1', faction: null, siteLabel: null },
      `${kind}:bare`,
    )
    assert.equal(text.includes('null'), false)
    assert.equal(text.includes('undefined'), false)
  }
})

test('chronicle tones escalate with how much the news hurts', () => {
  assert.equal(chronicleEventTone('caravanArrived'), 'info')
  assert.equal(chronicleEventTone('regionCaptured'), 'warning')
  assert.equal(chronicleEventTone('raidRepelled'), 'success')
  assert.equal(chronicleEventTone('beastRaid'), 'warning')
  assert.equal(chronicleEventTone('settlementBurned'), 'danger')
  assert.equal(chronicleEventTone('caravanLost'), 'danger')
})

test('every located event kind has a full set of censored Russian copy', () => {
  const banned = /\b(бля|хер|нах|сука)/i
  const context = {
    regionLabel: 'C3',
    siteLabel: 'Домики деревяные',
    faction: 'villain' as const,
    defender: 'guard' as const,
  }
  for (const kind of CHRONICLE_WORLD_EVENT_KINDS) {
    const copy = describeLocatedEvent(kind, context)
    const lines = [
      copy.title,
      copy.description,
      describeLocatedEventStart(kind, context),
      describeLocatedEventOutcome(kind, true, context),
      describeLocatedEventOutcome(kind, false, context),
    ]
    for (const line of lines) {
      assert.ok(line.length > 0, `${kind} has an empty line`)
      assert.equal(line.includes('null'), false, `${kind}: ${line}`)
      assert.equal(line.includes('undefined'), false, `${kind}: ${line}`)
      assert.equal(banned.test(line), false, `${kind} is not censored: ${line}`)
    }
    assert.ok(/[.!?]$/.test(copy.description), `${kind} description is not a sentence`)
    assert.ok(copy.title.length <= 24, `${kind} title is too long for the banner`)
  }
})

test('located event copy survives missing faction and site metadata', () => {
  const bare = {
    regionLabel: 'A1',
    siteLabel: null,
    faction: null,
    defender: null,
  }
  for (const kind of CHRONICLE_WORLD_EVENT_KINDS) {
    for (const line of [
      describeLocatedEvent(kind, bare).description,
      describeLocatedEventStart(kind, bare),
      describeLocatedEventOutcome(kind, true, bare),
      describeLocatedEventOutcome(kind, false, bare),
    ]) {
      assert.equal(line.includes('null'), false, `${kind}: ${line}`)
      assert.equal(line.includes('undefined'), false, `${kind}: ${line}`)
    }
  }
})

test('walking away from a materialized fight points at the chronicle, not a cancel', () => {
  const text = describeEventHandback('D4')
  assert.ok(text.includes('D4'))
  assert.ok(text.includes('хроник'))
})

test('every player-anchored event kind has a failure line', () => {
  for (const kind of RANDOM_WORLD_EVENT_KINDS) {
    const line = WORLD_EVENT_FAILURE_MESSAGES[kind]
    assert.ok(line && line.length > 10, `${kind} has no failure line`)
    assert.ok(/[.!?]$/.test(line), `${kind} failure line is not a sentence`)
  }
})

// ---------------------------------------------------------------------------
// Diegetic first-time lines
// ---------------------------------------------------------------------------

test('every hint is a censored Russian sentence that fits the notice stack', () => {
  const banned = /\b(бля|хер|нах|сука)/i
  const tones = new Set(['info', 'success', 'warning', 'danger'])

  // A floor first: an empty catalogue would satisfy every assertion in the loop.
  assert.ok(HINT_IDS.length >= 12, `only ${String(HINT_IDS.length)} hints exist`)

  for (const id of HINT_IDS) {
    const { text, tone } = describeHint(id)
    assert.ok(/[А-Яа-яЁё]/.test(text), `${id} is not written in Russian: ${text}`)
    assert.ok(text.length > 40, `${id} is too terse to teach anything: ${text}`)
    // Long enough to say something, short enough to be read before the notice expires.
    assert.ok(text.length <= 190, `${id} will not be read in 4.3 s: ${text}`)
    assert.ok(/[.!?]$/.test(text), `${id} is not a full sentence: ${text}`)
    assert.equal(banned.test(text), false, `${id} is not censored: ${text}`)
    assert.equal(text.includes('undefined'), false, `${id}: ${text}`)
    assert.ok(tones.has(tone), `${id} has no notice tone`)
  }
})

test('no two hints teach the same line', () => {
  const lines = HINT_IDS.map((id) => describeHint(id).text)
  assert.equal(new Set(lines).size, lines.length, 'a hint line is duplicated')
})

test('hint ids are recognised by id, not by shape', () => {
  for (const id of HINT_IDS) assert.equal(isHintId(id), true, `${id} is not recognised`)
  // Negative control: the guard has to reject something, including inherited keys.
  assert.equal(isHintId('tutorial'), false)
  assert.equal(isHintId('toString'), false)
  assert.equal(isHintId(''), false)
  assert.equal(isHintId(null), false)
})

// ---------------------------------------------------------------------------
// The engine's own notices
// ---------------------------------------------------------------------------

test('no notice in GameEngine.ts carries its own copy', () => {
  // The roadmap's other half: the engine-side `onNotice` strings belong here, not welded
  // into a 14,000-line file. This is what keeps the next one from being written inline.
  const source = readFileSync(
    new URL('../src/game/GameEngine.ts', import.meta.url),
    'utf8',
  )
  const calls = [...source.matchAll(/callbacks\.onNotice\(\s*(.)/g)]

  // Floor: a regex that matches nothing would pass the assertion below happily.
  assert.ok(calls.length >= 30, `only ${String(calls.length)} notice sites found`)
  const inline = calls.filter(([, first]) => first === "'" || first === '`' || first === '"')
  assert.deepEqual(inline.map(([match]) => match), [])

  // And the same for the wrapped form, where the literal starts on the next line.
  const wrapped = [...source.matchAll(/callbacks\.onNotice\(\s*\n\s*(.)/g)].filter(
    ([, first]) => first === "'" || first === '`' || first === '"',
  )
  assert.deepEqual(wrapped.map(([match]) => match), [])
})

test('moved notices name the amount the engine actually awarded', () => {
  // The numbers used to be baked into the sentence next to the line that granted them.
  // As parameters they cannot drift apart silently, so the pairing is pinned here.
  assert.ok(describeCaravanRobbed(95).includes('+95 золота'))
  assert.ok(describeTreasureFound(41).includes('41 золота'))
  assert.ok(describeRationEaten(35).includes('35 здоровья'))
  assert.ok(describeKillReward('beast', 12).includes('+12 золота'))
  assert.ok(describeKillReward('soldier', 7).includes('+7 золота'))
  assert.equal(describeKillReward('commander', 7).includes('золота'), false)
  assert.ok(describeChampionDefeated(4).includes('+4 к урону'))
  assert.ok(describeChampionDefeated(0).includes('предела'))
  assert.equal(describeChampionDefeated(0).includes('+0'), false)
  assert.equal(describeThreatTier(3, 5), 'Угроза растёт: уровень 3/5. Враги сильнее, событий и набегов больше.')
  assert.ok(describeThreatWave(1, 2).includes('1 враг.'))
  assert.ok(describeThreatWave(3, 2).includes('3 врага'))
  assert.ok(describeThreatWave(5, 2).includes('5 врагов'))
})

test('moved notices still differ per faction, per site and per body part', () => {
  const orders = (['elf', 'guard', 'villain'] as const).map((faction) => [
    describeSquadOrder(faction, true),
    describeSquadOrder(faction, false),
  ])
  assert.equal(new Set(orders.flat()).size, 6, 'a faction lost its own squad line')

  assert.notEqual(describeRazedSite('shop'), describeRazedSite('recovery'))
  assert.notEqual(describeZoneDiscovered('forest'), describeZoneDiscovered('fort'))
  assert.ok(describeLimbLost('leftEye').includes('пол-экрана'))
  assert.ok(describeLimbLost('leftArm').includes('протез'))
  assert.equal(describeLimbLost('leftArm').includes('пол-экрана'), false)
  assert.ok(describeWound('rightLeg').includes('правая нога'))
})

