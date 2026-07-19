import * as THREE from 'three'
import { RandomStream } from './random/RandomStream.ts'
import { deriveSeed } from './random/seed.ts'

export type ProceduralSurfacePattern =
  | 'dirt'
  | 'grass'
  | 'leaves'
  | 'roof'
  | 'scree'
  | 'stone'
  | 'water'
  | 'wood'

export interface ProceduralSurfaceTextureOptions {
  key: string
  base: THREE.ColorRepresentation
  detail: THREE.ColorRepresentation
  pattern: ProceduralSurfacePattern
  repeatX: number
  repeatY: number
  size?: number
}

type PixelColor = readonly [number, number, number]

const DEFAULT_TEXTURE_SIZE = 64

export function createProceduralSurfaceTexture(
  options: ProceduralSurfaceTextureOptions,
): THREE.DataTexture {
  const size = Math.max(
    16,
    Math.min(256, Math.floor(options.size ?? DEFAULT_TEXTURE_SIZE)),
  )
  const pixels = new Uint8Array(size * size * 4)
  const base = colorBytes(options.base)
  const detail = colorBytes(options.detail)
  const light = mixBytes(detail, [255, 255, 255], 0.28)
  const dark = mixBytes(detail, [10, 12, 14], 0.36)
  const painter = new PixelPainter(pixels, size)
  const random = new RandomStream(
    deriveSeed(options.key, `surface:${options.pattern}:${size}`),
  )

  painter.clear(base)
  drawMottle(painter, random, light, dark)

  if (options.pattern === 'grass') {
    drawGrass(painter, random, detail, light, dark)
  } else if (options.pattern === 'dirt') {
    drawDirt(painter, random, detail, light, dark)
  } else if (options.pattern === 'scree') {
    drawScree(painter, random, detail, light, dark)
  } else if (options.pattern === 'stone') {
    drawStone(painter, random, detail, light, dark)
  } else if (options.pattern === 'wood') {
    drawWood(painter, random, detail, light, dark)
  } else if (options.pattern === 'roof') {
    drawRoof(painter, random, detail, light, dark)
  } else if (options.pattern === 'leaves') {
    drawLeaves(painter, random, detail, light, dark)
  } else {
    drawWater(painter, random, detail, light, dark)
  }

  const texture = new THREE.DataTexture(
    pixels,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.name = `procedural-surface:${options.key}`
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(
    Math.max(0.001, options.repeatX),
    Math.max(0.001, options.repeatY),
  )
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

class PixelPainter {
  private readonly pixels: Uint8Array
  readonly size: number

  constructor(
    pixels: Uint8Array,
    size: number,
  ) {
    this.pixels = pixels
    this.size = size
  }

  clear(color: PixelColor): void {
    for (let offset = 0; offset < this.pixels.length; offset += 4) {
      this.pixels[offset] = color[0]
      this.pixels[offset + 1] = color[1]
      this.pixels[offset + 2] = color[2]
      this.pixels[offset + 3] = 255
    }
  }

  pixel(x: number, y: number, color: PixelColor, opacity = 1): void {
    const wrappedX = modulo(Math.round(x), this.size)
    const wrappedY = modulo(Math.round(y), this.size)
    const offset = (wrappedY * this.size + wrappedX) * 4
    const amount = clamp(opacity, 0, 1)
    this.pixels[offset] = Math.round(
      this.pixels[offset] + (color[0] - this.pixels[offset]) * amount,
    )
    this.pixels[offset + 1] = Math.round(
      this.pixels[offset + 1] +
        (color[1] - this.pixels[offset + 1]) * amount,
    )
    this.pixels[offset + 2] = Math.round(
      this.pixels[offset + 2] +
        (color[2] - this.pixels[offset + 2]) * amount,
    )
  }

  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    color: PixelColor,
    opacity = 1,
  ): void {
    for (let offsetY = 0; offsetY < height; offsetY += 1) {
      for (let offsetX = 0; offsetX < width; offsetX += 1) {
        this.pixel(x + offsetX, y + offsetY, color, opacity)
      }
    }
  }

  line(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    color: PixelColor,
    opacity = 1,
    width = 1,
  ): void {
    const steps = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(endX - startX), Math.abs(endY - startY))),
    )
    const radius = Math.max(0, Math.floor((width - 1) / 2))
    for (let step = 0; step <= steps; step += 1) {
      const amount = step / steps
      const x = startX + (endX - startX) * amount
      const y = startY + (endY - startY) * amount
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          this.pixel(x + offsetX, y + offsetY, color, opacity)
        }
      }
    }
  }

  ellipse(
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    color: PixelColor,
    opacity = 1,
  ): void {
    const minX = Math.floor(centerX - radiusX)
    const maxX = Math.ceil(centerX + radiusX)
    const minY = Math.floor(centerY - radiusY)
    const maxY = Math.ceil(centerY + radiusY)
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const normalizedX = (x - centerX) / Math.max(radiusX, 0.001)
        const normalizedY = (y - centerY) / Math.max(radiusY, 0.001)
        if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
          this.pixel(x, y, color, opacity)
        }
      }
    }
  }
}

