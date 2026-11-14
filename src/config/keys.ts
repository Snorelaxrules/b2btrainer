/**
 * Keybinds, by KeyboardEvent.code (physical key, layout independent).
 * Every action takes a list of codes; swap or add freely.
 * Undo / redo use modifier combos and are handled separately (see COMMAND_KEYS).
 */
export const KEYS = {
  moveLeft: ['ArrowLeft'],
  moveRight: ['ArrowRight'],
  softDrop: ['ArrowDown'],
  hardDrop: ['Space'],
  rotateCW: ['ArrowUp', 'KeyX'],
  rotateCCW: ['KeyZ'],
  rotate180: ['KeyA'],
  hold: ['ShiftLeft', 'ShiftRight', 'KeyC'],
  restart: ['KeyR'],
  toggleFinder: ['KeyF'],
} satisfies Record<string, string[]>

export type Action = keyof typeof KEYS

/** Ctrl (or ⌘ on macOS) combos and plain keys for history. */
export const COMMAND_KEYS = {
  /** with Ctrl/⌘ */
  undo: ['KeyZ'],
  /** with Ctrl/⌘; Ctrl/⌘+Shift+Z also redoes */
  redo: ['KeyY'],
  /** without modifiers */
  undoPlain: ['Backspace'],
  /** spin finder: next candidate (with Shift: previous) */
  cycle: ['Tab'],
}

export const KEY_ACTIONS: ReadonlyMap<string, Action> = new Map(
  (Object.entries(KEYS) as [Action, string[]][]).flatMap(([action, codes]) => codes.map((c) => [c, action] as const)),
)
