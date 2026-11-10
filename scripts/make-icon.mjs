import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(join(root, 'public', 'icon.svg'), 'utf8')
const render = size => new Resvg(source.replace(/width="480" height="480"/, `width="${size}" height="${size}"`), {
  fitTo: { mode: 'width', value: size },
  background: 'rgba(0,0,0,0)',
}).render().asPng()

await mkdir(join(root, 'build'), { recursive: true })
const png512 = render(512)
const png256 = render(256)
await writeFile(join(root, 'build', 'icon.png'), png512)

const header = Buffer.alloc(22)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)
header.writeUInt8(0, 6)
header.writeUInt8(0, 7)
header.writeUInt8(0, 8)
header.writeUInt8(0, 9)
header.writeUInt16LE(1, 10)
header.writeUInt16LE(32, 12)
header.writeUInt32LE(png256.length, 14)
header.writeUInt32LE(22, 18)
await writeFile(join(root, 'build', 'icon.ico'), Buffer.concat([header, png256]))

console.log(`icon.png ${Math.round(png512.length / 1024)} КБ, icon.ico ${Math.round((png256.length + 22) / 1024)} КБ`)
