/**
 * How often does the planner agree with a real player? Reads positions extracted
 * from replays (npm run extract) and compares each player's actual placement with
 * the planner's plans.
 *
 *   npm run agree -- [replays/dataset.json] [--player NAME] [--source FILE] [--n N]
 *                    [--budget MS | --beam N] [--tuned replays/tuned.json] [--misses N]
 *
 * --budget uses the app's time-limited search (default 200 ms); --beam N runs a
 * fixed, reproducible single pass instead. --tuned applies weights from npm run tune.
 */
import { readFileSync } from 'node:fs'
import { PLAN_SCORE, PLAN_SEARCH, type PlanScoreConfig } from '../src/config/planScore.ts'
import { type Agreement, type ReplayPosition, type SearchSettings, agreement, spread } from '../src/harness/agreement.ts'

const args = process.argv.slice(2)
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const file = args[0] && !args[0].startsWith('--') ? args[0] : 'replays/dataset.json'
const player = opt('player')
const source = opt('source')
const n = Number(opt('n') ?? 400)
const showMisses = Number(opt('misses') ?? 6)
const beam = opt('beam')
const search: SearchSettings = beam ? { budgetMs: Infinity, beam: Number(beam), beamMax: Number(beam) } : { budgetMs: Number(opt('budget') ?? 200) }
let score: PlanScoreConfig = PLAN_SCORE
let searchCfg = PLAN_SEARCH
const tuned = opt('tuned')
if (tuned) {
  const t = JSON.parse(readFileSync(tuned, 'utf8'))
  score = { ...PLAN_SCORE, ...t.score }
  searchCfg = { ...PLAN_SEARCH, partialStack: t.partialStack ?? PLAN_SEARCH.partialStack }
}

const all: ReplayPosition[] = JSON.parse(readFileSync(file, 'utf8')).positions
const sample = spread(
  all.filter((p) => (!player || p.player === player) && (!source || p.source === source)),
  n,
)

const results: { p: ReplayPosition; a: Agreement }[] = []
const t0 = performance.now()
for (const p of sample) {
  results.push({ p, a: agreement(p, search, score, searchCfg) })
  if (results.length % 50 === 0) process.stderr.write(`  ${results.length}/${sample.length}\n`)
}
const ms = (performance.now() - t0) / Math.max(1, results.length)

const pct = (k: number, of: number) => (of ? `${((100 * k) / of).toFixed(1)}%` : '-')
const count = (f: (a: Agreement) => boolean, xs = results) => xs.filter((r) => f(r.a)).length
const what = beam ? `beam ${beam}` : `budget ${search.budgetMs} ms`
console.log(`positions ${results.length} (${player ?? 'all players'}${source ? `, ${source}` : ''}, ${what}${tuned ? `, weights ${tuned}` : ''}, avg ${ms.toFixed(0)} ms)`)
console.log(`their placement reachable by our move search: ${pct(count((a) => a.reachable), results.length)}`)
console.log(`their move broke B2B (our planner never does): ${pct(count((a) => a.theyBroke), results.length)}`)
console.log(
  `top-1 ${pct(count((a) => a.top1), results.length)} · top-3 ${pct(count((a) => a.top3), results.length)} · their piece somewhere in our best plan ${pct(count((a) => a.inPlan), results.length)}`,
)
console.log('\nby situation (their move):')
const groups = new Map<string, typeof results>()
for (const r of results) groups.set(r.a.situation, [...(groups.get(r.a.situation) ?? []), r])
for (const [k, xs] of [...groups].sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${k.padEnd(28)} ${String(xs.length).padStart(5)}   top-1 ${pct(count((a) => a.top1, xs), xs.length).padStart(6)}   top-3 ${pct(count((a) => a.top3, xs), xs.length).padStart(6)}`)
const misses = results.filter((r) => !r.a.top3 && r.a.reachable).slice(0, showMisses)
if (misses.length) {
  console.log('\nsome misses:')
  for (const { p, a } of misses) {
    console.log(`${p.source} R${p.round} ${p.player} #${p.n} · hand ${p.current} hold ${p.hold ?? '-'} queue ${p.queue.join('')} · B2B ${p.b2b}`)
    for (const row of p.board.slice(-10)) console.log(`    ${row}`)
    console.log(`  they: ${a.theirs}\n  we:   ${a.ours}\n`)
  }
}
