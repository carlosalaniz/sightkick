import { MidiDevice, MidiMessage } from '../types';

// Web MIDI replacement for main/ipc/midi.ts. Device "ports" are indexes into
// the input list, matching what the renderer already stores.

let accessPromise: Promise<MIDIAccess> | undefined;
let activeInput: MIDIInput | null = null;

function getAccess(): Promise<MIDIAccess> {
  if (!navigator.requestMIDIAccess) {
    return Promise.reject(
      new Error(
        'This browser does not support Web MIDI. Use Chrome, Edge or Firefox.',
      ),
    );
  }

  accessPromise ??= navigator.requestMIDIAccess({ sysex: false });
  accessPromise.catch(() => {
    accessPromise = undefined;
  });

  return accessPromise;
}

const inputsOf = (access: MIDIAccess) => [...access.inputs.values()];

// The renderer lists devices on startup. Only ask for MIDI permission once the
// user has interacted (e.g. opened input settings), so the first visit doesn't
// open with a permission prompt.
async function mayRequestAccess(): Promise<boolean> {
  if (navigator.userActivation?.isActive) {
    return true;
  }

  try {
    const status = await navigator.permissions.query({
      name: 'midi' as PermissionName,
    });

    return status.state === 'granted';
  } catch {
    return false;
  }
}

export async function listMidiDevices(): Promise<MidiDevice[]> {
  if (!accessPromise && !(await mayRequestAccess())) {
    return [];
  }

  try {
    return inputsOf(await getAccess()).map((input, port) => ({
      port,
      name: input.name ?? `MIDI input ${port + 1}`,
    }));
  } catch (error) {
    console.error('Failed to enumerate MIDI devices:', error);

    return [];
  }
}

export function stopListenMidi(): void {
  if (activeInput) {
    activeInput.onmidimessage = null;
    activeInput.close().catch(() => undefined);
    activeInput = null;
  }
}

export async function listenMidi(
  port: number,
  onMessage: (message: MidiMessage) => void,
): Promise<void> {
  stopListenMidi();

  const input = inputsOf(await getAccess())[port];

  if (!input) {
    throw new Error(`MIDI device ${port} is not connected`);
  }

  input.onmidimessage = (event) => {
    const data = event.data;

    if (!data || data.length < 3) {
      return;
    }

    onMessage({
      type: data[0] & 0xf0,
      note: data[1],
      velocity: data[2],
      channel: data[0] & 0x0f,
    });
  };
  activeInput = input;
  await input.open();
}
