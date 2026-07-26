import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import { BEAST_ROLES, isBeastRole, type BeastRole } from '../src/game/types.ts'
import { BEAST_RAID_THRESHOLD } from '../src/game/world/Chronicle.ts'
import {
  BEAST_PROFILES,
  planAmbientBeast,
  planBeastPack,
  shouldBeastRout,
} from '../src/game/world/Fauna.ts'

function rng(label: string): RandomStream {
  return new RandomStream(deriveSeed('fauna', label))
}

test('every beast role has a complete, sane profile', () => {
  for (const role of BEAST_ROLES) {
    const profile = BEAST_PROFILES[role]
    assert.equal(profile.role, role)
    assert.ok(profile.hp > 0 && profile.speed > 0 && profile.poise > 0)
    assert.ok(profile.meleeDamage > 0 && profile.colliderRadius > 0)
    assert.ok(profile.scale > 0)
    assert.ok(profile.routThreshold >= 0 && profile.routThreshold <= 1)
    assert.ok(isBeastRole(role))
  }
  // Roles have to actually differ, or "wolf" and "bear" are the same enemy in two hats.
  const speeds = new Set(BEAST_ROLES.map((role) => BEAST_PROFILES[role].speed))
  assert.equal(speeds.size, BEAST_ROLES.length)
  assert.ok(BEAST_PROFILES.wolf.speed > BEAST_PROFILES.bear.speed)
  assert.ok(BEAST_PROFILES.bear.hp > BEAST_PROFILES.wolf.hp)
  assert.ok(BEAST_PROFILES.troll.poise > BEAST_PROFILES.boar.poise)
})

test('only the wolf breaks: it is the one role with a rout threshold', () => {
  const routing = BEAST_ROLES.filter((role) => BEAST_PROFILES[role].routThreshold > 0)
  assert.deepEqual(routing, ['wolf'])
  assert.equal(shouldBeastRout('wolf', 1), false)
  assert.equal(shouldBeastRout('wolf', 0.67), false)
  assert.equal(shouldBeastRout('wolf', 0.34), true)
  assert.equal(shouldBeastRout('wolf', 0), true)
  for (const role of ['boar', 'bear', 'troll'] as BeastRole[]) {
    assert.equal(shouldBeastRout(role, 0), false, `${role} should never rout`)
  }
})

test('a raid always brings something that can wreck a building', () => {
  for (const biome of ['forest', 'fort', 'palace', 'neutral'] as const) {
    const plan = planBeastPack({
      beastPressure: BEAST_RAID_THRESHOLD,
      biome,
      rng: rng(`wrecker:${biome}`),
      maxCount: 3,
    })
    assert.ok(plan.roles.length > 0)
    // A troll haunts the mountains, a bear the woods; either way something with a
    // building-sized appetite leads.
    assert.equal(plan.roles[0], biome === 'fort' ? 'troll' : 'bear')
  }
})

test('the pack grows with pressure and is trimmed to the actor budget', () => {
  const quiet = planBeastPack({
    beastPressure: 0.5,
    biome: 'forest',
    rng: rng('quiet'),
    maxCount: 8,
  })
  const loud = planBeastPack({
    beastPressure: 1,
    biome: 'forest',
    rng: rng('loud'),
    maxCount: 8,
  })
  assert.ok(
    loud.roles.length > quiet.roles.length,
    `expected a louder forest to send more: ${loud.roles.length} vs ${quiet.roles.length}`,
  )
  assert.equal(quiet.trimmed, false)

  const squeezed = planBeastPack({
    beastPressure: 1,
    biome: 'forest',
    rng: rng('loud'),
    maxCount: 2,
  })
  assert.equal(squeezed.roles.length, 2)
  assert.equal(squeezed.trimmed, true)
  assert.deepEqual(squeezed.roles, loud.roles.slice(0, 2))

  const starved = planBeastPack({
    beastPressure: 1,
    biome: 'forest',
    rng: rng('loud'),
    maxCount: 0,
  })
  assert.deepEqual(starved.roles, [])
})

test('pack composition is seeded, so the same run replays the same pack', () => {
  const first = planBeastPack({
    beastPressure: 0.9,
    biome: 'forest',
    rng: rng('replay'),
    maxCount: 6,
  })
  const second = planBeastPack({
    beastPressure: 0.9,
    biome: 'forest',
    rng: rng('replay'),
    maxCount: 6,
  })
  assert.deepEqual(first.roles, second.roles)

  const other = planBeastPack({
    beastPressure: 0.9,
    biome: 'forest',
    rng: rng('different'),
    maxCount: 6,
  })
  // Negative control: if the plan ignored its stream, this would be equal too.
  const streams = new Set<string>()
  for (let index = 0; index < 40; index += 1) {
    streams.add(
      planBeastPack({
        beastPressure: 0.9,
        biome: 'forest',
        rng: rng(`spread-${index}`),
        maxCount: 6,
      }).roles.join(','),
    )
  }
  assert.ok(streams.size > 1, 'pack composition should vary across streams')
  assert.ok(other.roles.length > 0)
})

test('boars join in proportion to how loud the forest is', () => {
  const boarShare = (pressure: number): number => {
    let boars = 0
    let total = 0
    for (let index = 0; index < 200; index += 1) {
      const plan = planBeastPack({
        beastPressure: pressure,
        biome: 'forest',
        rng: rng(`boars-${pressure}-${index}`),
        maxCount: 6,
      })
      boars += plan.roles.filter((role) => role === 'boar').length
      total += plan.roles.length
    }
    return boars / total
  }
  const calm = boarShare(0.2)
  const loud = boarShare(1)
  // Measured, not asserted by vibes: at 0.2 pressure the boar roll is 9%, at 1.0 it is
  // 45%, over the escorts that are eligible for one.
  assert.ok(calm < 0.06, `a calm forest should be mostly wolves, boar share ${calm}`)
  assert.ok(loud > 0.2, `a loud forest should send boars, boar share ${loud}`)
  assert.ok(loud > calm * 3, `expected a strong gradient, got ${calm} → ${loud}`)
})

test('an ambient prowler is one beast, and a louder square sends the heavier one', () => {
  const roles = new Set<BeastRole>()
  for (let index = 0; index < 40; index += 1) {
    roles.add(planAmbientBeast(1, rng(`prowler-${index}`)))
  }
  assert.ok(roles.has('wolf'))
  assert.ok(roles.has('boar'))
  for (let index = 0; index < 40; index += 1) {
    assert.equal(planAmbientBeast(0, rng(`calm-prowler-${index}`)), 'wolf')
  }
})
