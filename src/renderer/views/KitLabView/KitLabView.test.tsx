import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App as AntdApp, ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { MidiMessageType } from '../../../types';
import { antdTheme } from '../../antdTheme';
import { InputProvider } from '../../context/InputContext';
import {
  installIpcMock,
  installLocalStorage,
  IpcMock,
} from '../../hooks/test-support';
import { KitProvider } from '../../kit';
import { KitLabView } from './KitLabView';

let ipc: IpcMock;

function renderLab(tab: 'build' | 'learn') {
  return render(
    <ConfigProvider theme={antdTheme}>
      <AntdApp>
        <InputProvider>
          <KitProvider>
            <MemoryRouter initialEntries={[`/kit?tab=${tab}`]}>
              <KitLabView />
            </MemoryRouter>
          </KitProvider>
        </InputProvider>
      </AntdApp>
    </ConfigProvider>,
  );
}

function padRow(name: string): HTMLElement {
  const list = screen.getByRole('region', { name: 'Pads and input' });

  return within(list)
    .getAllByRole('listitem')
    .find((li) => li.textContent?.startsWith(name))!;
}

function press(code: string, key = code) {
  fireEvent.keyDown(document.body, { code, key });
  fireEvent.keyUp(document.body, { code, key });
}

function savedKits() {
  return JSON.parse(localStorage.getItem('settings.kits') ?? '{}').kits as {
    id: string;
    controls: Record<string, string[]>;
  }[];
}

beforeEach(() => {
  installLocalStorage();
  ipc = installIpcMock();
});

describe('Build kit', () => {
  it('adds a piece from the palette and removes it from the inspector', () => {
    renderLab('build');

    const pieces = screen.getByRole('region', { name: 'Pieces' });

    fireEvent.click(within(pieces).getByRole('button', { name: 'Splash' }));

    expect(
      within(pieces).getByRole('button', { name: /^Splash/, current: true }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Piece name')).toHaveValue('Splash');

    fireEvent.click(screen.getByRole('button', { name: /Remove from kit/ }));

    expect(
      within(pieces).queryByRole('button', { name: /^Splash/, current: true }),
    ).toBeNull();
    expect(screen.getByText(/Select a piece on the kit/)).toBeInTheDocument();
  });

  it('nudges the selected piece with the arrow keys and undoes it', async () => {
    renderLab('build');

    const list = screen.getByRole('list', { name: 'Pieces on this kit' });

    fireEvent.click(within(list).getByRole('button', { name: /^Snare/ }));
    expect(screen.getByText('x 36 · y 60')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'ArrowRight', code: 'ArrowRight' });
    expect(screen.getByText('x 39 · y 60')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', metaKey: true });

    // Undo animates for ~420 ms before saving.
    await waitFor(() =>
      expect(screen.getByText('x 36 · y 60')).toBeInTheDocument(),
    );
  });
});

describe('Learn pads', () => {
  it('learns a key for a pad and moves it when another pad takes it', () => {
    renderLab('learn');

    fireEvent.click(
      within(padRow('Snare')).getByRole('button', { name: 'Learn' }),
    );
    expect(screen.getByText(/Hit the/)).toHaveTextContent('Hit the Snare now.');

    press('KeyJ', 'j');
    expect(within(padRow('Snare')).getByText('J')).toBeInTheDocument();

    fireEvent.click(
      within(padRow('Tom 1')).getByRole('button', { name: 'Learn' }),
    );
    press('KeyJ', 'j');

    expect(
      screen.getByText('Key J was on Snare; moved it to Tom 1.'),
    ).toBeInTheDocument();
    expect(within(padRow('Tom 1')).getByText('J')).toBeInTheDocument();
    expect(within(padRow('Snare')).queryByText('J')).toBeNull();

    press('Escape');
    expect(screen.getByText('Click a piece, then hit it.')).toBeInTheDocument();
    expect(savedKits()[0].controls.t1).toEqual(['keyboard:KeyJ']);
  });

  it('learns MIDI notes exclusively while listening', () => {
    renderLab('learn');

    fireEvent.click(
      within(padRow('Kick')).getByRole('button', { name: 'Learn' }),
    );
    act(() => {
      ipc.emit('listen-midi', {
        type: MidiMessageType.NoteOn,
        note: 36,
        velocity: 100,
      });
    });

    expect(within(padRow('Kick')).getByText('36 beater')).toBeInTheDocument();
    expect(screen.getByText('Kick · beater')).toBeInTheDocument();
  });

  it('says which Input settings mapping an unlearned pad falls back to', () => {
    localStorage.setItem(
      'settings.selectedDevice',
      JSON.stringify({
        id: 'keyboard',
        name: 'Keyboard',
        sourceId: 'keyboard',
      }),
    );
    localStorage.setItem(
      'settings.inputMappings',
      JSON.stringify({ keyboard: { snare: ['keyboard:KeyS'] } }),
    );
    renderLab('learn');

    expect(
      within(padRow('Snare')).getByText(
        "Not learned · using Snare's mapping from Input settings",
      ),
    ).toBeInTheDocument();
    expect(within(padRow('Kick')).getByText('not mapped')).toBeInTheDocument();
  });
});
