import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chronicleEventTone,
  createGeneratedObjectiveText,
  describeChronicleEvent,
  formatRegionGridLabel,
  formatRussianCount,
} from '../src/game/content/gameCopy.ts'
import { SITE_PRESENTATIONS } from '../src/game/content/registry.ts'
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
  assert.equal(chronicleEventTone('beastRaid'), 'warning')
  assert.equal(chronicleEventTone('settlementBurned'), 'danger')
  assert.equal(chronicleEventTone('caravanLost'), 'danger')
})
