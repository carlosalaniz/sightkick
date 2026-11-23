import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseFlag,
  parseProgress,
  parseWaitGrace,
  PROGRESS_KEY,
} from './persisted';

describe('lesson persisted settings', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('keeps well-formed progress as it is', () => {
    const saved = {
      'song-1': { stars: { b0: 2 }, seen: { b0: true }, lesson: 'b4' },
      'song-2': { stars: {}, seen: {} },
    };

    expect(parseProgress(saved)).toEqual(saved);
    expect(warn).not.toHaveBeenCalled();
  });

  it('repairs a song with missing or broken fields instead of dropping it', () => {
    expect(
      parseProgress({
        'song-1': { seen: { b0: true }, lesson: 'b4' },
        'song-2': { stars: { b0: 9, b4: 1, b8: 'x' }, seen: 3, lesson: 5 },
      }),
    ).toEqual({
      'song-1': { stars: {}, seen: { b0: true }, lesson: 'b4' },
      'song-2': { stars: { b4: 1 }, seen: {} },
    });
    expect(warn).toHaveBeenCalledWith(
      'lesson.progress_repaired',
      expect.objectContaining({ key: PROGRESS_KEY, songId: 'song-2' }),
    );
  });

  it('drops a song entry that is not an object, keeping the others', () => {
    expect(
      parseProgress({ 'song-1': null, 'song-2': { stars: {}, seen: {} } }),
    ).toEqual({ 'song-2': { stars: {}, seen: {} } });
    expect(warn).toHaveBeenCalledWith('lesson.progress_dropped', {
      key: PROGRESS_KEY,
      songId: 'song-1',
    });
  });

  it('rejects progress that is not an object at all', () => {
    expect(parseProgress([])).toBeUndefined();
    expect(parseProgress('x')).toBeUndefined();
    expect(parseProgress(null)).toBeUndefined();
  });

  it('accepts only booleans as flags', () => {
    expect(parseFlag(true)).toBe(true);
    expect(parseFlag(false)).toBe(false);
    expect(parseFlag('true')).toBeUndefined();
    expect(parseFlag(1)).toBeUndefined();
  });

  it('accepts only the wait graces the menu offers', () => {
    expect(parseWaitGrace(30)).toBe(30);
    expect(parseWaitGrace(90)).toBe(90);
    expect(parseWaitGrace(45)).toBeUndefined();
    expect(parseWaitGrace('60')).toBeUndefined();
  });
});
