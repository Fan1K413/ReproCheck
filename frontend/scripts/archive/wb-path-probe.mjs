import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve('../.screenshots/workbench-radial/_probe')
const file = path.join(dir, 'probe.txt')
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(file, 'probe')
console.log('cwd    ', process.cwd())
console.log('dir    ', dir)
console.log('real   ', fs.realpathSync(dir))
console.log('exists ', fs.existsSync(file))
