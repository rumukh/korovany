import assert from 'node:assert/strict'
import test from 'node:test'
import { RegionManager } from '../src/game/world/RegionManager.ts'
import { RegionRuntime } from '../src/game/world/RegionRuntime.ts'

function createFiveByFiveWorld() {
  const regions = []
  for (let z = 0; z < 5; z += 1) {
    for (let x = 0; x < 5; x += 1) {
      regions.push({
        id: `${x},${z}`,
        coordinate: { x, z },
        bounds: {
          minX: x * 10,
          maxX: (x + 1) * 10,
          minZ: z * 10,
          maxZ: (z + 1) * 10,
        },
        biomeId: `biome-${x}-${z}`,
        heightProfile: { baseHeight: 0, amplitude: 0 },
      })
    }
  }
  return {
    seed: 'manager-test',
    regionSize: 10,
    bounds: { minX: 0, maxX: 50, minZ: 0, maxZ: 50 },
    regions,
  }
}

test('region runtime owns resources, persists defensive deltas, and disposes once', () => {
  const blueprint = createFiveByFiveWorld().regions[0]
  let disposableCalls = 0
  let disposeCalls = 0
  const runtime = new RegionRuntime(
    blueprint as never,
    blueprint.id as never,
    { onDispose: () => {
      disposeCalls += 1
    } },
  )
  runtime.ownCollider('wall')
  runtime.ownActor('unique-actor')
  runtime.ownFx('dust')
  runtime.addDisposable(() => {
    disposableCalls += 1
  })
  assert.equal(runtime.transitionTo('simulated'), true)
  assert.equal(runtime.transitionTo('simulated'), false)

  const customState = { phase: 2, nested: ['safe'] }
  assert.equal(runtime.setDeltaValue('encounter', customState), true)
  runtime.markEncounterCleared('ambush')
  runtime.markActorDefeated('bandit')
  runtime.markPropRemoved('gate')
  runtime.markLootCollected('chest')
  runtime.markInteractionCompleted('shrine')
  runtime.markEventCompleted('storm')
  customState.phase = 99
  const extracted = runtime.extractDelta()
  assert.deepEqual(extracted.state.encounter, {
    phase: 2,
    nested: ['safe'],
  })
  assert.deepEqual(extracted.clearedEncounterIds, ['ambush'])
  extracted.defeatedActorIds.push('tampered')
  ;(extracted.state.encounter as { nested: string[] }).nested.push('tampered')
  assert.deepEqual(runtime.extractDelta().defeatedActorIds, ['bandit'])
  assert.deepEqual(runtime.extractDelta().state.encounter, {
    phase: 2,
    nested: ['safe'],
  })
  assert.equal(
    runtime.applyDelta({ ...runtime.extractDelta(), regionId: 'other' }),
    false,
  )

  runtime.dispose()
  runtime.dispose()
  assert.equal(disposableCalls, 1)
  assert.equal(disposeCalls, 1)
  assert.equal(runtime.state, 'unloaded')
  assert.deepEqual(runtime.getOwnershipSnapshot().actors, [])
})

test('region runtime completes cleanup when transition and disposal hooks throw', () => {
  const blueprint = createFiveByFiveWorld().regions[0]
  let disposableCalls = 0
  let disposeCalls = 0
  const runtime = new RegionRuntime(
    blueprint as never,
    blueprint.id as never,
    {
      onTransition: (_runtime, _previous, next) => {
        if (next === 'unloaded') throw new Error('transition failed')
      },
      onDispose: () => {
        disposeCalls += 1
        throw new Error('dispose hook failed')
      },
    },
  )
  runtime.addDisposable(() => {
    disposableCalls += 1
  })
  runtime.ownActor('rescued-companion')
  runtime.transitionTo('simulated')

  assert.throws(() => runtime.dispose(), AggregateError)
  assert.equal(disposableCalls, 1)
  assert.equal(disposeCalls, 1)
  assert.deepEqual(runtime.getOwnershipSnapshot().actors, [])
  assert.doesNotThrow(() => runtime.dispose())
})

