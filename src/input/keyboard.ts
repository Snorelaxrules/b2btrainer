/**
 * DOM keyboard binding. Translates KeyboardEvents into controller actions and
 * history commands. Returns a cleanup function that removes every listener.
 */
import { type Action, COMMAND_KEYS, KEY_ACTIONS } from '../config/keys'

export interface KeyboardHandlers {
  press(action: Action, t: number): void
  release(action: Action, t: number): void
  undo(): void
  redo(): void
  /** window lost focus: drop all held keys */
  blur(): void
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/** event time on the performance.now() timeline */
function stamp(e: Event) {
  const now = performance.now()
  return e.timeStamp > 0 && e.timeStamp <= now ? e.timeStamp : now
}

export function bindKeyboard(target: Window, h: KeyboardHandlers): () => void {
  const down = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return
    const mod = e.ctrlKey || e.metaKey
    if (mod) {
      // Ctrl/⌘ combos are commands only, never game actions
      if (COMMAND_KEYS.undo.includes(e.code)) {
        e.preventDefault()
        if (e.shiftKey) h.redo()
        else h.undo()
      } else if (COMMAND_KEYS.redo.includes(e.code)) {
        e.preventDefault()
        h.redo()
      }
      return
    }
    if (COMMAND_KEYS.undoPlain.includes(e.code)) {
      e.preventDefault()
      h.undo()
      return
    }
    const action = KEY_ACTIONS.get(e.code)
    if (!action) return
    e.preventDefault()
    if (e.repeat) return
    h.press(action, stamp(e))
  }
  const up = (e: KeyboardEvent) => {
    const action = KEY_ACTIONS.get(e.code)
    if (!action) return
    // stop Space/Enter from "clicking" a focused button on keyup
    if (!isTyping(e.target)) e.preventDefault()
    h.release(action, stamp(e))
  }
  const blur = () => h.blur()
  target.addEventListener('keydown', down)
  target.addEventListener('keyup', up)
  target.addEventListener('blur', blur)
  return () => {
    target.removeEventListener('keydown', down)
    target.removeEventListener('keyup', up)
    target.removeEventListener('blur', blur)
  }
}
