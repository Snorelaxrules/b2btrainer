/**
 * Headless planner harness: load positions from JSON, run the planner, print
 * each plan with its keys, end stack and per-term score breakdown.
 *
 *   npm run plan -- fixtures/some-position.json [more.json | a-folder] [options]
 *
 *   --depth N   most pieces a plan may use (default: every known piece)
 *   --beam N    first-pass beam width (default 16; each pass triples it)
 *   --max N     widest pass (default 432)
 *   --budget MS time limit like the app (default: none, so results are reproducible)
 *   --top N     plans to show (default 3)
 *   --all       show zero-point terms too
 *
 * Weights: src/config/planScore.ts. Position format: src/harness/position.ts.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parsePosition } from '../src/harness/position.ts'
import { analysePosition, formatPositionReport } from '../src/harness/report.ts'

const args = process.argv.slice(2)
const files: string[] = []
const opts: { depth?: number; beam?: number; beamMax?: number; budget?: number; top?: number; all?: boolean } = {}
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--all') opts.all = true
  else if (a === '--depth' || a === '--beam' || a === '--top' || a === '--budget') opts[a.slice(2) as 'depth' | 'beam' | 'top' | 'budget'] = Number(args[++i])
  else if (a === '--max') opts.beamMax = Number(args[++i])
  else if (a.startsWith('--')) {
    console.error(`unknown option ${a}`)
    process.exit(2)
  } else if (statSync(a).isDirectory()) {
    for (const f of readdirSync(a).sort()) if (f.endsWith('.json')) files.push(join(a, f))
  } else files.push(a)
}
if (!files.length) {
  console.error('usage: npm run plan -- <position.json | folder> [--depth N] [--beam N] [--max N] [--budget MS] [--top N] [--all]')
  process.exit(2)
}

for (const f of files) {
  const pos = parsePosition(JSON.parse(readFileSync(f, 'utf8')), f)
  console.log(formatPositionReport(analysePosition(pos, opts), opts))
  console.log()
}
