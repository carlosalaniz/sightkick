/** Short names for keys whose `KeyboardEvent.code` isn't readable as is. */
const KEY_NAMES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Space: 'Space',
  Enter: 'Enter',
  Backspace: '⌫',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

/**
 * A readable name for a `KeyboardEvent.code`, for pad badges and the Kit
 * lab: `KeyJ` → `J`, `Digit4` → `4`, `Numpad4` → `Num 4` (so it can't be
 * mistaken for the `4` above the letters), `Semicolon` → `;`. Unknown codes
 * show as they are.
 */
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }

  if (/^Digit\d$/.test(code)) {
    return code.slice(5);
  }

  if (code.startsWith('Numpad')) {
    return `Num ${code.slice(6)}`;
  }

  return KEY_NAMES[code] ?? code;
}
