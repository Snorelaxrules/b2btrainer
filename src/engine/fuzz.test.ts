import { expect, it } from 'vitest'
import { PLAN_SCORE } from '../config/planScore'
import { remapAfterClear } from '../app/planner'
import { sealedHoles, heights } from './features'
import * as G from './game'
import { findPlacements } from './finder'
import { type PlanRequest, completePlan, searchPlans } from './planner'
import { verifyPlan } from './verify'

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** play `n` random but legal placements (lowish ones) to get a messy realistic board */
function randomState(seed: number, n: number): G.GameState {
  const r = rng(seed)
  let s = G.newGame({ seed })
  for (let i = 0; i < n && !s.over; i++) {
    if (r() < 0.25) s = G.hold(s)
    const c = findPlacements(s.board, s.active!.type, s.counters, false, { spinRule: 'allmini+' })
    const low = c.sort((a, b) => Math.max(...a.cells.map((x) => x[1])) - Math.max(...b.cells.map((x) => x[1]))).slice(0, 8)
    s = G.lockPiece(s, low[Math.floor(r() * low.length)].piece)
  }
  return s
}

const RULES = ['tspin', 'allmini+', 'allspin'] as const

it('every plan replays exactly in the engine and obeys the hard prunes and the spin rule', { timeout: 300_000 }, () => {
  const failures: string[] = []
  let total = 0
  for (let seed = 1; seed <= 45; seed++) {
    let s0 = randomState(seed, 6 + (seed % 9))
    if (s0.over || !s0.active) continue
    if (seed % 5 === 0) s0 = G.hold(s0) // root with hold already used
    const spinRule = RULES[seed % 3]
    // an active streak, so B2B-breaking placements exist and must be pruned
    const s = { ...s0, counters: { b2b: 1 + (seed % 5), combo: (seed % 3) - 1 }, rules: { ...s0.rules, spinRule } }
    const req: PlanRequest = {
      board: s.board,
      counters: s.counters,
      current: s.active!.type,
      hold: s.hold,
      holdUsed: s.holdUsed,
      queue: s.queue.slice(0, 5),
      depth: seed % 4 === 0 ? 6 : 5,
      spinRule,
      budgetMs: Infinity,
      beam: 8,
      beamMax: 24,
    }
    for (const p of searchPlans(req, undefined, 3, { verify: false })) {
      total++
      const tag = `seed ${seed} (${spinRule}): ${p.summary}`
      const v = verifyPlan(s, p)
      if (!v.ok) {
        failures.push(`${tag} — step ${v.step}: ${v.reason}`)
        continue
      }
      let st: G.GameState = s
      const sealed0 = sealedHoles(st.board)
      for (const step of p.steps) {
        if (step.result.b2bChange === 'broken') failures.push(`${tag} breaks B2B`)
        if (spinRule === 'tspin' && step.type !== 'T' && step.result.spin !== 'none') failures.push(`${tag}: a ${step.type} counted as a spin under T-spins only`)
        if (step.viaHold) st = G.hold(st)
        st = G.lockPiece(st, step.piece)
        if (Math.max(...heights(st.board)) > PLAN_SCORE.heightLimit) failures.push(`${tag}: step ${step.n} is too tall`)
      }
      // mid-plan a spin may seal a cell a later clear reopens; a finished plan leaves none
      if (sealedHoles(st.board) > sealed0) failures.push(`${tag}: ends with a hole sealed off`)
      const spins = p.steps.filter((x) => x.result.lines > 0 && x.result.spin !== 'none').length
      if (spins !== p.chain) failures.push(`${tag}: chain ${p.chain} but ${spins} spin clears`)
      if (p.kind === 'chain' && !p.payoffs.includes(p.steps.length - 1)) failures.push(`${tag}: a chain must end on its last clear`)
      if (Math.abs(p.terms.reduce((a, t) => a + t.points, 0) - p.score) > 0.05) failures.push(`${tag}: terms don't add up`)

      // follow step 1 in the engine, then finish the rest the way a locked plan does
      if (p.steps.length < 2) continue
      let after: G.GameState = s
      if (p.steps[0].viaHold) after = G.hold(after)
      const first = p.steps[0]
      const rest = remapAfterClear(
        after.board,
        G.pieceCells(first.piece),
        p.steps.slice(1).map((x) => ({ type: x.type, cells: x.cells })),
      )
      after = G.lockPiece(after, first.piece)
      if (!rest) continue // step 1 cleared a row a later step used: the app replans then
      const req2: PlanRequest = { ...req, board: after.board, counters: after.counters, current: after.active!.type, hold: after.hold, holdUsed: after.holdUsed, queue: after.queue.slice(0, 5) }
      const done = completePlan(req2, rest)
      total++
      if (!done) failures.push(`${tag}: following step 1 lost the plan`)
      else {
        const v2 = verifyPlan(after, done)
        if (!v2.ok) failures.push(`${tag}: followed — step ${v2.step}: ${v2.reason}`)
      }
    }
  }
  expect(total).toBeGreaterThan(80)
  expect(failures).toEqual([])
})
