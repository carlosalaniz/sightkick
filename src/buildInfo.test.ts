import { describe, expect, it } from 'vitest';
import { buildLabel } from './buildInfo';

describe('buildLabel', () => {
  it('shows the version and the short commit', () => {
    expect(
      buildLabel({
        version: '0.1.0',
        commit: '8376bdd9d3f9aa00ffee',
        dirty: false,
      }),
    ).toBe('v0.1.0 · 8376bdd');
  });

  it('says when the commit is unknown or the tree had changes', () => {
    expect(
      buildLabel({ version: '0.1.0', commit: 'unknown', dirty: false }),
    ).toBe('v0.1.0 · commit unknown');
    expect(
      buildLabel({ version: '0.1.0', commit: 'abcdef12', dirty: true }),
    ).toBe('v0.1.0 · abcdef1 · modified');
  });
});
