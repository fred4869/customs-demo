import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.join(rootDir, 'sample-assets')
const targetDir = path.join(rootDir, 'frontend', 'public', 'sample-assets')

await fs.rm(targetDir, { recursive: true, force: true })
await fs.mkdir(path.dirname(targetDir), { recursive: true })
await fs.cp(sourceDir, targetDir, { recursive: true, force: true })

console.log(`synced sample assets to ${path.relative(rootDir, targetDir)}`)
