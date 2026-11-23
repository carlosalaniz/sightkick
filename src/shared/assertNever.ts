/**
 * The default case of a switch over a union we own. A variant nobody handles
 * is a compile error at every switch; a value from outside (stored data, a
 * message) that slips past the types throws here instead of taking a silent
 * branch.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}
