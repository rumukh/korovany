export const FIRST_VISUAL_CASES = ['elf-opening', 'guard-opening', 'villain-opening']
export const FIRST_VISUAL_ESTIMATED_MINUTES = { minimum: 10, maximum: 15 }

/** Three launches, not the baseline corpus. All poses are held, labelled presentation. */
export function firstVisualPortraitStages(faction, actors) {
  if (!['elf', 'guard', 'villain'].includes(faction)) throw new Error('Unknown portrait faction')
  const companions = actors.filter((actor) => actor.squad).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  if (companions.length !== 3) throw new Error('First visual review requires the three actual production companions')
  const stages = []
  const add = (subject, view, pose) => stages.push({
    id: `${subject}-${view}-${pose}`,
    request: { label: `STAGED ${faction} ${subject} ${view} ${pose}; held production rig, no combat time advanced.`,
      portrait: { version: 1, subject, view, pose } },
  })
  for (const subject of ['player', 'companion-0']) {
    for (const view of ['front', 'three-quarter', 'profile']) add(subject, view, 'current')
  }
  add('player', 'gameplay', 'current')
  add('player', 'three-quarter', 'walk')
  add('companion-0', 'three-quarter', 'windup')
  add('companion-0', 'three-quarter', 'contact')
  if (faction === 'guard') add('player', 'three-quarter', 'guard')
  else {
    const archer = companions.findIndex((actor) => actor.role === 'archer')
    if (archer < 0) throw new Error(`No real ${faction} companion archer for the aim portrait`)
    add(`companion-${archer}`, 'three-quarter', 'aim')
  }
  return stages
}

/** Save timestamps change when exported; every other field must remain identical. */
export function portraitSaveIdentity(save) {
  if (!save || typeof save !== 'object' || typeof save.updatedAt !== 'string') throw new Error('Portrait comparison requires a real save envelope')
  const { updatedAt: _exportTime, ...identity } = save
  return JSON.stringify(identity)
}

export function portraitSimulationIdentity(snapshot) {
  const runtime = snapshot?.runtime
  if (!runtime?.characterCaptureState || !Array.isArray(runtime.actors) || !runtime.rngStates) {
    throw new Error('Portrait capture requires the production state-preservation telemetry')
  }
  return JSON.stringify({
    elapsed: runtime.elapsed, health: runtime.health, npcCount: runtime.npcCount,
    paused: runtime.paused, ended: runtime.ended, player: runtime.player, heading: runtime.heading,
    fingerprint: runtime.fingerprint, rng: runtime.rngStates, weather: runtime.simulationWeather,
    actors: runtime.actors, state: runtime.characterCaptureState,
  })
}

export function portraitCameraReference(manifest, fixtureId, stageId, conditions, subject) {
  if (!manifest?.complete || JSON.stringify(manifest.conditions?.portraitComparison) !== JSON.stringify(conditions)) {
    throw new Error('Portrait reference is incomplete or uses different camera/light/quality capture conditions')
  }
  const record = manifest.cases?.find((entry) => entry.id === fixtureId)?.portraits?.find((entry) => entry.id === stageId)
  if (!record || record.subject?.id !== subject.id || record.subject?.role !== subject.role ||
      record.subject?.faction !== subject.faction) throw new Error('Portrait reference subject or frame is absent/mismatched')
  if (record.cameraMode === 'production-gameplay') return null
  if (!record.cameraFrame) throw new Error('Portrait reference has no replayable camera frame')
  return record.cameraFrame
}
