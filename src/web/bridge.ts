import type { Channels, ElectronHandler } from '../preload/index';
import * as handlers from './handlers';
import { SplitParts } from '../songData';
import {
  cancelSplit,
  checkStemServer,
  resumeSplits,
  splitSong,
} from './stem-server';
import { assertNever } from '../shared/assertNever';
import { log } from '../shared/log';
import { IpcCheckStemToolsResponse, RescanMode } from '../types';

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

/**
 * The renderer sends 'rescan-songs' with no argument or true (pick a folder),
 * false (rescan the current one) or 'browser' (back to browser storage), as
 * the desktop app's handler expects. Anything else is a bug in a sender:
 * rescanning the current library is the one mode that neither opens a
 * picker nor switches libraries.
 */
export function parseRescanMode(arg: unknown): RescanMode {
  if (arg === undefined || arg === true) {
    return 'pick';
  }

  if (arg === false) {
    return 'current';
  }

  if (arg === 'browser') {
    return 'browser';
  }

  log.warn('bridge.rescan_mode_unknown', { arg: String(arg) });

  return 'current';
}

/**
 * Runs a handler without waiting for it. Handlers reply with their own
 * failures; anything that still escapes is a bug, logged with its channel.
 */
const run = (channel: Channels, task: Promise<unknown>) => {
  task.catch((error: unknown) => {
    log.error('ipc.handler_threw', { channel }, error);
  });
};
/**
 * Channels only the desktop app handles: app updates, stem tool downloads and
 * opening folders in the OS file manager. The web build ignores them; any
 * other channel must be handled below, or the switch doesn't compile.
 */
const DESKTOP_ONLY_CHANNELS = [
  'check-stem-tools-update',
  'download-stem-tools',
  'cancel-stem-tools',
  'delete-stem-tools',
  'open-song-directory',
  'midi-error',
  'check-update',
  'update-status',
  'download-update',
  'install-update',
] as const satisfies readonly Channels[];

type DesktopOnlyChannel = (typeof DESKTOP_ONLY_CHANNELS)[number];

const isDesktopOnly = (channel: Channels): channel is DesktopOnlyChannel =>
  (DESKTOP_ONLY_CHANNELS as readonly Channels[]).includes(channel);

function sendMessage(channel: Channels, ...args: unknown[]) {
  if (isDesktopOnly(channel)) {
    return;
  }

  switch (channel) {
    case 'check-dev':
      reply(channel, false);

      break;

    case 'load-song-list':
      run(channel, handlers.loadSongList(reply));

      break;

    case 'rescan-songs':
      run(channel, handlers.rescanSongs(reply, parseRescanMode(args[0])));

      break;

    case 'load-song':
      run(channel, handlers.loadSong(reply, args[0] as string));

      break;

    case 'update-song':
      run(
        channel,
        handlers.updateSong(
          reply,
          args[0] as Parameters<typeof handlers.updateSong>[1],
        ),
      );

      break;

    case 'like-song':
      run(channel, handlers.likeSong(args[0] as string, args[1] as boolean));

      break;

    case 'download-song':
      run(
        channel,
        handlers.downloadSong(
          reply,
          args[0] as Parameters<typeof handlers.downloadSong>[1],
        ),
      );

      break;

    case 'midi-device-list':
      run(channel, handlers.midiDeviceList(reply));

      break;

    case 'listen-midi':
      run(channel, handlers.startMidi(reply, args[0] as number));

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
        channel,
        checkStemServer().then((stemServer) =>
          reply(channel, {
            status: stemServer === 'ready' ? 'ready' : 'unsupported',
            stemServer,
          } satisfies IpcCheckStemToolsResponse),
        ),
      );

      break;

    case 'split-song':
      run(channel, splitSong(reply, args[0] as string, args[1] as SplitParts));

      break;

    case 'resume-splits':
      run(channel, resumeSplits(reply));

      break;

    case 'cancel-split':
      cancelSplit(args[0] as string);

      break;

    default:
      assertNever(channel, 'IPC channel');
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
