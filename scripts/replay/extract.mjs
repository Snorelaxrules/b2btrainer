// Extract every decision (one per piece placed) from .ttrm / .ttr replays.
// usage: npm run extract -- replays/dataset.json replays/*.ttrm
// Each record: the position at the start of the turn and where the player put the piece.
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { framesOf, makeEngine } from './engine.mjs'

const [out, ...files] = process.argv.slice(2)
const positions = []
const summary = []

const rowsOf = (eng) => {
  const st = eng.board.state
  let top = 0
  for (let y = 0; y < st.length; y++) if (st[y].some((c) => c)) top = y + 1
  const rows = []
  for (let y = top - 1; y >= 0; y--) rows.push(st[y].map((c) => (c ? (c.mino === 'gb' ? 'G' : c.mino.toUpperCase()) : '.')).join(''))
  return rows
}

function run(file, label, round, p, opponents) {
  const r = p.replay
  const o = r.options
  const eng = makeEngine(o, opponents)
  const by = framesOf(r.events)
  let turn = null
  let n = 0
  eng.events.on('falling.new', (e) => {
    if (e.isHold) {
      if (turn) turn.held = true
      return
    }
    turn = {
      board: rowsOf(eng),
      current: String(e.piece).toUpperCase(),
      hold: eng.held ? String(eng.held).toUpperCase() : null,
      queue: eng.queue.slice(0, 5).map((m) => String(m).toUpperCase()),
      b2b: eng.stats.b2b,
      combo: eng.stats.combo,
      incoming: eng.garbageQueue.size ?? null,
      frame: eng.frame,
      held: false,
    }
  })
  eng.events.on('falling.lock.pre', () => {
    if (!turn) return
    const f = eng.falling
    positions.push({
      source: label,
      round,
      player: p.username,
      won: p.alive,
      n: ++n,
      frame: turn.frame,
      ruleset: o.spinbonuses === 'T-spins' ? 'tspin' : o.spinbonuses === 'all' ? 'allspin' : 'allmini+',
      board: turn.board,
      current: turn.current,
      hold: turn.hold,
      queue: turn.queue,
      b2b: turn.b2b,
      combo: turn.combo,
      incoming: turn.incoming,
      chosen: {
        type: String(f.symbol).toUpperCase(),
        viaHold: turn.held,
        cells: f.absoluteBlocks.map(([x, y]) => [x, y]),
      },
    })
    turn = null
  })
  let f = 0
  for (; f <= r.frames; f++) {
    eng.tick(by.get(f) ?? [])
    if (eng.toppedOut) break
  }
  summary.push(`${label} R${round} ${p.username}: ${n} placements, attack ${eng.stats.garbage.sent}, ${eng.toppedOut ? 'topped out' : 'survived'}`)
}

for (const file of files) {
  const rep = JSON.parse(readFileSync(file, 'utf8'))
  const label = basename(file)
  if (rep.replay.rounds) {
    rep.replay.rounds.forEach((round, i) => {
      for (const p of round) run(file, label, i + 1, p, round.filter((q) => q !== p).map((q) => q.replay.options.gameid))
    })
  } else {
    run(file, label, 1, { username: rep.users?.[0]?.username ?? '?', alive: true, replay: rep.replay }, [])
  }
}
writeFileSync(out, JSON.stringify({ created: new Date().toISOString(), positions }, null, 0))
console.log(summary.join('\n'))
console.log(`${positions.length} positions → ${out}`)