test('manager disposes every runtime when one region cleanup throws', () => {
  const world = createFiveByFiveWorld()
  let created = 0
  let disposed = 0
  const manager = new RegionManager(
    world as never,
    (blueprint, context) => {
      created += 1
      const runtime = new RegionRuntime(blueprint, context.regionId, {
        onTransition: (_region, _previous, next) => {
          if (next === 'unloaded' && String(context.regionId) === '2,2') {
            throw new Error('region transition failed')
          }
        },
        onDispose: () => {
          disposed += 1
        },
      })
      return runtime
    },
  )
  manager.update('2,2' as never)

  assert.throws(() => manager.dispose(), AggregateError)
  assert.equal(disposed, created)
  assert.equal(manager.isDisposed, true)
  assert.equal(manager.getRuntime('2,2' as never), undefined)
  assert.doesNotThrow(() => manager.dispose())
})

test('failed unload removes the disposed runtime and keeps the manager usable', () => {
  const world = createFiveByFiveWorld()
  let zeroRegionInstances = 0
  const manager = new RegionManager(
    world as never,
    (blueprint, context) => {
      if (String(context.regionId) === '0,0') zeroRegionInstances += 1
      return new RegionRuntime(blueprint, context.regionId, {
        onDispose: () => {
          if (String(context.regionId) === '0,0') {
            throw new Error('cleanup failed')
          }
        },
      })
    },
    { visibleRadius: 0, simulationRadius: 0 },
  )
  manager.update('0,0' as never)

  assert.throws(() => manager.update('1,0' as never), AggregateError)
  assert.equal(manager.getRuntime('0,0' as never), undefined)
  assert.ok(manager.getRuntime('1,0' as never))
  assert.doesNotThrow(() => manager.update('0,0' as never))
  assert.equal(zeroRegionInstances, 2)

  assert.throws(() => manager.dispose(), AggregateError)
})

test('failed incoming activation rolls back newly created runtimes', () => {
  const world = createFiveByFiveWorld()
  const disposed: string[] = []
  let created = 0
  const manager = new RegionManager(
    world as never,
    (blueprint, context) => {
      created += 1
      if (created === 5) throw new Error('factory failed')
      return new RegionRuntime(blueprint, context.regionId, {
        onDispose: () => disposed.push(String(context.regionId)),
      })
    },
  )

  assert.throws(() => manager.update('2,2' as never), AggregateError)
  assert.deepEqual(manager.getVisibleRegionIds(), [])
  assert.deepEqual(manager.getSimulatedRegionIds(), [])
  assert.equal(manager.currentRegionId, undefined)
  assert.equal(disposed.length, 4)
  for (const regionId of ['1,1', '2,1', '3,1', '1,2']) {
    assert.equal(manager.getRuntime(regionId as never), undefined)
  }
  assert.doesNotThrow(() => manager.dispose())
})

