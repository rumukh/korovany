import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CollisionWorld,
  type Collider,
} from '../src/game/systems/CollisionWorld.ts'
import {
  CombatLineOfSight,
  MAX_COMBAT_LOS_QUERIES_PER_FRAME,
  firstSolidCoverHit,
} from '../src/game/world/CombatLineOfSight.ts'

const start = { x: 0, z: 0 }
const target = { x: 0, z: 4 }

test('solid circles and rotated boxes block; water, foliage, soft and non-blocking shapes do not', () => {
  const blockers: Collider[] = [
    {
      id: 'circle',
      regionId: 'arena',
      shape: 'circle',
      x: 0,
      z: 2,
      radius: 0.5,
    },
    {
      id: 'rotated',
      regionId: 'arena',
      shape: 'box',
      x: 0,
      z: 3,
      halfWidth: 1,
      halfDepth: 0.2,
      rotation: Math.PI / 4,
    },
  ]
  assert.equal(firstSolidCoverHit(start, target, blockers), 0.375)
  assert.ok(firstSolidCoverHit(start, target, [blockers[1]]) !== null)
  for (const collider of [
    { ...blockers[0], tags: ['water'] },
    { ...blockers[0], tags: ['foliage'] },
    { ...blockers[0], tags: ['soft'] },
    { ...blockers[0], blocksMovement: false },
    { ...blockers[0], enabled: false },
  ]) {
    assert.equal(firstSolidCoverHit(start, target, [collider]), null)
  }
  assert.throws(
    () => firstSolidCoverHit(start, target, blockers, -1),
    RangeError,
  )
})

test('ordinary melee admits a visible tangent but a full wall blocks all three rays', () => {
  const world = new CollisionWorld()
  world.registerCircle({
    id: 'corner',
    regionId: 'arena',
    x: 0,
    z: 2,
    radius: 0.1,
  })
  const lineOfSight = new CombatLineOfSight(world)
  lineOfSight.beginFrame()
  assert.equal(
    lineOfSight.melee(start, target, 0.64, 'npcMelee').status,
    'clear',
    'the centre is clipped but a target-radius tangent is exposed',
  )
  assert.ok(
    firstSolidCoverHit(
      start,
      target,
      world.queryBounds({
        minX: -1,
        minZ: 0,
        maxX: 1,
        maxZ: 4,
      }),
    ) !== null,
    'centre-only admission is the negative control',
  )

  world.removeCollider('corner')
  world.registerBox({
    id: 'wall',
    regionId: 'arena',
    x: 0,
    z: 2,
    halfWidth: 1.5,
    halfDepth: 0.2,
  })
  lineOfSight.beginFrame()
  assert.equal(
    lineOfSight.melee(start, target, 0.64, 'npcMelee').status,
    'blocked',
  )
  assert.equal(
    lineOfSight.melee(start, target, 0.64, 'playerMelee').status,
    'blocked',
  )

  world.removeCollider('wall')
  lineOfSight.beginFrame()
  assert.equal(
    lineOfSight.melee(start, target, 0.64, 'npcMelee').status,
    'clear',
  )
})

class EmptyCollisionSource {
  revision = 1
  queries = 0

  queryBounds(): Collider[] {
    this.queries += 1
    return []
  }

  getDebugStats() {
    return {
      colliderCount: 0,
      bucketCount: 0,
      regionCount: 0,
      lastQueryCandidateCount: 0,
      revision: this.revision,
    }
  }
}

function uniqueSegment(index: number) {
  const x = index * 8
  return {
    start: { x, z: 0 },
    end: { x, z: 2 },
  }
}

test('the 64-query budget is NPC-only and every overflow path is explicit', () => {
  const collision = new EmptyCollisionSource()
  const lineOfSight = new CombatLineOfSight(collision)
  lineOfSight.beginFrame()
  for (
    let index = 0;
    index < MAX_COMBAT_LOS_QUERIES_PER_FRAME;
    index += 1
  ) {
    const segment = uniqueSegment(index)
    assert.equal(
      lineOfSight.segment(
        segment.start,
        segment.end,
        'npcArrow',
      ).status,
      'clear',
    )
  }
  const admission = uniqueSegment(100)
  assert.equal(
    lineOfSight.segment(
      admission.start,
      admission.end,
      'archerAdmission',
    ).status,
    'deferred',
  )
  const melee = uniqueSegment(101)
  assert.equal(
    lineOfSight.melee(
      melee.start,
      melee.end,
      0.64,
      'npcMelee',
    ).status,
    'blocked',
  )
  const arrow = uniqueSegment(102)
  assert.equal(
    lineOfSight.segment(
      arrow.start,
      arrow.end,
      'npcArrow',
    ).status,
    'blocked',
  )
  const player = uniqueSegment(103)
  assert.equal(
    lineOfSight.melee(
      player.start,
      player.end,
      0.64,
      'playerMelee',
    ).status,
    'clear',
    'the player is never denied by the NPC budget',
  )
  assert.deepEqual(lineOfSight.snapshot(), {
    npcBroadPhaseQueries: MAX_COMBAT_LOS_QUERIES_PER_FRAME,
    playerBroadPhaseQueries: 1,
    cacheHits: 0,
    archerDeferrals: 1,
    npcMeleeFailClosed: 1,
    npcArrowFailClosed: 1,
    resolverMilliseconds: 0,
  })
})

test('25 melee envelopes plus 27 projectiles stay below budget and reuse cached bounds', () => {
  const collision = new EmptyCollisionSource()
  const lineOfSight = new CombatLineOfSight(collision)
  lineOfSight.beginFrame()
  for (let index = 0; index < 25; index += 1) {
    const segment = uniqueSegment(index)
    assert.equal(
      lineOfSight.melee(
        segment.start,
        segment.end,
        0.64,
        'npcMelee',
      ).status,
      'clear',
    )
  }
  for (let index = 25; index < 52; index += 1) {
    const segment = uniqueSegment(index)
    assert.equal(
      lineOfSight.segment(
        segment.start,
        segment.end,
        'npcArrow',
      ).status,
      'clear',
    )
  }
  const repeated = uniqueSegment(51)
  assert.equal(
    lineOfSight.segment(
      repeated.start,
      repeated.end,
      'npcArrow',
    ).status,
    'clear',
  )
  const stats = lineOfSight.snapshot()
  assert.equal(stats.npcBroadPhaseQueries, 52)
  assert.equal(stats.cacheHits, 1)
  assert.equal(stats.archerDeferrals, 0)
  assert.equal(stats.npcMeleeFailClosed, 0)
  assert.equal(stats.npcArrowFailClosed, 0)
})
