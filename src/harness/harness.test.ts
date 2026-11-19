import { describe, expect, it } from 'vitest'
import { parsePosition } from './position'
import { analysePosition, formatPositionReport } from './report'

const FILES = import.meta.glob<unknown>('../../fixtures/*.json', { eager: true, import: 'default' })
const fixtures = Object.keys(FILES).map((path) => path.split('/').pop() as string)
const load = (name: string) => FILES[`../../fixtures/${name}`]

describe('position files', () => {
  it.each(fixtures)('%s parses', (f: string) => {
    const p = parsePosition(load(f), f)
    expect(p.board.length).toBeGreaterThan(0)
  })

  it('first queue piece is the one in hand; B2B is the in-game count', () => {
    const p = parsePosition({ name: 'x', board: ['#.........'], queue: 'TZS', hold: 'o', b2b: 40 })
    expect(p.current).toBe('T')
    expect(p.queue).toEqual(['Z', 'S'])
    expect(p.hold).toBe('O')
    expect(p.counters).toEqual({ b2b: 40, combo: -1 })
  })

  it('rejects malformed positions with a readable message', () => {
    expect(() => parsePosition({ board: ['#..'], queue: 'T' }, 'f.json')).toThrow(/f\.json: board row 1 is 3 wide/)
    expect(() => parsePosition({ board: ['..........'], queue: 'TQ' })).toThrow(/unknown pieces/)
    expect(() => parsePosition({ board: ['..........'], queue: 'T', ruleset: 'tsd' })).toThrow(/ruleset/)
  })
})

describe('harness', () => {
  it('scores each plan on its end stack and prints a breakdown that adds up', () => {
    const p = parsePosition(load('2026-11-19-i-dependency.json'))
    const r = analysePosition(p, { beam: 40, depth: 4 })
    expect(r.reports.length).toBeGreaterThan(0)
    for (const rep of r.reports) {
      expect(rep.score.terms.reduce((a, t) => a + t.points, 0)).toBeCloseTo(rep.score.total, 1)
    }
    // best score first
    expect(r.reports.map((x) => x.score.total)).toEqual([...r.reports.map((x) => x.score.total)].sort((a, b) => b - a))
    const text = formatPositionReport(r)
    expect(text).toMatch(/end stack:/)
    expect(text).toMatch(/total/)
  }, 30000)
})
