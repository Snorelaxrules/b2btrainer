/**
 * Headless planner harness: load positions from JSON, run the planner, print
 * each plan with its keys, end stack and per-term score breakdown.
 *
 *   npm run plan -- fixtures/some-position.json [more.json | a-folder] [options]
 *
 *   --depth N   pieces to plan over (1–6; default: everything known, max 6)
 *   --beam N    search width (default 100)
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
const opts: { depth?: number; beam?: number; top?: number; all?: boolean } = {}
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--all') opts.all = true
  else if (a === '--depth' || a === '--beam' || a === '--top') opts[a.slice(2) as 'depth' | 'beam' | 'top'] = Number(args[++i])
  else if (a.startsWith('--')) {
    console.error(`unknown option ${a}`)
    process.exit(2)
  } else if (statSync(a).isDirectory()) {
    for (const f of readdirSync(a).sort()) if (f.endsWith('.json')) files.push(join(a, f))
  } else files.push(a)
}
if (!files.length) {
  console.error('usage: npm run plan -- <position.json | folder> [--depth N] [--beam N] [--top N] [--all]')
  process.exit(2)
}

for (const f of files) {
  const pos = parsePosition(JSON.parse(readFileSync(f, 'utf8')), f)
  console.log(formatPositionReport(analysePosition(pos, opts), opts))
  console.log()
}
