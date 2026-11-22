# <img width="64" height="64" alt="SightKick Logo Github" src="https://cdn.sightkick.dev/images/sightkick-logo.png" /> SightKick

A free, open source game for learning drums with sheet music for thousands of songs. Mute the drum track, play along on your electronic drum kit, and chase your best score.

<h1 align="center">
  <a href="https://sightkick.dev">Guide</a> |
  <a href="https://sightkick.dev/alternatives.html">Compare</a> |
  <a href="https://github.com/tonygoldcrest/sightkick/releases">Download</a> |
  <a href="https://discord.gg/mqVSKx5N6K">Discord</a>
</h1>

<img width="1478" height="880" alt="image" src="https://cdn.sightkick.dev/images/hero.png" />

## Requirements

* **macOS**, **Windows** (x64), or **Linux** (x64).
* Optional drum-track separation needs the [stem splitter tool](https://github.com/tonygoldcrest/sightkick-tools) (~130 MB, one-time download from within the app; Apple Silicon and Windows only).

## Features

* **Sheet music rendering**: drum charts from Clone Hero and YARG `.mid`/`.chart` files are rendered as standard notation
* **Thousands of songs**: browse and download from the Enchor community library directly inside the app
* **MIDI e-kit support**: connect your electronic drum kit and get hit detection scored against the chart, with a star rating at the end of each song
* **Practice mode**: select a section, loop it, and slow playback down (0.3x to 2x) with scoring off
* **Stem mixer**: mute the recorded drums and hear your own playing; adjust levels per stem
* **Stem splitting**: separate a mixed recording into individual tracks automatically (macOS Apple Silicon and Windows; ~130 MB one-time download)
* **Scrolling playhead**: three modes: Cursor (follows note by note), Measure (highlights the current bar), or None
* **Color-coded notation**: each drum and cymbal maps to a distinct color; filled noteheads for drums, × for cymbals
* **Multiple difficulties**: switch between chart difficulties from the side menu
* **Favorites and search**: local library search plus online search with one-click download

## For developers

SightKick is an Electron + React 19 desktop app. Drum charts are parsed from Clone Hero `.mid`/`.chart` files and rendered as sheet music with VexFlow; the UI uses Tailwind CSS v4 and Ant Design v6.

Requires [Node.js](https://nodejs.org/) and [Yarn](https://yarnpkg.com/) v4 (Berry). This project uses `yarn` exclusively (don't use `npm`).

```bash
yarn install        # install dependencies
yarn start          # run in dev mode (Electron + hot reload)
yarn build          # compile main, preload, and renderer
yarn lint           # ESLint with --fix
yarn test           # Vitest
yarn storybook      # component stories on :6006
yarn package        # build a macOS app (yarn package:win / package:linux)
```

## Web version

SightKick also runs in the browser, with no install. `src/web` stands in for the Electron main process: it answers the same IPC channels with web APIs (File System Access / OPFS for the song library, IndexedDB for song data, Web MIDI for the kit, the Wake Lock API to keep the screen on).

```bash
yarn web            # quickest: installs deps if needed, opens http://localhost:5173
yarn start:web      # dev server
yarn build:web      # static site in out/web (deployable to any static host)
yarn preview:web    # serve the built site locally
```

Differences from the desktop app:

* **Browser support**: Chrome or Edge for the full experience. Firefox works with songs stored in the browser; Safari has no Web MIDI, so it can't connect an e-kit.
* **Song library**: by default, downloaded songs are saved in the browser's private storage. In Chrome and Edge you can instead point it at a folder on your computer, such as an existing Clone Hero library. The browser asks for folder permission again on later visits.
* **Stem splitting**: runs on a small local server instead of inside the app. Start it with `cd stem-server && docker compose up --build` (see [stem-server/README.md](stem-server/README.md)). Then **Split stems** appears in the menu of any song with a single audio file, and the stems replace that audio.
* **Not available**: app auto-updates and "open song folder". PDF export uses the browser's print dialog (choose "Save as PDF").

`.github/workflows/web.yml` builds the web version and deploys it to GitHub Pages.

## Acknowledgements

* [Enchor](https://www.enchor.us/) for the song library
* TheNathannator for the [GH/RB specification](https://github.com/TheNathannator/GuitarGame_ChartFormats)

## License

[MIT](LICENSE) © Anton Korolkov
