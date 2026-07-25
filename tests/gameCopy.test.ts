import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chronicleEventTone,
  createGeneratedObjectiveText,
  describeChronicleEvent,
  describeEventHandback,
  describeLocatedEvent,
  describeLocatedEventOutcome,
  describeLocatedEventStart,
  formatRegionGridLabel,
  formatRussianCount,
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
