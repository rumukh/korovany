import type { MapMarker, WorldMapView } from './types'

export function projectMapMarker(
  coordinate: number,
  minimum: number,
  maximum: number,
): string {
  const span = Math.max(1, maximum - minimum)
  return `${Math.min(100, Math.max(0, ((coordinate - minimum) / span) * 100))}%`
}

function markerIsDiscovered(
  worldMap: WorldMapView,
  x: number,
  z: number,
): boolean {
  const { bounds, regions } = worldMap
  const columns = Math.max(1, ...regions.map((region) => region.gridX + 1))
  const rows = Math.max(1, ...regions.map((region) => region.gridZ + 1))
  const width = Math.max(1, bounds.maxX - bounds.minX)
  const depth = Math.max(1, bounds.maxZ - bounds.minZ)
  const gridX = Math.min(
    columns - 1,
    Math.max(0, Math.floor(((x - bounds.minX) / width) * columns)),
  )
  const gridZ = Math.min(
    rows - 1,
    Math.max(0, Math.floor(((z - bounds.minZ) / depth) * rows)),
  )
  return Boolean(
    regions.find((region) => region.gridX === gridX && region.gridZ === gridZ)
      ?.discovered,
  )
}

export function isMapMarkerVisible(
  worldMap: WorldMapView,
  marker: MapMarker,
): boolean {
  if (marker.kind === 'player' || marker.kind === 'objective') return true
  return markerIsDiscovered(worldMap, marker.x, marker.z)
}
