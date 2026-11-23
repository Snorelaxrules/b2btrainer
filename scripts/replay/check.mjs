// Replay every round of a .ttrm through teto's engine and compare with the recorded stats.
// usage: node scripts/replay/check.mjs <match.ttrm>
import { readFileSync } from 'node:fs'
import { makeEngine, framesOf } from './engine.mjs'
  const rep = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  rep.replay.rounds.forEach((round, ri) => {
    for (const p of round) {
      const r = p.replay
      const o = r.options
      const others = round.filter((q) => q !== p).map((q) => q.replay.options.gameid)
      const eng = makeEngine(o, others)
      const by = framesOf(r.events)
      let sent = 0
      eng.events.on('falling.lock', (x) => { sent += (x.garbage ?? []).reduce((a, b) => a + b, 0) })
      let f = 0
      for (; f <= r.frames; f++) {
        eng.tick(by.get(f) ?? [])
        if (eng.toppedOut) break
      }
      const s = p.stats
      const realPieces = Math.round((s.pps * p.lifetime) / 1000)
      console.log(`R${ri + 1} ${p.username.padEnd(12)} ${p.alive ? 'won ' : 'lost'} | sim pieces ${String(eng.stats.pieces).padStart(4)} (real ~${realPieces}) sent ${String(eng.stats.garbage.sent).padStart(3)} (real ${s.garbagesent}) recv ${String(eng.stats.garbage.receive).padStart(3)} (real ${s.garbagereceived}) b2b ${eng.stats.b2b} (real ${s.btb}) ${eng.toppedOut ? `TOPPED OUT f${f}/${r.frames}` : 'ran to end'}`)
    }
  })
