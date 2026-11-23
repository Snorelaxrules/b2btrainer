/**
 * Tune plan-score weights to agree with a real player.
 *
 *   npm run tune -- [--player 5han] [--train 9d18a74c2112.ttrm,e85a2555dd2b.ttrm] [--n 400]
 *                   [--rounds 2] [--beam 16] [--max 48] [--from replays/tuned.json] [--out replays/tuned.json]
 *
 * --beam/--max: the passes each search runs (16 then 48 ≈ what the app's 200 ms finishes).
 * --from: start from weights a previous run wrote.
 *
 * Coordinate search: for each weight, try ×0.5 and ×1.6 (or a small value if it
 * is 0) and keep a change only if agreement on the TRAINING sample improves.
 * The held-out matches (and other players) are scored at the end only, so the
 * report shows whether a gain is real or just fitted to the training games.
 * Searches are deterministic (fixed beam, no time limit) and run in parallel.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { PLAN_SCORE, PLAN_SEARCH, type PlanScoreConfig } from '../src/config/planScore.ts'
import { type Agreement, type ReplayPosition, type SearchSettings, agreement, agreementScore, spread } from '../src/harness/agreement.ts'

interface Job {
  positions: ReplayPosition[]
  search: SearchSettings
  score: PlanScoreConfig
  partialStack: number
}

if (!isMainThread) {
  const job = workerData as Job
  const out = job.positions.map((p) => agreement(p, job.search, job.score, { ...PLAN_SEARCH, partialStack: job.partialStack }))
  parentPort!.postMessage(out)
} else {
  await main()
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (name: string, def: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : def
  }
  const file = opt('data', 'replays/dataset.json')
  const player = opt('player', '5han')
  const train = opt('train', '9d18a74c2112.ttrm,e85a2555dd2b.ttrm').split(',')
  const n = Number(opt('n', '400'))
  const rounds = Number(opt('rounds', '2'))
  const beam = Number(opt('beam', '16'))
  const beamMax = Number(opt('max', String(beam)))
  const from = opt('from', '')
  const out = opt('out', 'replays/tuned.json')
  const threads = Math.max(1, availableParallelism() - 1)

  const all: ReplayPosition[] = JSON.parse(readFileSync(file, 'utf8')).positions
  // a player's own B2B breaks can never agree: leave them out of the objective
  const mine = all.filter((p) => p.player === player)
  const trainSet = spread(mine.filter((p) => train.includes(p.source)), n)
  const heldOut = spread(mine.filter((p) => !train.includes(p.source)), n)
  const others = spread(all.filter((p) => p.player !== player), n)
  const search: SearchSettings = { budgetMs: Infinity, beam, beamMax }

  async function evaluate(positions: ReplayPosition[], score: PlanScoreConfig, partialStack: number): Promise<Agreement[]> {
    const chunks = Array.from({ length: threads }, (_, i) => positions.filter((_, j) => j % threads === i))
    const parts = await Promise.all(
      chunks.map(
        (chunk) =>
          new Promise<Agreement[]>((resolve, reject) => {
            const w = new Worker(new URL(import.meta.url), { workerData: { positions: chunk, search, score, partialStack } satisfies Job })
            w.once('message', resolve)
            w.once('error', reject)
          }),
      ),
    )
    // restore the original order
    const res: Agreement[] = new Array(positions.length)
    parts.forEach((part, i) => part.forEach((a, k) => (res[i + k * threads] = a)))
    return res
  }

  const fmt = (a: Agreement[]) => {
    const pct = (k: 'top1' | 'top3') => ((100 * a.filter((x) => x[k]).length) / a.length).toFixed(1)
    return `top-1 ${pct('top1')}% · top-3 ${pct('top3')}% · objective ${(100 * agreementScore(a)).toFixed(1)}`
  }

  type Knob = { name: string; get: () => number; set: (v: number) => void }
  const start = from ? JSON.parse(readFileSync(from, 'utf8')) : null
  let cfg: PlanScoreConfig = { ...PLAN_SCORE, ...(start?.score ?? {}) }
  let partialStack: number = start?.partialStack ?? PLAN_SEARCH.partialStack
  const knobs: Knob[] = [
    ...(
      [
        'attack', 'chainLink', 'chainMiniFactor', 'chainBonus', 'fullSpin', 'piecesUsed', 'holdUsed',
        'sealed', 'unsafeDig', 'overhang', 'bumpiness', 'bumpSquared', 'noCleanSpot', 'iWell', 'iRow',
        'slotKnown', 'slotUnseen', 'tKept', 'tWasted', 'danger',
      ] as const
    ).map((k): Knob => ({ name: k, get: () => cfg[k], set: (v) => (cfg = { ...cfg, [k]: v }) })),
    { name: 'partialStack', get: () => partialStack, set: (v) => (partialStack = v) },
  ]

  const t0 = performance.now()
  let base = await evaluate(trainSet, cfg, partialStack)
  let best = agreementScore(base)
  console.log(`${threads} threads · beam ${beam}→${beamMax}${from ? ` · from ${from}` : ''} · train ${trainSet.length} (${train.join(', ')}) · held-out ${heldOut.length} · others ${others.length}`)
  console.log(`start   train ${fmt(base)}  (${((performance.now() - t0) / 1000).toFixed(0)} s per evaluation)`)

  for (let round = 1; round <= rounds; round++) {
    let changed = false
    for (const k of knobs) {
      const v0 = k.get()
      const tries = v0 === 0 ? [0.5, 1.5] : [v0 * 0.5, v0 * 1.6, ...(round === 1 ? [0] : [])]
      let bestV = v0
      for (const v of tries) {
        k.set(v)
        const a = await evaluate(trainSet, cfg, partialStack)
        const s = agreementScore(a)
        if (s > best + 0.5 / trainSet.length) {
          best = s
          bestV = v
          base = a
        }
      }
      k.set(bestV)
      if (bestV !== v0) {
        changed = true
        console.log(`  round ${round}: ${k.name} ${v0} → ${+bestV.toFixed(3)}   train ${fmt(base)}`)
      }
    }
    if (!changed) break
  }

  const changes = Object.fromEntries(
    Object.entries(cfg).filter(([k, v]) => (PLAN_SCORE as unknown as Record<string, number>)[k] !== v),
  )
  if (partialStack !== PLAN_SEARCH.partialStack) Object.assign(changes, { partialStack })
  writeFileSync(out, JSON.stringify({ player, train, beam, beamMax, changes, score: cfg, partialStack }, null, 2))
  console.log(`\nchanged: ${JSON.stringify(changes)}`)

  const [hoBefore, hoAfter, otBefore, otAfter] = [
    await evaluate(heldOut, PLAN_SCORE, PLAN_SEARCH.partialStack),
    await evaluate(heldOut, cfg, partialStack),
    await evaluate(others, PLAN_SCORE, PLAN_SEARCH.partialStack),
    await evaluate(others, cfg, partialStack),
  ]
  console.log(`held-out ${player} match   before ${fmt(hoBefore)}\n                          after  ${fmt(hoAfter)}`)
  console.log(`other players             before ${fmt(otBefore)}\n                          after  ${fmt(otAfter)}`)
  console.log(`wrote ${out} · ${((performance.now() - t0) / 60000).toFixed(1)} min`)
}
