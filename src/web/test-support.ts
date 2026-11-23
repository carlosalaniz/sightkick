// Test doubles for the browser build: an in-memory folder tree that behaves
// like the File System Access API where src/web relies on it, and a fetch
// that answers by route.

const notFound = (name: string) => new DOMException(name, 'NotFoundError');

/** An in-memory FileSystemDirectoryHandle. */
export class FakeDir {
  readonly kind = 'directory';

  files = new Map<string, Blob>();

  dirs = new Map<string, FakeDir>();

  /** File names whose next write fails, as a full disk would. */
  failWrites = new Set<string>();

  /** Writes aborted, by file name. */
  aborted: string[] = [];

  constructor(public name = '') {}

  /** Creates the folders on the way and puts a file at `path`. */
  put(path: string, content: string): this {
    const [head, ...rest] = path.split('/');

    if (rest.length === 0) {
      this.files.set(head, new Blob([content]));

      return this;
    }

    let next = this.dirs.get(head);

    if (!next) {
      next = new FakeDir(head);
      this.dirs.set(head, next);
    }

    next.put(rest.join('/'), content);

    return this;
  }

  /** The folder at `path`, which must exist. */
  at(path: string): FakeDir {
    return path
      .split('/')
      .filter(Boolean)
      .reduce<FakeDir>((dir, part) => {
        const next = dir.dirs.get(part);

        if (!next) {
          throw new Error(`No folder ${path}`);
        }

        return next;
      }, this);
  }

  async text(name: string): Promise<string | undefined> {
    return this.files.get(name)?.text();
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let dir = this.dirs.get(name);

    if (!dir) {
      if (!opts?.create) {
        throw notFound(name);
      }

      dir = new FakeDir(name);
      this.dirs.set(name, dir);
    }

    return dir;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name) && !opts?.create) {
      throw notFound(name);
    }

    return this.fileHandle(name);
  }

  private fileHandle(name: string) {
    return {
      kind: 'file' as const,
      name,
      getFile: async () => {
        const blob = this.files.get(name);

        if (!blob) {
          throw notFound(name);
        }

        return new File([await blob.text()], name);
      },
      // Like the real API: writes go to a scratch copy that replaces the
      // file on close(), and abort() throws the copy away.
      createWritable: async () => {
        let pending: Blob | undefined;

        return {
          write: async (data: Blob | string) => {
            if (this.failWrites.delete(name)) {
              throw new DOMException('disk full', 'QuotaExceededError');
            }

            pending = typeof data === 'string' ? new Blob([data]) : data;
          },
          close: async () => {
            this.files.set(name, pending ?? new Blob([]));
          },
          abort: async () => {
            this.aborted.push(name);
          },
        };
      },
    };
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name) && !this.dirs.delete(name)) {
      throw notFound(name);
    }
  }

  async *values() {
    for (const name of [...this.files.keys()]) {
      yield this.fileHandle(name);
    }

    for (const dir of [...this.dirs.values()]) {
      yield dir;
    }
  }

  /** This folder as the handle type src/web expects. */
  get handle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle;
  }
}

export type Route = (
  url: string,
  init: RequestInit,
) => Response | 'network-error' | undefined;

/**
 * A fetch that answers from `routes`, first match wins; 'network-error'
 * rejects like a dropped connection, and an unmatched request gets a 404.
 * `calls` records every request.
 */
export function routedFetch(...routes: Route[]) {
  const calls: { url: string; method: string }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    calls.push({ url, method });

    for (const route of routes) {
      const answer = route(url, init ?? {});

      if (answer === 'network-error') {
        throw new TypeError('Failed to fetch');
      }

      if (answer) {
        return answer;
      }
    }

    return new Response(JSON.stringify({ detail: 'Not Found' }), {
      status: 404,
    });
  };

  return { fetch, calls };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
