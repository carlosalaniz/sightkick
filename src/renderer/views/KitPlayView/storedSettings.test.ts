import { describe, expect, it } from 'vitest';
import { parseKitPlayLayout } from './storedSettings';

describe('parseKitPlayLayout', () => {
  it('keeps a known layout', () => {
    expect(parseKitPlayLayout('kit')).toBe('kit');
    expect(parseKitPlayLayout('lanes')).toBe('lanes');
  });

  it('rejects anything else', () => {
    expect(parseKitPlayLayout('rails')).toBeUndefined();
    expect(parseKitPlayLayout(null)).toBeUndefined();
    expect(parseKitPlayLayout(3)).toBeUndefined();
  });
});
