import { readFileSync } from 'fs';
import path from 'path';
import { runInNewContext } from 'vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { precacheFiles, stampServiceWorker } from './serviceWorkerBuild';

const SOURCE = readFileSync(
  path.resolve(__dirname, 'service-worker.js'),
  'utf8',
);
const BUNDLE = [
  'index.html',
  'sw.js',
  'version.json',
  'assets/index-Bwh5IirL.js',
  'assets/index-Bwh5IirL.js.map',
  'assets/index-CyxYAzgt.css',
  'assets/space-grotesk-latin-DPT1xrvW.woff2',
];

describe('stampServiceWorker', () => {
  it("lists the build's hashed files to cache, and nothing that must stay fresh", () => {
    expect(precacheFiles(BUNDLE)).toEqual([
      './assets/index-Bwh5IirL.js',
      './assets/index-CyxYAzgt.css',
      './assets/space-grotesk-latin-DPT1xrvW.woff2',
    ]);
  });

  it('fills in every placeholder', () => {
    const sw = stampServiceWorker(SOURCE, 'abc-1', BUNDLE);

    expect(sw).not.toMatch(/__SK_/);
    expect(sw).toContain("'sightkick-abc-1'");
    expect(sw).toContain('"./assets/index-Bwh5IirL.js"');
  });
});

// The stamped worker, run against stand-ins for the service worker globals.
type Handler = (event: unknown) => void;

let handlers: Map<string, Handler>;
let cached: Map<string, string>;
let added: string[];
let network: (url: string) => Promise<Response>;

function startWorker() {
  handlers = new Map();
  runInNewContext(stampServiceWorker(SOURCE, 'test', BUNDLE), {
    self: {
      addEventListener: (type: string, handler: Handler) =>
        handlers.set(type, handler),
      registration: { scope: 'https://app.test/' },
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
    },
    caches: {
      open: async () => ({
        addAll: async (urls: string[]) => {
          added.push(...urls);
        },
        put: async () => undefined,
      }),
      keys: async () => [],
      delete: async () => true,
      match: async (request: string | { url: string }) => {
        const key = typeof request === 'string' ? request : request.url;
        const body = cached.get(key);

        return body === undefined ? undefined : new Response(body);
      },
    },
    fetch: (request: { url: string }) => network(request.url),
    Response,
    URL,
    console,
    setTimeout,
    clearTimeout,
    Promise,
  });
}

async function respond(url: string, mode = 'no-cors') {
  let answer: Promise<Response> | undefined;

  handlers.get('fetch')!({
    request: { url, method: 'GET', mode },
    respondWith: (response: Promise<Response>) => {
      answer = response;
    },
  });

  await vi.runAllTimersAsync();

  return answer!;
}

describe('service worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cached = new Map();
    added = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    startWorker();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('caches the page and the build files when it installs', async () => {
    let installing: Promise<unknown> | undefined;

    handlers.get('install')!({
      waitUntil: (work: Promise<unknown>) => {
        installing = work;
      },
    });
    await installing;

    expect(added).toEqual(
      expect.arrayContaining(['./', './assets/index-Bwh5IirL.js']),
    );
  });

  it('serves the network answer when it comes in time', async () => {
    cached.set('https://app.test/assets/a.js', 'old');
    network = async () => new Response('new');

    expect(await (await respond('https://app.test/assets/a.js')).text()).toBe(
      'new',
    );
  });

  it('serves the cached copy when the network takes too long', async () => {
    cached.set('https://app.test/assets/a.js', 'old');
    network = () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(new Response('new')), 60_000);
      });

    const answer = respond('https://app.test/assets/a.js');

    expect(await (await answer).text()).toBe('old');
  });

  it('serves the app page for any navigation offline', async () => {
    cached.set('./', 'app');
    network = async () => {
      throw new TypeError('Failed to fetch');
    };

    expect(
      await (await respond('https://app.test/song/1', 'navigate')).text(),
    ).toBe('app');
  });
});
