// Shared by the browser build's library (src/web/library.ts) and the settings UI.

/**
 * What the browser build shows in place of a folder path when songs live in
 * the browser's own storage (the origin-private file system). The settings UI
 * compares against it to offer "switch back to browser storage".
 */
export const BROWSER_ROOT_NAME = 'Browser storage';
