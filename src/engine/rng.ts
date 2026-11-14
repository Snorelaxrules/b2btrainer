/**
 * Seeded 7-bag randomizer whose whole state is plain data, so a game snapshot
 * (and therefore undo) captures it exactly.
 *
 * The generator is the Park–Miller "minimal standard" LCG (x = 16807·x mod 2^31−1)
 * with the bag shuffled from the order Z L O S I J T. This is the scheme
 * TETR.IO's client is widely documented to use for its seeded bags, so a seed
 * here *should* give the same sequence as a TETR.IO custom room with that seed.
 * That match is unverified; the trainer only relies on it being deterministic.
 */
import type { PieceType } from './pieces'

const MOD = 2147483647
const BAG_ORDER: readonly PieceType[] = ['Z', 'L', 'O', 'S', 'I', 'J', 'T']

export interface BagState {
  /** LCG state, 1 … 2^31−2 */
  readonly rng: number
  /** pieces left in the current bag, next one first */
  readonly pending: readonly PieceType[]
}

export function normalizeSeed(seed: number): number {
  let t = Math.floor(Math.abs(seed)) % MOD
  if (t <= 0) t += MOD - 1
  return t
}

export function newBag(seed: number): BagState {
  return { rng: normalizeSeed(seed), pending: [] }
}

/** 16807 · t < 2^53, so plain double arithmetic is exact. */
function step(t: number): number {
  return (16807 * t) % MOD
}

function shuffle(rng: number): { rng: number; bag: PieceType[] } {
  const bag = [...BAG_ORDER]
  let t = rng
  for (let i = bag.length - 1; i > 0; i--) {
    t = step(t)
    const j = Math.floor(((t - 1) / (MOD - 1)) * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return { rng: t, bag }
}

export function drawPiece(state: BagState): { piece: PieceType; bag: BagState } {
  let { rng, pending } = state
  if (pending.length === 0) {
    const s = shuffle(rng)
    rng = s.rng
    pending = s.bag
  }
  return { piece: pending[0], bag: { rng, pending: pending.slice(1) } }
}

export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * (MOD - 2))
}
