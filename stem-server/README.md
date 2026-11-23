# SightKick stem server

A small local server that splits a song into stems (drums, bass, vocals, guitar, keys, song) so SightKick can mute the drums on charts that ship as a single mixed audio file. It runs models through [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator), with two presets you pick in the app (⚙ → **Split quality**):

| Preset | Model | Stems | 5½-min song, CPU in Docker* |
|---|---|---|---|
| **Fast** (default) | HTDemucs (Demucs v4), the same model the desktop app uses | drums, bass, vocals, song | ~1.5 min |
| **Best** | BS-RoFormer-SW (by jarredou) | drums, bass, vocals, guitar, keys, song | ~9 min |

\*Measured on an Apple Silicon Mac, Docker with 14 CPUs. Best gives cleaner drums (less cymbal and vocal bleed) at about 5× the time.

### Drum kit

A third model, **MDX23C DrumSep** (by aufr33 and jarredou), splits a drum track further into **kick, snare, toms, hi-hat, ride and crash**. In SightKick choose **⋮ → Split drum kit** on a song: if it already has drum stems only those are split, otherwise the song is split into stems first (with the preset above) and then its drums into the kit. The pieces are saved to the song's `drumkit/` folder. On the **Play on my kit** screen they play instead of the drum track, so a lesson can mute just the pieces you are playing. The model (~440 MB) downloads the first time it's used.

Expect some bleed between pieces, mostly hi-hat into snare and ride into crash. All toms come out as one `toms` stem.

## Run it

```bash
cd stem-server
docker compose up --build
```

The first start downloads the Fast model (~80 MB); the Best model (~700 MB) downloads the first time you split with it. Both are kept in a Docker volume, so later starts are fast. The server listens on `http://localhost:8765`. The SightKick web app looks for it there by default (its Docker image instead goes through its own `/stem-api/` proxy); you can change the address under ⚙ → **Stem server**.

Then, in SightKick, open the **⋮** menu on a song that has a single audio file and choose **Split stems**. The original audio is replaced by one Ogg file per stem (`drums.ogg`, `bass.ogg`, `vocals.ogg`, `song.ogg`, and with Best also `guitar.ogg` and `keys.ogg`), which also show up as separate sliders in the mixer. Stems that come out silent are left out.

When a split has two or more instrument stems besides the drums, the server also returns `backing`: those stems mixed into one file. The browser app saves it as `drumkit/backing.ogg`, where Clone Hero won't play it on top of the stems. On devices with 4 GB of RAM or less it plays that one file instead of the separate instrument stems, since every stem the browser decodes costs about 45–90 MB for a 4-minute song.

### Speed

Separation runs on the CPU inside Docker, which on macOS can't use the Apple GPU. For speed on a Mac, run the server natively instead, which uses Metal (MPS):

```bash
cd stem-server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
SK_MODEL_DIR=~/.cache/sightkick-models uvicorn app:app --port 8765
```

On Linux with an NVIDIA GPU, build with CUDA PyTorch and give the container the GPU:

```bash
docker compose build --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu124
docker compose run --gpus all -p 127.0.0.1:8765:8765 stem-server
```

## Cache

Every finished split is saved on disk and never expires. The key is a SHA-256 of the uploaded audio plus the mode, the model(s) and the Ogg quality, so:

* Sending the same audio again, from any client, returns the stems immediately (`"cached": true` on the job) without running a model.
* Sending audio that's already queued or being split joins that job instead of starting a second one. A client cancelling only stops the job if no other client is still following it.
* Changing a model or `SK_OGG_QUALITY` starts a fresh set of entries; the old ones stay on disk until you delete them.
* Entries stored before splits came with a `backing` mix get one the next time they're requested, mixed from the cached stems in a few seconds, without splitting again.

Entries live in `SK_CACHE_DIR` as `<first 2 hex chars>/<key>/` with one `.ogg` per stem and a `manifest.json`. The cache only grows; to reclaim space, delete entry folders (or the whole directory) while the server is stopped. In Docker it's the `sightkick-stem-cache` volume; on Harbor it's the app's *split cache* storage.

Bump `CACHE_VERSION` in `app.py` when a code change alters what a model produces (decoding, model parameters, stem naming), so stale entries stop matching.

## Configuration

| Variable | Default | |
|---|---|---|
| `SK_FAST_MODEL` | `htdemucs.yaml` | Model for the Fast preset |
| `SK_BEST_MODEL` | `BS-Roformer-SW.ckpt` | Model for the Best preset. Either can be any model [audio-separator supports](https://github.com/nomadkaraoke/python-audio-separator#supported-models) |
| `SK_KIT_MODEL` | `MDX23C-DrumSep-aufr33-jarredou.ckpt` | Model that splits drums into kit pieces |
| `SK_DEFAULT_QUALITY` | `fast` | Preset used when a request doesn't name one; it's also loaded at startup |
| `SK_MODEL_DIR` | `/models` | Where models are downloaded |
| `SK_MAX_UPLOAD_MB` | `200` | Upload size limit |
| `SK_OGG_QUALITY` | `6` | Vorbis quality (0–10) of the returned stems |
| `SK_JOB_TTL_SECONDS` | `3600` | How long a finished job stays reachable by id (its stems stay in the cache) |
| `SK_CACHE_DIR` | `/cache` in Docker, else `~/.cache/sightkick-stem-cache` | Where finished splits are cached |
| `SK_CACHE` | `1` | Set to `0` to turn the cache off |
| `SK_ALLOWED_ORIGINS` | `*` | CORS origins, comma-separated |

Stem names follow Clone Hero: the model's `piano` becomes `keys` and `other` becomes `song`.

## API

| | |
|---|---|
| `GET /health` | `{ ok, defaultQuality, models: { fast, best, kit }, modes, queued, cache }` |
| `POST /jobs` | multipart `files` (one or more audio files, mixed together), optional `quality` (`fast` or `best`) and optional `mode`: `stems` (default), `kit` (the upload is a drum track; returns `kit_kick`, `kit_snare`, `kit_toms`, `kit_hihat`, `kit_ride`, `kit_crash`) or `stems+kit` (both) → job |
| `GET /jobs/{id}` | `{ status, stage, progress, queuePosition, stems, error, cached }` |
| `GET /jobs/{id}/stems/{name}` | the stem as Ogg Vorbis |
| `DELETE /jobs/{id}` | cancel and delete (cached stems are kept) |

Jobs run one at a time. A `POST /jobs` that hits the cache comes back with `status: "done"` straight away. The port is bound to `127.0.0.1` in `docker-compose.yml`, so other machines on your network can't reach it.

## Tests

The job queue, cache and error outcomes have tests that fake the separation library at its import path (so the server's own model code still runs) and use the real ffmpeg:

```bash
cd stem-server
pip install fastapi python-multipart httpx numpy soundfile pytest
python -m pytest test_app.py
```

## License note

The BS-RoFormer-SW weights (Best) are published under a non-commercial license (CC BY-NC-SA 4.0); HTDemucs (Fast) is MIT. Check the DrumSep (drum kit) weights' terms with their authors before any commercial use. Fine for personal practice; check the terms before using them in anything commercial.
