import { expect, it } from 'vitest'
import * as G from './game'
import { findPlacements } from './finder'
import { type PlanRequest, replayPlan, searchPlans } from './planner'
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

it('every plan the planner returns replays exactly in the real engine', { timeout: 120_000 }, () => {
  const failures: string[] = []
  let total = 0
  for (let seed = 1; seed <= 40; seed++) {
    const s = randomState(seed, 6 + (seed % 9))
    if (s.over || !s.active) continue
    const req: PlanRequest = {
      board: s.board,
      counters: s.counters,
      current: s.active.type,
      hold: s.hold,
      holdUsed: s.holdUsed,
      queue: s.queue.slice(0, 5),
      depth: 5,
      beam: 30,
      spinRule: 'allmini+',
    }
    const plans = searchPlans(req, undefined, 3, { verify: false })
    for (const p of plans) {
      total++
      const v = verifyPlan(s, p)
      if (!v.ok) failures.push(`seed ${seed}: ${p.summary} — step ${v.step}: ${v.reason}`)
    }
  }
  expect(total).toBeGreaterThan(50)
  expect(failures).toEqual([])
})

it('also holds for used-hold roots, every spin rule, depth 6, and replayed (followed) plans', { timeout: 300_000 }, () => {
  const failures: string[] = []
  let total = 0
  const rules = ['tspin', 'allmini+', 'allspin'] as const
  for (let seed = 100; seed < 160; seed++) {
    let s = randomState(seed, 4 + (seed % 11))
    if (s.over || !s.active) continue
    if (seed % 3 === 0) s = G.hold(s) // root with hold already used
    const spinRule = rules[seed % 3]
    s = { ...s, rules: { ...s.rules, spinRule } }
    const req: PlanRequest = {
      board: s.board,
      counters: seed % 2 ? { b2b: seed % 7, combo: (seed % 4) - 1 } : s.counters,
      current: s.active!.type,
      hold: s.hold,
      holdUsed: s.holdUsed,
      queue: s.queue.slice(0, 5),
      depth: seed % 4 === 0 ? 6 : 4,
      beam: 20,
      spinRule,
    }
    const start = { ...s, counters: req.counters }
    for (const p of searchPlans(req, undefined, 3, { verify: false })) {
      total++
      const v = verifyPlan(start, p)
      if (!v.ok) {
        failures.push(`seed ${seed}: ${p.summary} — step ${v.step}: ${v.reason}`)
        continue
      }
      // follow step 1 in the engine, then re-plan the rest the way a locked plan does
      if (p.steps.length < 2) continue
      const first = { ...p, steps: p.steps.slice(0, 1) }
      let after = start
      if (first.steps[0].viaHold) after = G.hold(after)
      after = G.lockPiece(after, first.steps[0].piece)
      const req2: PlanRequest = {
        ...req,
        board: after.board,
        counters: after.counters,
        current: after.active!.type,
        hold: after.hold,
        holdUsed: after.holdUsed,
        queue: after.queue.slice(0, 5),
      }
      const rest = replayPlan(req2, p.steps.slice(1).map((x) => ({ piece: x.piece, viaHold: x.viaHold })))
      total++
      if (!rest) failures.push(`seed ${seed}: follow replay rejected a valid continuation of ${p.summary}`)
      else {
        const v2 = verifyPlan(after, rest)
        if (!v2.ok) failures.push(`seed ${seed}: followed ${rest.summary} — step ${v2.step}: ${v2.reason}`)
      }
    }
  }
  expect(total).toBeGreaterThan(100)
  expect(failures).toEqual([])
})
