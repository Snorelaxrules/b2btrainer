/**
 * Fixture runner: every fixtures/*.json with an `expected` block is a test.
 *
 *   npm run fixtures -- [folder or files] [--budget MS] [--beam N] [--max N]
 *
 * A fixture passes when the best plan
 *   - has at least `expected.minChainLength` spin clears, and
 *   - contains `expected.expectedClears` in that order (other clears may sit between), and
 *   - starts with `expected.firstMove` when given: { "type": "T", "cells": [[x,y],…], "viaHold": false }
 *     (a known player's move, e.g. copied from a replay position).
 * Without --budget the search runs every pass, so results are the same on every machine.
 * Exit code 1 if any fixture fails.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parsePosition } from '../src/harness/position.ts'
import { analysePosition } from '../src/harness/report.ts'

const args = process.argv.slice(2)
const opts: { budget?: number; beam?: number; beamMax?: number } = {}
const paths: string[] = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--budget') opts.budget = Number(args[++i])
  else if (a === '--beam') opts.beam = Number(args[++i])
  else if (a === '--max') opts.beamMax = Number(args[++i])
  else paths.push(a)
}
if (!paths.length) paths.push('fixtures')
const files = paths.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.json')).sort().map((f) => join(p, f)) : [p]))

const key = (cells: readonly (readonly [number, number])[]) =>
  cells
    .map(([x, y]) => y * 16 + x)
    .sort((a, b) => a - b)
    .join(',')

let pass = 0
let fail = 0
let skipped = 0
for (const f of files) {
  const raw = JSON.parse(readFileSync(f, 'utf8'))
  const pos = parsePosition(raw, f)
  const exp = raw.expected as
    | { minChainLength?: number; expectedClears?: string[]; firstMove?: { type: string; cells: [number, number][]; viaHold?: boolean } }
    | undefined
  if (!exp) {
    skipped++
    continue
  }
  const r = analysePosition(pos, { budget: opts.budget, beam: opts.beam, beamMax: opts.beamMax, top: 3 })
  const best = r.reports[0]?.plan
  const problems: string[] = []
  if (!best) problems.push('no plan found')
  else {
    if (exp.minChainLength != null && best.chain < exp.minChainLength) problems.push(`chain ${best.chain} < ${exp.minChainLength}`)
    if (exp.expectedClears?.length) {
      const got = best.steps.filter((s) => s.result.lines > 0).map((s) => s.result.label)
      let i = 0
      for (const g of got) if (g === exp.expectedClears[i]) i++
      if (i < exp.expectedClears.length) problems.push(`clears [${got.join(', ')}] miss ${exp.expectedClears.slice(i).join(', ')}`)
    }
    if (exp.firstMove) {
      const s = best.steps[0]
      const ok = s.type === exp.firstMove.type && key(s.cells) === key(exp.firstMove.cells) && (exp.firstMove.viaHold == null || s.viaHold === exp.firstMove.viaHold)
      if (!ok) problems.push(`first move ${s.viaHold ? 'hold→' : ''}${s.type} at ${key(s.cells)}, expected ${exp.firstMove.type} at ${key(exp.firstMove.cells)}`)
    }
  }
  const tag = `${pos.name} (${f})`
  if (problems.length) {
    fail++
    console.log(`FAIL ${tag}\n     best: ${best?.summary ?? '-'}\n     ${problems.join('\n     ')}`)
  } else {
    pass++
    console.log(`pass ${tag}\n     ${best!.summary} · ${r.ms.toFixed(0)} ms`)
  }
}
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} without expectations` : ''}`)
process.exit(fail ? 1 : 0)
