import assert from 'node:assert/strict'
import test from 'node:test'
import { isMapMarkerVisible, projectMapMarker } from '../src/game/mapMarkers.ts'
import type { MapMarker, WorldMapView } from '../src/game/types.ts'

const generatedMap = {
  mode: 'generated',
  bounds: { minX: 0, maxX: 200, minZ: 0, maxZ: 100 },
  regions: [
    {
      id: 'known',
      gridX: 0,
      gridZ: 0,
      biome: 'neutral',
      territory: 'neutral',
      discovered: true,
      current: true,
    },
    {
      id: 'unknown',
      gridX: 1,
      gridZ: 0,
      biome: 'forest',
      territory: 'elf',
      discovered: false,
      current: false,
    },
  ],
} satisfies WorldMapView

test('active objective remains visible in an undiscovered region', () => {
  const hiddenLandmark = {
    id: 'landmark',
    x: 150,
    z: 50,
    kind: 'landmark',
  } satisfies MapMarker
  const objective = {
    ...hiddenLandmark,
    id: 'objective',
    kind: 'objective',
  } satisfies MapMarker

  assert.equal(isMapMarkerVisible(generatedMap, hiddenLandmark), false)
  assert.equal(isMapMarkerVisible(generatedMap, objective), true)
})

test('map marker projection stays inside the minimap', () => {
  assert.equal(projectMapMarker(-20, 0, 100), '0%')
  assert.equal(projectMapMarker(50, 0, 100), '50%')
  assert.equal(projectMapMarker(120, 0, 100), '100%')
})
