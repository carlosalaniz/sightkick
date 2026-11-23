import { describe, expect, it } from 'vitest';
import { barNotation, countLabels } from './notation';

const hh = (beat: number) => ({ beat, step: 9, foot: false });
const sn = (beat: number) => ({ beat, step: 5, foot: false });
const kk = (beat: number) => ({ beat, step: 1, foot: true });

describe('barNotation', () => {
  it('beams eighths in a beat and stems from the lowest hand note', () => {
    const [b0] = barNotation([hh(0), sn(0), hh(0.5), kk(0)]);

    expect(b0.beat).toBe(0);
    expect(b0.hands.positions).toEqual([0, 0.5]);
    expect(b0.hands.lowSteps).toEqual([5, 9]);
    expect(b0.hands.beams).toBe(1);
    expect(b0.feet.positions).toEqual([0]);
    expect(b0.feet.beams).toBe(0);
    expect(b0.feet.flag).toBe(false);
  });

  it('double-beams a beat with sixteenths', () => {
    const [b] = barNotation([hh(1), hh(1.25), hh(1.5), hh(1.75)]);

    expect(b.beat).toBe(1);
    expect(b.hands.beams).toBe(2);
  });

  it('flags a lone off-beat note', () => {
    const notation = barNotation([kk(2.5), hh(3)]);

    expect(notation.map((b) => b.beat)).toEqual([2, 3]);
    expect(notation[0].feet.flag).toBe(true);
    expect(notation[0].hands.positions).toEqual([]);
    expect(notation[1].hands.flag).toBe(false);
  });
});

describe('countLabels', () => {
  it('counts 1 & 2 & and adds e / a only where sixteenths are played', () => {
    const labels = countLabels(2, [0, 0.25, 1.75]).map((l) => l.text);

    expect(labels).toEqual(['1', 'e', '&', '2', '&', 'a']);
  });
});
