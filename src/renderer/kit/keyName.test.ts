import { describe, expect, it } from 'vitest';
import { keyName } from './keyName';

describe('keyName', () => {
  it('shortens key codes', () => {
    expect(keyName('KeyJ')).toBe('J');
    expect(keyName('Digit4')).toBe('4');
    expect(keyName('Space')).toBe('Space');
    expect(keyName('Semicolon')).toBe(';');
    expect(keyName('ShiftLeft')).toBe('Shift');
    expect(keyName('Backspace')).toBe('⌫');
  });

  it('tells numpad keys from the number row', () => {
    expect(keyName('Numpad4')).toBe('Num 4');
  });

  it('shows unknown codes as they are', () => {
    expect(keyName('F5')).toBe('F5');
  });
});