test('manager streams deterministic 3x3 visibility and cardinal simulation neighborhoods', () => {
  const world = createFiveByFiveWorld()
  const events: string[] = []
  let serial = 0
  const disposeCounts = new Map<number, number>()
  const manager = new RegionManager(
    world as never,
    (blueprint, context) => {
      serial += 1
      const instance = serial
      return new RegionRuntime(blueprint, context.regionId, {
        onTransition: (_runtime, previous, next) => {
          events.push(
            `${String(context.regionId)}#${instance}:${previous}->${next}`,
          )
        },
        onDispose: () => {
          disposeCounts.set(instance, (disposeCounts.get(instance) ?? 0) + 1)
        },
      })
    },
  )

  manager.update('2,2' as never, 1 / 60)
  assert.deepEqual(manager.getVisibleRegionIds(), [
    '1,1',
    '2,1',
    '3,1',
    '1,2',
    '2,2',
    '3,2',
    '1,3',
    '2,3',
    '3,3',
  ])
  assert.deepEqual(manager.getSimulatedRegionIds(), [
    '2,1',
    '1,2',
    '2,2',
    '3,2',
    '2,3',
  ])

  const center = manager.getRuntime('2,2' as never) as RegionRuntime
  center.setDeltaValue('encounter', { phase: 3 })
  manager.pinUniqueActor('3,3' as never, 'named-bandit')
  events.length = 0
  manager.update('0,0' as never)
  assert.deepEqual(manager.getVisibleRegionIds(), [
    '0,0',
    '1,0',
    '0,1',
    '1,1',
  ])
  assert.deepEqual(manager.getSimulatedRegionIds(), ['0,0', '1,0', '0,1'])
  assert.equal(manager.getRuntime('3,3' as never)?.state, 'dormant')
  assert.deepEqual(
    manager.getSavedDelta('2,2' as never)?.state.encounter,
    { phase: 3 },
  )

  const firstUnload = events.findIndex((entry) => entry.endsWith('->unloaded'))
  const incoming = events
    .slice(0, firstUnload)
    .filter((entry) => entry.includes('blueprint-only->simulated'))
    .map((entry) => entry.split('#')[0])
  assert.deepEqual(incoming, ['0,0', '1,0', '0,1'])
  assert.ok(firstUnload >= incoming.length)

  manager.update('2,2' as never)
  const restored = manager.getRuntime('2,2' as never) as RegionRuntime
  assert.notEqual(restored, center)
  assert.deepEqual(restored.getDeltaValue('encounter'), { phase: 3 })

  manager.unpinRegion('3,3' as never, 'actor:named-bandit')
  manager.update('0,0' as never)
  assert.equal(manager.getRuntime('3,3' as never), undefined)
  assert.equal(manager.getLifecycleSnapshot('3,3' as never)?.state, 'unloaded')

  manager.dispose()
  manager.dispose()
  assert.ok([...disposeCounts.values()].every((count) => count === 1))
})

test('manager save state restores discovered regions and deltas before activation', () => {
  const world = createFiveByFiveWorld()
  const first = new RegionManager(world as never)
  first.update('4,4' as never)
  const runtime = first.getRuntime('4,4' as never) as RegionRuntime
  runtime.markEncounterCleared('ambush')
  runtime.markActorDefeated('captain')
  runtime.markPropRemoved('gate')
  runtime.markLootCollected('chest')
  runtime.markInteractionCompleted('shrine')
  runtime.markEventCompleted('ambush')
  runtime.setDeltaValue('weather', {
    kind: 'rain',
    forecast: { hours: [1, 2, 3] },
  })
  const expected = runtime.extractDelta()
  const save = first.saveState()
  assert.deepEqual(save.deltas['4,4'], expected)

  save.deltas['4,4'].clearedEncounterIds.push('tampered')
  ;(
    save.deltas['4,4'].state.weather as {
      forecast: { hours: number[] }
    }
  ).forecast.hours.push(99)
  assert.deepEqual(first.getSavedDelta('4,4' as never), expected)

  const cleanSave = first.saveState()

  const restored = new RegionManager(world as never)
  assert.equal(restored.applyState(cleanSave), true)
  cleanSave.deltas['4,4'].completedEventIds.push('tampered')
  ;(
    cleanSave.deltas['4,4'].state.weather as {
      forecast: { hours: number[] }
    }
  ).forecast.hours.push(99)
  restored.update()
  assert.deepEqual(
    restored.getDiscoveredRegionIds(),
    first.getDiscoveredRegionIds(),
  )
  const restoredRuntime = restored.getRuntime('4,4' as never) as RegionRuntime
  assert.deepEqual(restoredRuntime.extractDelta(), expected)

  const mismatched = first.saveState()
  mismatched.deltas['4,4'] = {
    ...mismatched.deltas['4,4'],
    regionId: '3,3',
  }
  const rejecting = new RegionManager(world as never)
  assert.equal(rejecting.applyState(mismatched), false)
  assert.equal(rejecting.getSavedDelta('3,3' as never), undefined)

  first.dispose()
  restored.dispose()
  rejecting.dispose()
})

