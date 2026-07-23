import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createGeneratedObjectiveText,
  formatRussianCount,
} from '../src/game/content/gameCopy.ts'
import { SITE_PRESENTATIONS } from '../src/game/content/registry.ts'
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
