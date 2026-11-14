import type { PieceType } from '../engine/pieces'

/** Standard guideline hues, tuned to stay distinct from each other on a dark well. */
export const PIECE_COLORS: Record<PieceType, string> = {
  I: '#3fd0f0',
  O: '#f5d142',
  T: '#b061f0',
  S: '#5ad35a',
  Z: '#f0545c',
  J: '#4a6cf0',
  L: '#f0923a',
}

export const THEME = {
  bg: '#0e1016',
  well: '#07080c',
  grid: 'rgba(255,255,255,0.045)',
  wellEdge: 'rgba(255,255,255,0.28)',
  buffer: 'rgba(255,255,255,0.025)',
  garbage: '#6b6f7a',
  dead: '#3a3d47',
  ghostAlpha: 0.28,
  label: '#8a90a0',
}
