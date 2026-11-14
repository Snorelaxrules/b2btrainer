const ROWS: [string, string][] = [
  ['← →', 'move (DAS/ARR in Handling)'],
  ['↓', 'soft drop (no lock)'],
  ['Space', 'hard drop'],
  ['↑ / X', 'rotate CW'],
  ['Z', 'rotate CCW'],
  ['A', 'rotate 180'],
  ['Shift / C', 'hold'],
  ['Ctrl+Z / ⌫', 'undo'],
  ['Ctrl+Y / Ctrl+Shift+Z', 'redo'],
  ['R', 'restart'],
  ['P', 'find a spin setup from here / stop'],
  ['Tab / Shift+Tab', 'next / previous plan'],
]

export function ControlsHelp() {
  return (
    <details className="panel" open>
      <summary>
        <h2>Controls</h2>
      </summary>
      <table className="keys">
        <tbody>
          {ROWS.map(([k, v]) => (
            <tr key={k}>
              <td>
                {k.split(' / ').map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">⌘ works in place of Ctrl on macOS. Keybinds: src/config/keys.ts.</p>
    </details>
  )
}