function drawMottle(
  painter: PixelPainter,
  random: RandomStream,
  light: PixelColor,
  dark: PixelColor,
): void {
  for (let index = 0; index < 120; index += 1) {
    painter.pixel(
      random.range(0, painter.size),
      random.range(0, painter.size),
      index % 3 === 0 ? light : dark,
      0.08 + random.next() * 0.1,
    )
  }
}

function drawGrass(
  painter: PixelPainter,
  random: RandomStream,
  detail: PixelColor,
  light: PixelColor,
  dark: PixelColor,
): void {
  for (let index = 0; index < 260; index += 1) {
    const x = random.range(0, painter.size)
    const y = random.range(0, painter.size)
    const length = random.range(2, 6)
    const color = index % 5 === 0 ? light : index % 3 === 0 ? dark : detail
    painter.line(
      x,
      y,
      x + random.range(-1.5, 1.5),
      y - length,
      color,
      0.58 + random.next() * 0.35,
    )
  }
}

function drawDirt(
  painter: PixelPainter,
  random: RandomStream,
  detail: PixelColor,
  light: PixelColor,
  dark: PixelColor,
): void {
  for (let index = 0; index < 145; index += 1) {
    const size = random.integer(1, 3)
    painter.rect(
      random.range(0, painter.size),
      random.range(0, painter.size),
      size,
      size,
      index % 4 === 0 ? light : index % 2 === 0 ? dark : detail,
      0.42 + random.next() * 0.4,
    )
  }
  for (const offset of [0.28, 0.72]) {
    const x = painter.size * offset + random.range(-2, 2)
    painter.line(x, 0, x + random.range(-2, 2), painter.size, dark, 0.2, 2)
  }
}

function drawScree(
  painter: PixelPainter,
  random: RandomStream,
  detail: PixelColor,
  light: PixelColor,
  dark: PixelColor,
): void {
  for (let index = 0; index < 175; index += 1) {
    const x = random.range(0, painter.size)
    const y = random.range(0, painter.size)
    const radiusX = random.range(0.7, 3.2)
    const radiusY = random.range(0.6, 2.2)
    painter.ellipse(
      x,
      y,
      radiusX,
      radiusY,
      index % 4 === 0 ? light : index % 2 === 0 ? dark : detail,
      0.42 + random.next() * 0.4,
    )
    if (index % 8 === 0) {
      painter.line(x - radiusX, y, x + radiusX, y - radiusY, dark, 0.45)
    }
  }
  for (let index = 0; index < 10; index += 1) {
    painter.ellipse(
      random.range(0, painter.size),
      random.range(0, painter.size),
      random.range(3, 8),
      random.range(1.5, 4),
      dark,
      0.12,
    )
  }
}

function drawStone(
  painter: PixelPainter,
  random: RandomStream,
  detail: PixelColor,
  light: PixelColor,
  dark: PixelColor,
): void {
  const courseHeight = 16
  for (let y = 0; y <= painter.size; y += courseHeight) {
    painter.line(0, y, painter.size, y, dark, 0.72, 2)
    painter.line(0, y + 2, painter.size, y + 2, light, 0.18)
    const offset = (y / courseHeight) % 2 === 0 ? 0 : 12
    for (let x = offset; x <= painter.size; x += 24) {
      painter.line(x, y, x, y + courseHeight, dark, 0.65, 2)
    }
  }
  for (let index = 0; index < 52; index += 1) {
    painter.rect(
      random.range(0, painter.size),
      random.range(0, painter.size),
      random.integer(1, 3),
      1,
      index % 2 === 0 ? light : detail,
      0.25 + random.next() * 0.28,
    )
  }
  for (let index = 0; index < 12; index += 1) {
    painter.ellipse(
      random.range(0, painter.size),
      random.range(0, painter.size),
      random.range(2, 6),
      random.range(1, 3.5),
      dark,
      0.12 + random.next() * 0.12,
    )
  }
}

