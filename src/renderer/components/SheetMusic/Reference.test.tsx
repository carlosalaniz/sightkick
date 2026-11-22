import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InputEvent } from '../../input/types';
import { Reference } from './Reference';

const { listeners } = vi.hoisted(() => ({
  listeners: new Set<(event: InputEvent) => void>(),
}));

vi.mock('../../input', () => ({
  inputBus: {
    subscribe: (listener: (event: InputEvent) => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  },
}));

const emit = (controlId: string, value = 100) =>
  listeners.forEach((listener) => listener({ controlId, value }));

describe('Reference pad flash', () => {
  it('lights up every kit piece mapped to the pad that was hit', () => {
    render(
      <Reference
        inputMapping={{
          snare: ['midi:38'],
          tom1: ['midi:38'],
          kick: ['midi:36'],
        }}
      />,
    );

    emit('midi:38');

    expect(screen.getByTestId('reference-snare')).toHaveClass('sk-pad-flash');
    expect(screen.getByTestId('reference-tom1')).toHaveClass('sk-pad-flash');
    expect(screen.getByTestId('reference-kick')).not.toHaveClass(
      'sk-pad-flash',
    );
  });

  it('ignores releases and unmapped controls', () => {
    render(<Reference inputMapping={{ snare: ['midi:38'] }} />);

    emit('midi:38', 0);
    emit('midi:99');

    expect(screen.getByTestId('reference-snare')).not.toHaveClass(
      'sk-pad-flash',
    );
  });

  it('does not listen when no mapping is given', () => {
    listeners.clear();
    render(<Reference />);

    expect(listeners.size).toBe(0);
  });
});
