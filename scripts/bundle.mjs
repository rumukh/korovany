import { copyFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve('dist', 'index.html')
const destination = resolve('bundle.html')

await copyFile(source, destination)
const { size } = await stat(destination)
console.log(`Created bundle.html (${(size / 1024).toFixed(1)} KiB)`)
