export const RAIN_CAPACITY = 420
export const SNOW_CAPACITY = 300

export interface PrecipitationFrame {
  delta: number
  time: number
  cameraX: number
  cameraY: number
  cameraZ: number
  windX: number
  windZ: number
  windStrength: number
  reducedMotion: boolean
}

export function precipitationCount(capacity: number, density: number, weight: number, reducedMotion: boolean): number {
  if (!Number.isInteger(capacity) || capacity < 0 ||
      !Number.isFinite(density) || density < 0 || density > 1 ||
      !Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new RangeError('Invalid precipitation capacity, density or weight')
  }
  return weight > 0.015 ? Math.floor(capacity * density * weight * (reducedMotion ? 0.5 : 1)) : 0
}

function wrap(value: number, minimum: number, span: number): number {
  return minimum + ((value - minimum) % span + span) % span
}

/** Mutates only existing render buffers. Terrain is sampled, never replaced or modified. */
export function updatePrecipitationBuffer(
  kind: 'rain' | 'snow',
  positions: Float32Array,
  phases: Float32Array,
  count: number,
  frame: PrecipitationFrame,
  sampleHeight: (x: number, z: number) => number,
): void {
  const stride = kind === 'rain' ? 6 : 3
  if (!Number.isInteger(count) || count < 0 || count * stride > positions.length ||
      (kind === 'snow' && count > phases.length) || !Number.isFinite(frame.delta) || frame.delta < 0) {
    throw new RangeError('Invalid precipitation buffer update')
  }
  const motion = frame.reducedMotion ? 0.35 : 1
  const wind = frame.windStrength * (frame.reducedMotion ? 0 : 1)
  for (let index = 0; index < count; index++) {
    const offset = index * stride
    const phase = kind === 'snow' ? frame.time * 1.3 + phases[index] : 0
    const drift = kind === 'snow' && !frame.reducedMotion ? 0.65 : 0
    const windSpeed = kind === 'rain' ? 2.4 : 1.2
    let x = wrap(positions[offset] + (frame.windX * windSpeed * wind + Math.sin(phase) * drift) * frame.delta,
      frame.cameraX - 24, 48)
    let z = wrap(positions[offset + 2] + (frame.windZ * windSpeed * wind + Math.cos(phase * 0.83) * drift) * frame.delta,
      frame.cameraZ - 20, 40)
    // No flakes or streaks right against the lens, where they cover entire targets.
    if ((x - frame.cameraX) ** 2 + (z - frame.cameraZ) ** 2 < 2.25) {
      x += index % 2 === 0 ? 2 : -2
      z += index % 3 === 0 ? 2 : -2
    }
    const ground = sampleHeight(x, z)
    if (!Number.isFinite(ground)) throw new RangeError('Precipitation terrain height is not finite')
    const floor = ground + 0.08
    const ceiling = Math.max(floor + 25, frame.cameraY + 12)
    const y = wrap(positions[offset + 1] - (kind === 'rain' ? 34 : 5.4) * motion * frame.delta, floor, ceiling - floor)
    positions[offset] = x
    positions[offset + 1] = y
    positions[offset + 2] = z
    if (kind === 'rain') {
      const length = frame.reducedMotion ? 0.65 : 1.2
      positions[offset + 3] = x - frame.windX * length * wind * 0.32
      positions[offset + 4] = y + length
      positions[offset + 5] = z - frame.windZ * length * wind * 0.32
    }
  }
}
