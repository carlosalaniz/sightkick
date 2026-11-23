// Replaced at build time: true in the browser build (vite.web.config.ts),
// false in the Electron renderer and in tests.
declare const __SK_WEB__: boolean;

// Default stem server address baked into the browser build; see
// src/stemServerUrl.ts. Undefined outside vite.web.config.ts.
declare const __SK_STEM_SERVER_URL__: string | undefined;

// Version and commit of this build (scripts/build-info.ts); see src/buildInfo.ts.
// Undefined in tests.
declare const __SK_BUILD__:
  | { version: string; commit: string; dirty: boolean }
  | undefined;
