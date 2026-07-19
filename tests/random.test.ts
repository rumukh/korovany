import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import {
  deriveSeed,
  hashString32,
  keyedRandom,
  keyedUint32,
  parseSeed,
} from '../src/game/random/seed.ts'

test('seed parsing and hashing are stable nonzero uint32 operations', () => {
  assert.equal(hashString32('hello'), 0x4f9f2cab)
  assert.equal(hashString32('korovan'), hashString32('korovan'))
  assert.notEqual(hashString32('korovan'), hashString32('Korovan'))

  assert.equal(parseSeed(123456), parseSeed('123456'))
  assert.equal(parseSeed(-1), 0xffff_ffff)
  assert.equal(parseSeed('4294967297'), 1)
  assert.ok(parseSeed(0) > 0)
  assert.ok(parseSeed('0') > 0)
  assert.ok(parseSeed('a named campaign') > 0)
  assert.ok(parseSeed('a named campaign') <= 0xffff_ffff)
  assert.throws(() => parseSeed(Number.NaN), /finite/)
})

test('named derivation and keyed random values are reproducible and isolated', () => {
  const root = parseSeed('isolation')
  assert.equal(deriveSeed(root, 'terrain'), deriveSeed(root, 'terrain'))
  assert.notEqual(deriveSeed(root, 'terrain'), deriveSeed(root, 'roads'))
  assert.equal(keyedUint32(root, 'site:shop'), keyedUint32(root, 'site:shop'))
  assert.equal(keyedRandom(root, 'site:shop'), keyedUint32(root, 'site:shop') / 0x1_0000_0000)

  const terrainBefore = new RandomStream(deriveSeed(root, 'terrain'))
  const expectedTerrain = Array.from({ length: 12 }, () => terrainBefore.nextUint32())

  const roads = new RandomStream(deriveSeed(root, 'roads'))
  for (let index = 0; index < 1000; index += 1) roads.next()

  const terrainAfter = new RandomStream(deriveSeed(root, 'terrain'))
  assert.deepEqual(
    Array.from({ length: 12 }, () => terrainAfter.nextUint32()),
    expectedTerrain,
  )
})

test('RandomStream methods reproduce exactly from the same seed', () => {
  const sample = (stream: RandomStream) => ({
    uint32: stream.nextUint32(),
    unit: stream.next(),
    integer: stream.integer(-20, 21),
    range: stream.range(-3.5, 8.25),
    chance: stream.chance(0.37),
    pick: stream.pick(['elf', 'guard', 'villain'] as const),
    shuffle: stream.shuffle([1, 2, 3, 4, 5]),
  })

  const first = new RandomStream('repeatable')
  const second = new RandomStream('repeatable')
  assert.deepEqual(sample(first), sample(second))
  assert.notDeepEqual(sample(first), sample(new RandomStream('another-seed')))
})

test('RandomStream state snapshots serialize and restore without drift', () => {
  const stream = new RandomStream('stateful')
  for (let index = 0; index < 7; index += 1) stream.next()

  const snapshot = JSON.parse(JSON.stringify(stream.snapshot())) as { state: number }
  const expected = Array.from({ length: 16 }, () => stream.nextUint32())
  stream.restore(snapshot)
  assert.deepEqual(
    Array.from({ length: 16 }, () => stream.nextUint32()),
    expected,
  )

  const restored = RandomStream.fromState(snapshot.state)
  assert.equal(restored.state, snapshot.state)
  assert.deepEqual(
    Array.from({ length: 8 }, () => restored.nextUint32()),
    expected.slice(0, 8),
  )

  restored.setState(0)
  assert.equal(restored.getState(), 0)
  assert.throws(() => restored.setState(-1), /uint32/)
  assert.throws(() => restored.integer(4, 4), /bounds/)
  assert.throws(() => restored.pick([]), /empty/)
})
