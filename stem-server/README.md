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
| `SK_MAX_UPLOAD_MB` | `200` | Limit on the audio in one request, all files together. A request whose `Content-Length` is over it (plus 1 MB for the form around the files) is refused before it's read |
| `SK_MAX_FILES` | `16` | Most audio files one request may send |
| `SK_MAX_QUEUED` | `20` | New jobs that may wait to run; past it `POST /jobs` answers 429. Cache hits and requests joining a queued job still go through |
| `SK_OGG_QUALITY` | `6` | Vorbis quality (0–10) of the returned stems |
| `SK_JOB_TTL_SECONDS` | `3600` | How long a finished job stays reachable by id (its stems stay in the cache) |
| `SK_JOB_TIMEOUT_SECONDS` | `3600` | Longest a split may run, including a first-use model download; then it ends with `timed_out` |
| `SK_FFMPEG_TIMEOUT_SECONDS` | `600` | Longest one ffmpeg decode, encode or mix may run before it's killed |
| `SK_CACHE_DIR` | `/cache` in Docker, else `~/.cache/sightkick-stem-cache` | Where finished splits are cached |
| `SK_CACHE` | `1` | Set to `0` to turn the cache off |
| `SK_BACKING` | `1` | Set to `0` to stop making the `backing` mix, for new splits and old cache entries; entries that already have one still return it |
| `SK_ALLOWED_ORIGINS` | `*` | CORS origins, comma-separated |

Stem names follow Clone Hero: the model's `piano` becomes `keys` and `other` becomes `song`.

## API

| | |
|---|---|
| `GET /health` | `{ ok, apiVersion, defaultQuality, models: { fast, best, kit }, modes, queued, cache }` |
| `POST /jobs` | multipart `files` (one or more audio files, mixed together), optional `quality` (`fast` or `best`) and optional `mode`: `stems` (default), `kit` (the upload is a drum track; returns `kit_kick`, `kit_snare`, `kit_toms`, `kit_hihat`, `kit_ride`, `kit_crash`) or `stems+kit` (both) → job |
| `GET /jobs/{id}` | `{ status, stage, progress, queuePosition, stems, error, errorCode, cached }` |
| `GET /jobs/{id}/stems/{name}` | the stem as Ogg Vorbis |
| `DELETE /jobs/{id}` | cancel and delete (cached stems are kept) |

Jobs run one at a time. A split that runs past its deadline stops at the model's next chunk. A model stuck where it never reaches a chunk (a hung download, say) can't be interrupted inside the process: a minute after the deadline its job is marked `timed_out` so clients stop waiting, but later jobs wait until the model returns or the server restarts. A `POST /jobs` that hits the cache comes back with `status: "done"` straight away. The port is bound to `127.0.0.1` in `docker-compose.yml`, so other machines on your network can't reach it.

### Errors

`apiVersion` in `/health` is the version of this contract (currently `1`). It changes only for a change an existing client can't read; new fields can appear without it.

A job's `status` is `queued`, `running`, `done`, `error` or `cancelled`. When it's `error`, `errorCode` says why; otherwise it's `null`:

| `errorCode` | Meaning |
|---|---|
| `decode_failed` | ffmpeg couldn't decode the uploaded audio |
| `no_drums` | A `stems+kit` split found no drums to split into a kit |
| `model_unavailable` | The model for this preset failed to load (or download) |
| `timed_out` | The split ran past `SK_JOB_TIMEOUT_SECONDS`, or an ffmpeg step past `SK_FFMPEG_TIMEOUT_SECONDS`, and was stopped |
| `internal` | Anything else; the server log has the details |

`error` is a short message for people, written by the server. It never contains ffmpeg's or the model library's own text, which goes to the server log with the job id. Clients should branch on `errorCode`, not on `error`, and treat a code they don't know as `internal`.

Every HTTP error response is `{ "detail": "<message>", "code": "<code>" }`:

| Status | `code` | When |
|---|---|---|
| 400 | `bad_request` | Unknown `quality` or `mode`, no files, more than `SK_MAX_FILES` files, or a malformed form |
| 404 | `not_found` | Unknown or expired job, or a stem the job doesn't have |
| 413 | `too_large` | The upload is over `SK_MAX_UPLOAD_MB` |
| 429 | `busy` | `SK_MAX_QUEUED` jobs are already waiting; try again later |
| 503 | `model_unavailable` | The model a request needs has failed to load |

## Logs

Besides the usual log lines (and tracebacks for failures, with the job id), the server writes one JSON object per line for:

* `job_finished`: every job that ends `done`, `error` or `cancelled`, including cache hits, with `job_id`, `cache_key`, `mode`, `quality`, `outcome`, `error_code`, `cached`, `stems` and `duration_s` (from the request, so it includes time in the queue).
* `job_cancel`: a `DELETE /jobs/{id}`, with its `effect`: `released` (other clients still follow the job), `stopping` (a running job will stop at the next model chunk) or `dropped`.
* `request_rejected`: a `POST` refused with a 4xx or 5xx, with its `status`, `code` and `detail`.

## Tests

The job queue, cache and error outcomes have tests that fake the separation library at its import path (so the server's own model code still runs) and use the real ffmpeg:

```bash
cd stem-server
pip install -r requirements-test.txt
python -m pytest test_app.py
ruff check --isolated --target-version py312 --line-length 120 --select E,F,W,B,I,UP --ignore B008 app.py test_app.py
```

CI runs both on every push and pull request that touches `stem-server/` (`.github/workflows/stem-server.yml`). Ruff's B008 is off because FastAPI declares form fields as `File(...)` / `Form(...)` defaults.

## License note

The BS-RoFormer-SW weights (Best) are published under a non-commercial license (CC BY-NC-SA 4.0); HTDemucs (Fast) is MIT. Check the DrumSep (drum kit) weights' terms with their authors before any commercial use. Fine for personal practice; check the terms before using them in anything commercial.
