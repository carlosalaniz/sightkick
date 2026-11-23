import { describe, expect, it } from 'vitest';
import { splitInputs } from './songData';

const a = (...names: string[]) => names.map((name) => ({ name }));

describe('splitInputs', () => {
  it('splits a single mixed track', () => {
    expect(splitInputs(a('song'))).toEqual(a('song'));
  });

  it('leaves crowd noise out of the split', () => {
    expect(splitInputs(a('song', 'crowd'))).toEqual(a('song'));
  });

  it('mixes every non-drum stem when there is no drum stem', () => {
    expect(splitInputs(a('song', 'guitar', 'vocals'))).toEqual(
      a('song', 'guitar', 'vocals'),
    );
  });

  it('returns nothing for songs that already have drums', () => {
    expect(splitInputs(a('song', 'drums'))).toEqual([]);
    expect(splitInputs(a('song', 'drums_1', 'drums_2'))).toEqual([]);
  });

  it('returns nothing when only crowd audio is left', () => {
    expect(splitInputs(a('crowd'))).toEqual([]);
  });
});
