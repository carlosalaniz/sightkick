# SightKick stem server

A small local server that splits a song into stems (drums, bass, vocals, guitar, keys, song) so SightKick can mute the drums on charts that ship as a single mixed audio file. It runs models through [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator), with two presets you pick in the app (⚙ → **Split quality**):

| Preset | Model | Stems | 5½-min song, CPU in Docker* |
|---|---|---|---|
| **Fast** (default) | HTDemucs (Demucs v4), the same model the desktop app uses | drums, bass, vocals, song | ~1.5 min |
| **Best** | BS-RoFormer-SW (by jarredou) | drums, bass, vocals, guitar, keys, song | ~9 min |

\*Measured on an Apple Silicon Mac, Docker with 14 CPUs. Best gives cleaner drums (less cymbal and vocal bleed) at about 5× the time.

## Run it

```bash
cd stem-server
docker compose up --build
```

The first start downloads the Fast model (~80 MB); the Best model (~700 MB) downloads the first time you split with it. Both are kept in a Docker volume, so later starts are fast. The server listens on `http://localhost:8765`. The SightKick web app looks for it there by default; you can change the address under ⚙ → **Stem server**.

Then, in SightKick, open the **⋮** menu on a song that has a single audio file and choose **Split stems**. The original audio is replaced by one Ogg file per stem (`drums.ogg`, `bass.ogg`, `vocals.ogg`, `song.ogg`, and with Best also `guitar.ogg` and `keys.ogg`), which also show up as separate sliders in the mixer. Stems that come out silent are left out.

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

## Configuration

| Variable | Default | |
|---|---|---|
| `SK_FAST_MODEL` | `htdemucs.yaml` | Model for the Fast preset |
| `SK_BEST_MODEL` | `BS-Roformer-SW.ckpt` | Model for the Best preset. Either can be any model [audio-separator supports](https://github.com/nomadkaraoke/python-audio-separator#supported-models) |
| `SK_DEFAULT_QUALITY` | `fast` | Preset used when a request doesn't name one; it's also loaded at startup |
| `SK_MODEL_DIR` | `/models` | Where models are downloaded |
| `SK_MAX_UPLOAD_MB` | `200` | Upload size limit |
| `SK_OGG_QUALITY` | `6` | Vorbis quality (0–10) of the returned stems |
| `SK_JOB_TTL_SECONDS` | `3600` | How long finished jobs are kept |
| `SK_ALLOWED_ORIGINS` | `*` | CORS origins, comma-separated |

Stem names follow Clone Hero: the model's `piano` becomes `keys` and `other` becomes `song`.

## API

| | |
|---|---|
| `GET /health` | `{ ok, defaultQuality, models: { fast, best }, queued }` |
| `POST /jobs` | multipart `files` (one or more audio files, mixed together) and optional `quality` (`fast` or `best`) → job |
| `GET /jobs/{id}` | `{ status, stage, progress, queuePosition, stems, error }` |
| `GET /jobs/{id}/stems/{name}` | the stem as Ogg Vorbis |
| `DELETE /jobs/{id}` | cancel and delete |

Jobs run one at a time. The port is bound to `127.0.0.1` in `docker-compose.yml`, so other machines on your network can't reach it.

## License note

The BS-RoFormer-SW weights (Best) are published under a non-commercial license (CC BY-NC-SA 4.0); HTDemucs (Fast) is MIT. Fine for personal practice; check the terms before using them in anything commercial.
