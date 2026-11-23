import type { Channels, ElectronHandler } from '../preload/index';
import * as handlers from './handlers';
import { SplitParts } from '../songData';
import {
  cancelSplit,
  checkStemServer,
  resumeSplits,
  splitSong,
} from './stem-server';

// Browser stand-in for the Electron preload bridge: the renderer keeps calling
// window.electron.ipcRenderer, and messages are handled in-page instead of by
// the main process.

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();
// Replies are always async, like real IPC: some callers send a message and
// only then subscribe to its reply.
const reply: handlers.Reply = (channel, payload) => {
  setTimeout(() => {
    for (const listener of [...(listeners.get(channel) ?? [])]) {
      listener(payload);
    }
  }, 0);
};

function subscribe(channel: string, listener: Listener) {
  let set = listeners.get(channel);

  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }

  set.add(listener);

  return () => {
    set.delete(listener);
  };
}

const run = (task: Promise<unknown> | void) => {
  task?.catch((error: unknown) => console.error(error));
};

function sendMessage(channel: Channels, ...args: unknown[]) {
  switch (channel) {
    case 'check-dev':
      reply(channel, false);

      break;

    case 'load-song-list':
      run(handlers.loadSongList(reply));

      break;

    case 'rescan-songs':
      run(
        handlers.rescanSongs(reply, args[0] as boolean | 'browser' | undefined),
      );

      break;

    case 'load-song':
      run(handlers.loadSong(reply, args[0] as string));

      break;

    case 'update-song':
      run(
        handlers.updateSong(
          reply,
          args[0] as Parameters<typeof handlers.updateSong>[1],
        ),
      );

      break;

    case 'like-song':
      run(handlers.likeSong(args[0] as string, args[1] as boolean));

      break;

    case 'download-song':
      run(
        handlers.downloadSong(
          reply,
          args[0] as Parameters<typeof handlers.downloadSong>[1],
        ),
      );

      break;

    case 'midi-device-list':
      run(handlers.midiDeviceList(reply));

      break;

    case 'listen-midi':
      run(handlers.startMidi(reply, args[0] as number));

      break;

    case 'stop-listen-midi':
      handlers.stopListenMidi();

      break;

    case 'prevent-sleep':
      handlers.preventSleep();

      break;

    case 'resume-sleep':
      handlers.resumeSleep();

      break;

    case 'export-pdf':
      handlers.exportPdf(reply, args[0] as { html: string });

      break;

    case 'check-stem-tools':
      // Splitting needs the optional stem server (stem-server/); without it
      // the split option stays hidden.
      run(
        checkStemServer().then((ok) =>
          reply(channel, { status: ok ? 'ready' : 'unsupported' }),
        ),
      );

      break;

    case 'split-song':
      run(splitSong(reply, args[0] as string, args[1] as SplitParts));

      break;

    case 'resume-splits':
      run(resumeSplits(reply));

      break;

    case 'cancel-split':
      cancelSplit(args[0] as string);

      break;

    default:
      // Desktop-only: app updates, stem tool downloads and opening folders
      // in the OS file manager.
      break;
  }
}

export const webHandler: ElectronHandler = {
  ipcRenderer: {
    sendMessage,
    on<T>(channel: Channels, func: (args: T) => void) {
      return subscribe(channel, func as Listener);
    },
    once<T>(channel: Channels, func: (args: T) => void) {
      const off = subscribe(channel, (payload) => {
        off();
        func(payload as T);
      });

      return off;
    },
  },
};

export function installWebBridge(): void {
  window.electron = webHandler;
}
