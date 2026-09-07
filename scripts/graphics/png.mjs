import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'

/** Chrome's lossless 8-bit RGB/RGBA PNGs; reject other encodings rather than miscompare. */
export function decodeGraphicsPng(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG signature')
  let width
  let height
  let channels
  const chunks = []
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    const kind = bytes.toString('ascii', offset + 4, offset + 8)
    if (offset + length + 12 > bytes.length) throw new Error('Truncated PNG chunk')
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : null
      if (data[8] !== 8 || !channels || data[12] !== 0) throw new Error('Unsupported PNG bit depth/color/interlace')
    } else if (kind === 'IDAT') chunks.push(data)
    offset += length + 12
    if (kind === 'IEND') break
  }
  if (!width || !height || !channels || width * height > 40_000_000) throw new Error('Unsupported PNG dimensions')
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height })
  if (raw.length !== (stride + 1) * height) throw new Error('Unexpected PNG scanline length')
  const pixels = Buffer.alloc(stride * height)
  const paeth = (left, above, diagonal) => {
    const prediction = left + above - diagonal
    const a = Math.abs(prediction - left)
    const b = Math.abs(prediction - above)
    const c = Math.abs(prediction - diagonal)
    return a <= b && a <= c ? left : b <= c ? above : diagonal
  }
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    if (filter > 4) throw new Error('Unknown PNG scanline filter')
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const diagonal = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above
        : filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, diagonal)
      pixels[y * stride + x] = (raw[y * (stride + 1) + x + 1] + predictor) & 255
    }
  }
  return { width, height, channels, pixels, sha256: createHash('sha256').update(pixels).digest('hex') }
}

export function compareGraphicsPng(first, second) {
  const a = decodeGraphicsPng(first)
  const b = decodeGraphicsPng(second)
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    throw new Error('Graphics captures have different dimensions or channel counts')
  }
  let changedPixels = 0
  let maxChannelDelta = 0
  let totalChannelDelta = 0
  let minX = a.width
  let minY = a.height
  let maxX = -1
  let maxY = -1
  for (let pixel = 0; pixel < a.width * a.height; pixel++) {
    let changed = false
    for (let channel = 0; channel < a.channels; channel++) {
      const delta = Math.abs(a.pixels[pixel * a.channels + channel] - b.pixels[pixel * a.channels + channel])
      maxChannelDelta = Math.max(maxChannelDelta, delta)
      totalChannelDelta += delta
      changed ||= delta > 0
    }
    if (!changed) continue
    changedPixels++
    const x = pixel % a.width
    const y = Math.floor(pixel / a.width)
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  return {
    identicalPixels: changedPixels === 0, changedPixels,
    changedPixelRatio: changedPixels / (a.width * a.height), maxChannelDelta,
    meanChannelDelta: totalChannelDelta / a.pixels.length,
    bounds: changedPixels ? { minX, minY, maxX, maxY } : null,
    firstPixelSha256: a.sha256, secondPixelSha256: b.sha256,
  }
}
