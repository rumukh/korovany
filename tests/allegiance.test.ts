import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALLEGIANCES,
  ALLEGIANCE_RELATIONS,
  allegianceRelation,
  areAllegiancesHostile,
  isFactionAllegiance,
  type Allegiance,
} from '../src/game/types.ts'
import { WORLD_FACTIONS } from '../src/game/world/worldTypes.ts'

const NON_FACTIONS: Allegiance[] = ['beast', 'civilian']

test('the relation matrix is total: every allegiance has a row and a column', () => {
  assert.deepEqual(
    [...ALLEGIANCES].sort(),
    [...WORLD_FACTIONS, ...NON_FACTIONS].sort(),
  )
  for (const left of ALLEGIANCES) {
    const row = ALLEGIANCE_RELATIONS[left]
    assert.ok(row, `missing row for ${left}`)
    for (const right of ALLEGIANCES) {
      assert.ok(
        ['hostile', 'neutral', 'friendly'].includes(row[right]),
        `${left} → ${right} is not a relation`,
      )
    }
  }
})

test('nothing is hostile to itself and the matrix is symmetric', () => {
  for (const allegiance of ALLEGIANCES) {
    assert.equal(allegianceRelation(allegiance, allegiance), 'friendly')
  }
  for (const left of ALLEGIANCES) {
    for (const right of ALLEGIANCES) {
      assert.equal(
        allegianceRelation(left, right),
        allegianceRelation(right, left),
        `${left}/${right} disagree`,
      )
    }
  }
})

test('the three playable sides still hate each other exactly as before', () => {
  // The behaviour the old `hostile(a, b) => a !== b` encoded must be preserved for the
  // factions; the matrix only adds rows it could not express.
  for (const left of WORLD_FACTIONS) {
    for (const right of WORLD_FACTIONS) {
      assert.equal(
        areAllegiancesHostile(left, right),
        left !== right,
        `${left} vs ${right} changed`,
      )
    }
  }
})

test('beasts are hostile to all three factions and to civilians, by matrix not accident', () => {
  for (const faction of WORLD_FACTIONS) {
    assert.equal(allegianceRelation('beast', faction), 'hostile')
    assert.equal(allegianceRelation(faction, 'beast'), 'hostile')
  }
  assert.equal(allegianceRelation('beast', 'civilian'), 'hostile')
  // Other beasts are pack, not prey: a wolf raid must not eat itself.
  assert.equal(allegianceRelation('beast', 'beast'), 'friendly')
})

test('civilians are nobody\u2019s enemy except the forest', () => {
  for (const faction of WORLD_FACTIONS) {
    assert.equal(allegianceRelation('civilian', faction), 'neutral')
    assert.equal(areAllegiancesHostile('civilian', faction), false)
  }
  assert.equal(allegianceRelation('civilian', 'beast'), 'hostile')
})

test('a faction is friendly only with itself', () => {
  for (const faction of WORLD_FACTIONS) {
    const friends = ALLEGIANCES.filter(
      (other) => allegianceRelation(faction, other) === 'friendly',
    )
    assert.deepEqual(friends, [faction])
  }
})

test('the faction narrowing agrees with the matrix rows', () => {
  for (const allegiance of ALLEGIANCES) {
    assert.equal(
      isFactionAllegiance(allegiance),
      (WORLD_FACTIONS as readonly string[]).includes(allegiance),
    )
  }
})
