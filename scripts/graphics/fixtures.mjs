export const GRAPHICS_SEED = 20260906
export const GRAPHICS_FIXTURES = [
  { id: 'elf-opening', faction: 'elf', weather: 'rain', time: 2,
    description: 'Fresh production elf opening; no player/actor relocation. Staged visual clock and seed; simulation held for capture.' },
  { id: 'guard-opening', faction: 'guard', weather: 'clear', time: 2,
    description: 'Fresh production guard opening; no player/actor relocation. Staged visual clock and seed; simulation held for capture.' },
  { id: 'villain-opening', faction: 'villain', weather: 'snow', time: 2,
    description: 'Fresh production villain opening; no player/actor relocation. Staged visual clock and seed; simulation held for capture.' },
  { id: 'elf-forest-obstruction', faction: 'elf', save: 'elf-save.json', reference: 'elf-forest-contract.png', weather: 'rain', time: 23.5,
    description: 'Real 32.2 s elf checkpoint; player/companion positions and requested camera staged from the 23.5 s field frame. Saved HP/objectives retained; unsaved transient actors/FX not reconstructed.' },
  { id: 'guard-riverside-close', faction: 'guard', save: 'guard-save.json', reference: 'guard-melee-impact.png', weather: 'clear', time: 43,
    description: 'Real 43.0 s guard checkpoint beside the riverside shop. Field camera yaw/pitch and rounded subject positions staged; production collision solver must reproduce the compressed camera, not a forced camera position.' },
  { id: 'villain-slope', faction: 'villain', save: 'villain-save.json', reference: 'villain-highland-squad.png', weather: 'snow', time: 30.5,
    description: 'Real 34.1 s villain checkpoint; subjects staged at the 30.5 s highland slope coordinates. Not a completed stronghold or finale.' },
  { id: 'bridge-water-edge', faction: 'guard', target: 'bridge', weather: 'clear', time: 16.8,
    description: 'Fresh real world, player and companions staged at a generated bridge crossing. Real bridge/river/terrain builders and collision; no replacement geometry.' },
  { id: 'crowded-25', faction: 'guard', crowd: true, weather: 'clear', time: 16.8,
    description: 'Fresh guard world; existing NPCs positioned at legal arena points and remaining slots filled by production spawnActor/budget to 25 NPCs plus player. Real HP, allegiance, AI and combat; no invulnerability or replacement after death.' },
  { id: 'neutral-biome', faction: 'guard', target: 'neutral', weather: 'overcast', time: 16.8,
    description: 'Fresh real world; subjects staged at a terrain-queried neutral biome center. Overcast is a presentation override, not a change to simulated weather.' },
  { id: 'night', faction: 'guard', weather: 'clear', time: 136.8,
    description: 'Fresh production guard opening under a staged night presentation clock; campaign time/night-dependent AI are not advanced or rewritten.' },
  { id: 'rain', faction: 'guard', target: 'neutral', weather: 'rain', time: 16.8,
    description: 'Neutral biome rain presentation fixture with a separate art: precipitation seed. Simulation weather remains determined by the real biome.' },
  { id: 'snow', faction: 'guard', target: 'neutral', weather: 'snow', time: 16.8,
    description: 'Neutral biome snow presentation fixture with a separate art: precipitation seed. Simulation weather remains determined by the real biome.' },
  { id: 'streaming-boundary', faction: 'guard', target: 'boundary', weather: 'clear', time: 16.8,
    description: 'Subjects staged beside an actual connected region boundary. Profile uses normal forward/back input across the seam; records real visible/simulated region changes, allocation churn and streaming CPU spikes.' },
]

export function selectGraphicsFixtures(names) {
  if (!names || names === 'all') return GRAPHICS_FIXTURES
  const requested = names.split(',')
  if (new Set(requested).size !== requested.length) throw new Error('Duplicate graphics fixture selection')
  return requested.map((id) => {
    const fixture = GRAPHICS_FIXTURES.find((candidate) => candidate.id === id)
    if (!fixture) throw new Error(`Unknown graphics fixture: ${id}`)
    return fixture
  })
}

export function fixtureStage(fixture, world, referenceManifest, snapshot) {
  const request = { label: fixture.description }
  if (fixture.reference) {
    const capture = referenceManifest.captures.find((entry) => entry.file === fixture.reference)
    if (!capture) throw new Error(`Missing original field metadata: ${fixture.reference}`)
    request.player = capture.player.position
    request.camera = { yaw: capture.camera.yaw, pitch: capture.camera.pitch }
    request.companions = capture.nearbyActors.filter((actor) => actor.id.startsWith('squad:'))
      .map((actor) => ({ id: actor.id, position: actor.position }))
  }
  if (fixture.target) {
    let position
    if (fixture.target === 'bridge') {
      position = world.bridges[0]?.position
      request.camera = { yaw: -Math.PI / 4, pitch: 0.65 }
    } else if (fixture.target === 'neutral') {
      const region = world.regions.find((entry) => entry.biome === 'neutral')
      position = region?.center
      request.camera = { yaw: 0.65, pitch: 0.38 }
    } else if (fixture.target === 'boundary') {
      const region = world.regions.find((entry) => entry.id === snapshot.runtime.region)
      if (!region) throw new Error('Opening region missing from fixture world')
      const blueprintRegion = world.blueprint.regions.find((entry) => entry.id === region.id)
      const north = blueprintRegion.edges.find((edge) => edge.direction === 'north')
      const east = blueprintRegion.edges.find((edge) => edge.direction === 'east')
      const west = blueprintRegion.edges.find((edge) => edge.direction === 'west')
      const south = blueprintRegion.edges.find((edge) => edge.direction === 'south')
      if (north) {
        position = { x: region.center.x, y: region.center.y, z: region.bounds.minZ + 2 }
        request.camera = { yaw: 0, pitch: 0.38 }
      } else if (east) {
        position = { x: region.bounds.maxX - 2, y: region.center.y, z: region.center.z }
        request.camera = { yaw: Math.PI / 2, pitch: 0.38 }
      } else if (west) {
        position = { x: region.bounds.minX + 2, y: region.center.y, z: region.center.z }
        request.camera = { yaw: -Math.PI / 2, pitch: 0.38 }
      } else if (south) {
        position = { x: region.center.x, y: region.center.y, z: region.bounds.maxZ - 2 }
        request.camera = { yaw: Math.PI, pitch: 0.38 }
      } else throw new Error('No supported connected seam at the faction opening')
    }
    if (!position) throw new Error(`No real ${fixture.target} prerequisite exists in this world`)
    request.player = { ...position }
    request.companions = snapshot.runtime.actors.filter((actor) => actor.squad).map((actor, index) => ({
      id: actor.id, position: { x: position.x - 3 + index * 3, y: position.y, z: position.z + 3 },
    }))
  }
  if (fixture.crowd) {
    request.crowd = true
    request.camera = { yaw: snapshot.runtime.camera.yaw, pitch: 0.85 }
  }
  return request
}
