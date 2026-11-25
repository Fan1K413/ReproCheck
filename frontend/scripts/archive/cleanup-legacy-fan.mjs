/* 一次性清理：移除已被 PetalStage 取代的 FeatureFan 样式与旧 meta 样式。 */
import fs from 'node:fs'

const FILE = './src/styles/workbench.css'
let css = fs.readFileSync(FILE, 'utf8')
const before = css.length

css = css.replace(/(^|\n)[ \t]*\.[^{}]*rc-fan[^{}]*\{[^{}]*\}\n?/g, '\n')
css = css.replace(/@keyframes rc-fan[^{]*\{[\s\S]*?\n\}\n?/g, '')
css = css.replace(/(^|\n)[ \t]*\.rc-core__meta[^{}]*\{[^{}]*\}\n?/g, '\n')
css = css.replace(/\n{3,}/g, '\n\n')

fs.writeFileSync(FILE, css, 'utf8')
console.log(JSON.stringify({ before, after: css.length, removed: before - css.length }))
