import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../../hooks/test-support';
import { IpcCheckStemToolsResponse } from '../../../types';
import { StemServerSettings } from './StemServerSettings';

let listeners: ((payload: IpcCheckStemToolsResponse) => void)[];

beforeEach(() => {
  installLocalStorage();
  listeners = [];
  window.electron = {
    ipcRenderer: {
      sendMessage: vi.fn(),
      on: (
        _channel: string,
        listener: (payload: IpcCheckStemToolsResponse) => void,
      ) => {
        listeners.push(listener);

        return () => undefined;
      },
      once: () => () => undefined,
    },
  } as unknown as typeof window.electron;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const answer = (payload: IpcCheckStemToolsResponse) =>
  act(() => {
    for (const listener of listeners) {
      listener(payload);
    }
  });

describe('StemServerSettings', () => {
  it('asks for the stem server status when it opens', () => {
    render(<StemServerSettings />);

    expect(window.electron.ipcRenderer.sendMessage).toHaveBeenCalledWith(
      'check-stem-tools',
    );
  });

  it.each([
    ['ready', 'Connected'],
    ['unreachable', 'Not reachable'],
    ['unhealthy', 'Not ready'],
  ] as const)('shows a %s server as %s', (stemServer, label) => {
    render(<StemServerSettings />);
    answer({
      status: stemServer === 'ready' ? 'ready' : 'unsupported',
      stemServer,
    });

    expect(screen.getByTestId('stem-server-status').textContent).toContain(
      label,
    );
  });
});
