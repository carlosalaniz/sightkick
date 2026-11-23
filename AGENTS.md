# AGENTS.md

SightKick turns Clone Hero drum charts into sheet music and lets you play them on a drum kit (MIDI or keyboard). It ships as an Electron app and as a browser-only build, with an optional stem server that splits songs into instrument stems.

Follow the coding rules in https://github.com/carlosalaniz/coding-standards/blob/main/coding-rules.md. Where this file differs, this file wins.

## Commands

| What | Command |
|---|---|
| Install | `yarn install` (also turns on `.githooks`) |
| Browser build, dev | `yarn web` (or `yarn start:web`) |
| Desktop app, dev | `yarn start` |
| Lint | `yarn lint` |
| Typecheck | `yarn tsc --noEmit` |
| Tests | `yarn test` |
| Stem server tests | `cd stem-server && pip install fastapi python-multipart httpx numpy soundfile pytest && python -m pytest test_app.py` (needs ffmpeg; the models are stubbed) |

**Done** means `yarn lint && yarn tsc --noEmit && yarn test` passes, plus the stem server tests when `stem-server/` changed. CI runs the TypeScript checks.

## Where things live

| Path | What |
|---|---|
| `src/chart-parser/` | `.chart` / `.mid` parsing and timing (ticks ↔ seconds) |
| `src/renderer/services/engine/` | Playback engine: `Transport` (play, loop, wait-mode hold), `Judge` (scores pad hits), `Engine` (wires them) |
| `src/renderer/services/audio-player/` | Web Audio players. `speed/` time-stretches for slowed-down practice |
| `src/renderer/input/` | Input bus over MIDI and keyboard sources |
| `src/renderer/kit/` | The user's drum kit model, layout and input mapping |
| `src/renderer/views/KitPlayView/` | Play-on-my-kit views. `views/lesson/` is the guided lesson, including wait mode |
| `src/web/` | Browser build: stands in for the Electron main process (`bridge.ts` emulates its IPC) |
| `src/web/stem-server.ts` | Client for the stem server |
| `stem-server/` | Python stem-splitting HTTP server and its disk cache |
| `src/main/`, `src/preload/` | Electron main process and preload |
| `src/shared/` | `assertNever`, `withTimeout`, `log`: use these, don't reinvent them |

## Never / Ask first / Always

**Never**
- Swallow an error with `.catch(() => {})`. Handle the expected failure as a value, or `log.warn` / `log.error` it with the song or job ID.
- Let a server's, browser API's or library's error text or wire shape leave its adapter. Map it to our own named outcome.
- Cast stored JSON (`localStorage`, IndexedDB) or a server response with `as`. Parse and validate it, with a safe default.
- Add a catch-all `default` to a `switch` over our own union. List every case; `default: assertNever(...)`.

**Ask first**
- Changing the stem server's HTTP API or its cache layout (deployed servers and cached stems outlive the app).
- Renaming or reshaping a persisted settings key (it drops users' saved kits and progress unless migrated).
- Changing grading or star thresholds.

**Always**
- Put a timeout on every network call (`AbortSignal.timeout`) and every promise that can hang (`withTimeout`).
- Name business limits (hit windows, star thresholds, grace periods) as constants next to the code that owns them.
- Test each named outcome, faking at the lowest boundary (`fetch`, the `AudioContext`, the file handle), not our own adapter.
- Update or delete a comment in the same change as the code it describes.