function drawWood(
  painter: PixelPainter,
  random: RandomStream,
  detail: PixelColor,
  light: PixelColor,
  dark: PixelColor,
): void {
  for (let y = 0; y < painter.size; y += 8) {
    painter.line(0, y, painter.size, y, dark, 0.62)
    painter.line(0, y + 1, painter.size, y + 1, light, 0.2)
  }
  for (let index = 0; index < 42; index += 1) {
    const y = random.integer(0, 8) * 8 + random.range(2, 6)
    const x = random.range(0, painter.size)
    painter.line(
      x,
      y,
      x + random.range(2, 9),
      y + random.range(-0.8, 0.8),
      index % 3 === 0 ? light : detail,
      0.38 + random.next() * 0.34,
    )
  }
  for (let index = 0; index < 8; index += 1) {
    const x = random.range(0, painter.size)
    const y = random.range(0, painter.size)
    painter.ellipse(x, y, random.range(1.5, 3.5), 1.2, dark, 0.46)
    painter.ellipse(x, y, 0.7, 0.5, light, 0.32)
  }
}

function drawRoof(
  painter: PixelPainter,
  random: RandomStream,
  detail: PixelColor,
  light: PixelColor,
  dark: PixelColor,
): void {
  const rowHeight = 10
  for (let y = 0; y <= painter.size; y += rowHeight) {
    painter.line(0, y, painter.size, y, dark, 0.72, 2)
    const offset = (y / rowHeight) % 2 === 0 ? 0 : 8
    for (let x = offset; x < painter.size; x += 16) {
      painter.line(x, y, x, y + rowHeight, detail, 0.75, 2)
      painter.line(x + 2, y + 2, x + 2, y + rowHeight - 1, light, 0.18)
    }
  }
  for (let index = 0; index < 36; index += 1) {
    painter.pixel(
      random.range(0, painter.size),
      random.range(0, painter.size),
      index % 2 === 0 ? light : dark,
      0.24,
    )
  }
}

function drawLeaves(
  painter: PixelPainter,
  random: RandomStream,
  detail: PixelColor,
  light: PixelColor,
  dark: PixelColor,
): void {
  for (let index = 0; index < 220; index += 1) {
    const x = random.range(0, painter.size)
    const y = random.range(0, painter.size)
    const radius = random.range(1, 3.4)
    const color = index % 5 === 0 ? light : index % 3 === 0 ? dark : detail
    painter.ellipse(
      x,
      y,
      radius,
      radius * random.range(0.55, 1.15),
      color,
      0.48 + random.next() * 0.42,
    )
    if (index % 9 === 0) {
      painter.line(x - radius, y, x + radius, y, light, 0.3)
    }
  }
  for (let index = 0; index < 14; index += 1) {
    painter.ellipse(
      random.range(0, painter.size),
      random.range(0, painter.size),
      random.range(2, 5),
      random.range(2, 5),
      dark,
      0.2,
    )
  }
}

function drawWater(
  painter: PixelPainter,
  random: RandomStream,
  detail: PixelColor,
  light: PixelColor,
  dark: PixelColor,
): void {
  for (let row = 0; row < 7; row += 1) {
    const y = row * 10 + random.range(-2, 2)
    for (let segment = 0; segment < 4; segment += 1) {
      const x = segment * 18 + random.range(-4, 3)
      painter.line(x, y, x + 7, y - 1.5, light, 0.5)
      painter.line(x + 7, y - 1.5, x + 15, y, detail, 0.45)
      painter.line(x + 2, y + 2, x + 12, y + 2, dark, 0.14)
    }
  }
}

function colorBytes(color: THREE.ColorRepresentation): PixelColor {
  const hex = new THREE.Color(color).getHex(THREE.SRGBColorSpace)
  return [(hex >>> 16) & 0xff, (hex >>> 8) & 0xff, hex & 0xff]
}

function mixBytes(
  first: PixelColor,
  second: PixelColor,
  amount: number,
): PixelColor {
  const weight = clamp(amount, 0, 1)
  return [
    Math.round(first[0] + (second[0] - first[0]) * weight),
    Math.round(first[1] + (second[1] - first[1]) * weight),
    Math.round(first[2] + (second[2] - first[2]) * weight),
  ]
}

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
