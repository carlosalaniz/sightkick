/**
 * Structured logging for the renderer and the browser build. There is no
 * metrics backend in a desktop/browser app, so every success, degraded and
 * broken path that matters leaves one of these instead: a stable event name
 * (`split.poll_failed`) that can be searched for, and the IDs someone needs to
 * find the song or job it is about. Never interpolate the IDs into the event.
 */
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  /** Expected and recoverable: a retry, a fallback, a missing optional file. */
  warn(event: string, fields?: LogFields): void;
  /** Unexpected: a bug, or an outside system doing something we don't handle. */
  error(event: string, fields?: LogFields, err?: unknown): void;
}

export const log: Logger = {
  info: (event, fields = {}) => console.info(event, fields),
  warn: (event, fields = {}) => console.warn(event, fields),
  error: (event, fields = {}, err = undefined) =>
    console.error(event, fields, err),
};
