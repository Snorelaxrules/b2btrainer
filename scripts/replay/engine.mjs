/**
 * TETR.IO replay engine setup (dev tool only, never bundled into the app).
 * Uses @haelp/teto's engine, which reproduces TETR.IO frame by frame: options a
 * replay doesn't list fall back to TETR.IO's defaults here.
 */
import { Engine } from '@haelp/teto/engine'
export function makeEngine(o, opponents) {
  return new Engine({
    multiplayer: { opponents, passthrough: o.passthrough ?? 'zero' },
    board: { width: o.boardwidth ?? 10, height: o.boardheight ?? 20, buffer: 20 },
    kickTable: o.kickset ?? 'SRS+',
    options: {
      comboTable: o.combotable ?? 'multiplier',
      garbageBlocking: o.garbageblocking ?? 'combo blocking',
      clutch: o.clutch ?? true,
      garbageTargetBonus: o.garbagetargetbonus ?? 'none',
      spinBonuses: o.spinbonuses ?? 'all-mini+',
      stock: o.stock ?? 0,
    },
    queue: { minLength: 31, seed: o.seed, type: o.bagtype ?? '7-bag' },
    garbage: {
      cap: { absolute: o.garbageabsolutecap ?? 0, increase: o.garbagecapincrease ?? 0, max: o.garbagecapmax ?? 40, value: o.garbagecap ?? 8, marginTime: o.garbagecapmargin ?? 0 },
      multiplier: { value: o.garbagemultiplier ?? 1, increase: o.garbageincrease ?? 0.008, marginTime: o.garbagemargin ?? 10800 },
      boardWidth: o.boardwidth ?? 10,
      garbage: { speed: o.garbagespeed ?? 20, holeSize: o.garbageholesize ?? 1 },
      messiness: { change: o.messiness_change ?? 1, nosame: o.messiness_nosame ?? false, timeout: o.messiness_timeout ?? 0, within: o.messiness_inner ?? 0, center: o.messiness_center ?? false },
      bombs: o.usebombs ?? false,
      seed: o.seed,
      rounding: o.roundmode ?? 'down',
      openerPhase: o.openerphase ?? 0,
      specialBonus: o.garbagespecialbonus ?? false,
    },
    pc: (o.allclears ?? true) ? { garbage: o.allclear_garbage ?? 10, b2b: o.allclear_b2b ?? 0 } : false,
    b2b: { chaining: o.b2bchaining ?? false, charging: (o.b2bcharging ?? false) ? { at: o.b2bcharge_at ?? 4, base: o.b2bcharge_base ?? 3 } : false },
    gravity: { value: o.g ?? 0.02, increase: o.gincrease ?? 0, marginTime: o.gmargin ?? 0 },
    misc: {
      movement: { infinite: o.infinite_movement ?? false, lockResets: o.lockresets ?? 15, lockTime: o.locktime ?? 30, may20G: o.gravitymay20g ?? false },
      allowed: { spin180: o.allow180 ?? true, hardDrop: o.allow_harddrop ?? true, hold: o.display_hold ?? true, undo: false, retry: false },
      infiniteHold: o.infinite_hold ?? false,
      stride: o.stride ?? false,
      username: o.username,
      date: new Date(),
    },
    handling: o.handling,
  })
}
export function framesOf(events) {
  const by = new Map()
  for (const e of events) {
    if (e.type !== 'keydown' && e.type !== 'keyup' && e.type !== 'ige') continue
    if (!by.has(e.frame)) by.set(e.frame, [])
    by.get(e.frame).push(e)
  }
  return by
}