test('manager state application atomically replaces newer and omitted deltas', () => {
  const world = createFiveByFiveWorld()
  const manager = new RegionManager(world as never)
  manager.update('2,2' as never)
  const retained = manager.getRuntime('2,2' as never) as RegionRuntime
  const omitted = manager.getRuntime('3,2' as never) as RegionRuntime

  retained.markEncounterCleared('old-encounter')
  retained.setDeltaValue('encounter', {
    phase: 1,
    actors: ['scout'],
  })
  const olderDelta = retained.extractDelta()
  const expectedOlderDelta = structuredClone(olderDelta)

  retained.markEncounterCleared('later-encounter')
  retained.setDeltaValue('encounter', {
    phase: 2,
    actors: ['scout', 'captain'],
  })
  omitted.markActorDefeated('later-captain')
  omitted.setDeltaValue('event', { phase: 'complete' })
  manager.markDiscovered('4,4' as never)

  const retainedBeforeInvalid = retained.extractDelta()
  const omittedBeforeInvalid = omitted.extractDelta()
  const discoveredBeforeInvalid = manager.getDiscoveredRegionIds()
  assert.equal(
    manager.applyState({
      version: 1,
      currentRegionId: '0,0',
      discoveredRegionIds: [],
      deltas: {
        '2,2': olderDelta,
        '3,2': {
          ...omittedBeforeInvalid,
          regionId: '4,2',
        },
      },
    }),
    false,
  )
  assert.equal(manager.currentRegionId, '2,2')
  assert.deepEqual(manager.getDiscoveredRegionIds(), discoveredBeforeInvalid)
  assert.deepEqual(retained.extractDelta(), retainedBeforeInvalid)
  assert.deepEqual(omitted.extractDelta(), omittedBeforeInvalid)

  const replacement = {
    version: 1,
    currentRegionId: '2,2',
    discoveredRegionIds: ['2,2'],
    deltas: {
      '2,2': olderDelta,
    },
  }
  assert.equal(manager.applyState(replacement), true)

  olderDelta.clearedEncounterIds.push('tampered')
  ;(
    olderDelta.state.encounter as {
      actors: string[]
    }
  ).actors.push('tampered')
  replacement.discoveredRegionIds.push('4,4')

  assert.deepEqual(manager.getSavedDelta('2,2' as never), expectedOlderDelta)
  assert.equal(manager.getSavedDelta('3,2' as never), undefined)
  assert.deepEqual(manager.getDiscoveredRegionIds(), ['2,2'])
  assert.deepEqual(retained.extractDelta().clearedEncounterIds, [
    'old-encounter',
  ])
  assert.deepEqual(retained.extractDelta().state.encounter, {
    phase: 1,
    actors: ['scout'],
  })
  assert.deepEqual(omitted.extractDelta().defeatedActorIds, [])
  assert.deepEqual(omitted.extractDelta().state, {})

  const exportedDelta = manager.getSavedDelta('2,2' as never)
  assert.ok(exportedDelta)
  exportedDelta.clearedEncounterIds.push('export-tamper')
  assert.deepEqual(manager.getSavedDelta('2,2' as never), expectedOlderDelta)

  retained.markActorDefeated('post-restore')
  omitted.markEventCompleted('post-restore')
  const emptySnapshot = {
    version: 1,
    discoveredRegionIds: [] as string[],
    deltas: {},
  }
  assert.equal(manager.applyState(emptySnapshot), true)
  emptySnapshot.discoveredRegionIds.push('4,4')

  assert.equal(manager.getSavedDelta('2,2' as never), undefined)
  assert.equal(manager.getSavedDelta('3,2' as never), undefined)
  assert.deepEqual(manager.getDiscoveredRegionIds(), [])
  assert.deepEqual(retained.extractDelta().clearedEncounterIds, [])
  assert.deepEqual(retained.extractDelta().defeatedActorIds, [])
  assert.deepEqual(retained.extractDelta().state, {})
  assert.deepEqual(omitted.extractDelta().completedEventIds, [])
  assert.deepEqual(omitted.extractDelta().state, {})

  retained.markEncounterCleared('must-survive-malformed-input')
  const beforeMalformedInput = retained.extractDelta()
  assert.equal(
    manager.applyState({ version: 1, discoveredRegionIds: [] }),
    false,
  )
  assert.deepEqual(retained.extractDelta(), beforeMalformedInput)

  manager.dispose()
})
