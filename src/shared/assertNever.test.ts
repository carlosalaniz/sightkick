import { describe, expect, it } from 'vitest';
import { assertNever } from './assertNever';

describe('assertNever', () => {
  it('throws with the context and the value that got through', () => {
    expect(() => assertNever('mystery' as never, 'job status')).toThrow(
      'Unhandled job status: "mystery"',
    );
  });
});
