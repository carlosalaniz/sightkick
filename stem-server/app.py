"""SightKick stem server.

A small HTTP service that splits a song into stems (drums, bass, vocals, ...)
with a source-separation model, so the browser build can mute the drums on
songs that ship as a single mixed audio file. Two presets:

- fast: HTDemucs (Demucs v4), the model the desktop app's splitter uses
- best: BS-RoFormer-SW, slower but with cleaner drums

and a drum-kit model (MDX23C DrumSep) that splits a drum track further into
kick, snare, toms, hi-hat, ride and crash.

Jobs run one at a time on a single worker thread; each model is loaded the
first time it's needed and then kept in memory.

Finished splits are cached on disk forever, keyed by a hash of the uploaded
audio plus the models and settings that produced them. Sending the same audio
again (from any client) returns the cached stems at once, and a request for
audio that's already being split joins that job instead of starting another.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

MODELS = {
    "fast": os.environ.get("SK_FAST_MODEL", "htdemucs.yaml"),
    "best": os.environ.get("SK_BEST_MODEL", "BS-Roformer-SW.ckpt"),
}
QUALITIES = tuple(MODELS)
KIT_MODEL = os.environ.get("SK_KIT_MODEL", "MDX23C-DrumSep-aufr33-jarredou.ckpt")
MODELS["kit"] = KIT_MODEL
# stems: split a mix into instruments. kit: the upload is a drum track; split
# it into kit pieces. stems+kit: both, the second pass on the drums stem.
MODES = ("stems", "kit", "stems+kit")
DEFAULT_QUALITY = os.environ.get("SK_DEFAULT_QUALITY", "fast")
MODEL_DIR = os.environ.get("SK_MODEL_DIR", "/models")
WORK_DIR = Path(os.environ.get("SK_WORK_DIR", Path(tempfile.gettempdir()) / "sightkick-stems"))
MAX_UPLOAD_MB = int(os.environ.get("SK_MAX_UPLOAD_MB", "200"))
JOB_TTL_SECONDS = int(os.environ.get("SK_JOB_TTL_SECONDS", "3600"))
# Longest a job may run, including a first-use model download (Best is about
# 700 MB) and a stems+kit pass on the CPU. Past it the job stops at the model's
# next chunk and ends with errorCode "timed_out".
JOB_TIMEOUT_SECONDS = float(os.environ.get("SK_JOB_TIMEOUT_SECONDS", "3600"))
# Longest one ffmpeg run (decode, encode or mix) may take before it's killed.
FFMPEG_TIMEOUT_SECONDS = float(os.environ.get("SK_FFMPEG_TIMEOUT_SECONDS", "600"))
# A model stuck where it never reaches a chunk (a hung download, a deadlock)
# can't be interrupted: the janitor marks its job timed out this long after the
# deadline, so clients stop waiting. The worker stays busy until it returns.
WATCHDOG_GRACE_SECONDS = 60
# How often the janitor expires old jobs and checks the running job's deadline.
JANITOR_INTERVAL_SECONDS = 60
# Finished splits, kept forever. Set SK_CACHE=0 to turn the cache off.
CACHE_DIR = Path(os.environ.get("SK_CACHE_DIR", Path.home() / ".cache" / "sightkick-stem-cache"))
CACHE_ENABLED = os.environ.get("SK_CACHE", "1") != "0"
# Bump when a change here alters the stems a model produces (decoding, model
# parameters, naming), so old cache entries stop matching.
CACHE_VERSION = 1
OGG_QUALITY = os.environ.get("SK_OGG_QUALITY", "6")
# Stems whose peak stays below this (about -50 dBFS) are treated as empty.
SILENCE_PEAK = 10 ** (-50 / 20)
ALLOWED_ORIGINS = os.environ.get("SK_ALLOWED_ORIGINS", "*").split(",")
# How often the background threads check whether the app is shutting down.
THREAD_POLL_SECONDS = 0.5

# Model stem name -> Clone Hero file name. Anything the model calls "other"
# (or an instrumental remainder) becomes "song", the generic backing track.
STEM_FILE_NAMES = {
    "drums": "drums",
    "bass": "bass",
    "vocals": "vocals",
    "guitar": "guitar",
    "piano": "keys",
    "keys": "keys",
    "other": "song",
    "instrumental": "song",
    "no drums": "song",
}

# Kit model stem -> file name. Kit stems are returned as "kit_<piece>".
KIT_PIECE_NAMES = {
    "kick": "kick",
    "snare": "snare",
    "toms": "toms",
    "hh": "hihat",
    "hihat": "hihat",
    "ride": "ride",
    "crash": "crash",
    "cymbals": "cymbals",
}

# Every instrument stem except the drums, mixed into one file. Small devices
# play it instead of the separate stems, so they decode one file, not five.
BACKING = "backing"

# Version of the HTTP contract below (status JSON, error codes). Bump it only
# for a change an existing client can't read.
API_VERSION = 1

# Why a job ended in "error", for clients to branch on, with the message we
# show people. The raw cause (ffmpeg's stderr, the library's exception) only
# goes to the server log, with the job id.
JOB_ERROR_MESSAGES = {
    "decode_failed": "Couldn't decode the uploaded audio",
    "no_drums": "The model found no drums to split into a kit",
    "model_unavailable": "The separation model couldn't be loaded",
    "timed_out": "The split took too long and was stopped",
    "internal": "The split failed on the server",
}

# HTTP error status -> the "code" sent next to "detail".
HTTP_ERROR_CODES = {
    400: "bad_request",
    404: "not_found",
    413: "too_large",
    429: "busy",
    503: "model_unavailable",
}

log = logging.getLogger("stem-server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


class Cancelled(Exception):
    pass


class JobFailed(Exception):
    """An expected way for a job to fail; `code` is a key of JOB_ERROR_MESSAGES.
    Raise it `from` the underlying error so the log keeps the details."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class FfmpegFailed(RuntimeError):
    pass


class FfmpegTimedOut(FfmpegFailed):
    pass


# Monotonic clock for job deadlines; tests replace it.
clock = time.monotonic


@dataclass
class Job:
    id: str
    dir: Path
    inputs: list[Path]
    quality: str = DEFAULT_QUALITY
    mode: str = "stems"
    status: str = "queued"  # queued | running | done | error | cancelled
    stage: str = "queued"
    progress: float = 0.0
    # Our message and code when status is "error"; see JOB_ERROR_MESSAGES.
    error: str | None = None
    error_code: str | None = None
    stems: dict[str, Path] = field(default_factory=dict)
    cancelled: bool = False
    # clock() time past which the running job stops; set when it starts.
    deadline: float = math.inf
    updated: float = field(default_factory=time.time)
    # Cache key of the inputs, quality and mode; None when caching is off.
    cache_key: str | None = None
    # True when the stems came from the cache rather than this job's own run.
    cached: bool = False
    # Clients following this job. A second request for the same audio joins
    # the job; it's only cancelled or dropped once every client has let go.
    watchers: int = 1
    # Share of the progress bar the running model pass reports into.
    span: tuple[float, float] = (5.0, 90.0)

    def set(self, **changes) -> None:
        for key, value in changes.items():
            setattr(self, key, value)
        self.updated = time.time()

    def to_json(self, position: int | None) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "stage": self.stage,
            "progress": round(self.progress, 1),
            "quality": self.quality,
            "mode": self.mode,
            "model": {
                "stems": MODELS[self.quality],
                "kit": MODELS["kit"],
                "stems+kit": f"{MODELS[self.quality]} + {MODELS['kit']}",
            }[self.mode],
            "queuePosition": position,
            "stems": sorted(self.stems),
            "error": self.error,
            "errorCode": self.error_code,
            "cached": self.cached,
        }


jobs: dict[str, Job] = {}
# Cache key -> id of the queued or running job producing it.
inflight: dict[str, str] = {}
pending: "queue.Queue[str]" = queue.Queue()
lock = threading.Lock()
current_job: Job | None = None
# quality -> {"status": not loaded | loading | ready | error, "error": str}
model_states = {key: {"status": "not loaded", "error": None} for key in MODELS}
separators: dict[str, object] = {}


def check_job(job: Job) -> None:
    """Raises if the job should stop: a client cancelled it or it ran out of time.
    Called between model chunks and between steps."""
    if job.cancelled:
        raise Cancelled()
    if clock() > job.deadline:
        raise JobFailed("timed_out")


def queue_position(job: Job) -> int | None:
    if job.status != "queued":
        return None
    with pending.mutex:
        waiting = list(pending.queue)
    return waiting.index(job.id) + 1 if job.id in waiting else None


class ProgressIter:
    """Stands in for tqdm in the models' chunk loops: reports progress on the
    current job and lets a cancel or the deadline stop the model between chunks."""

    def __init__(self, iterable=None, *args, **kwargs):
        self.iterable = iterable if iterable is not None else []
        try:
            self.total = len(self.iterable)
        except TypeError:
            self.total = kwargs.get("total") or 0

    def __iter__(self):
        job = current_job
        for index, item in enumerate(self.iterable):
            if job:
                check_job(job)
            yield item
            if job and self.total:
                lo, hi = job.span
                job.set(progress=lo + (hi - lo) * (index + 1) / self.total)

    def __len__(self):
        return self.total


def install_progress_hooks() -> None:
    # RoFormer/MDXC does `from tqdm import tqdm`; Demucs does `import tqdm`.
    import types

    from audio_separator.separator.architectures import mdxc_separator
    from audio_separator.separator.uvr_lib_v5.demucs import apply as demucs_apply

    mdxc_separator.tqdm = ProgressIter
    demucs_apply.tqdm = types.SimpleNamespace(tqdm=ProgressIter)


def get_separator(quality: str):
    """Returns the separator for a preset ("fast", "best" or "kit"), loading
    (and on first use downloading) its model if needed. Only called from the
    worker thread."""
    if quality in separators:
        return separators[quality]

    from audio_separator.separator import Separator

    model = MODELS[quality]
    state = model_states[quality]
    state.update(status="loading", error=None)
    log.info("Loading %s model %s (downloaded to %s on first use)...", quality, model, MODEL_DIR)
    try:
        sep = Separator(
            model_file_dir=MODEL_DIR,
            output_dir=str(WORK_DIR),
            output_format="WAV",
            # Keep each stem at its true level so the stems add back up to the
            # original mix (the library otherwise rescales loud stems separately).
            normalization_threshold=1.0,
            # One pass, like the Demucs CLI; audio-separator defaults to 2,
            # which doubles the time for a marginal gain.
            demucs_params={"segment_size": "Default", "shifts": 1, "overlap": 0.25, "segments_enabled": True},
            log_level=logging.WARNING,
        )
        sep.load_model(model)
    except Exception as exc:
        # The library's text stays in the log; /health shows our own.
        log.exception("Couldn't load %s model %s", quality, model)
        state.update(status="error", error=f"{model} failed to load; see the server log")
        raise JobFailed("model_unavailable") from exc
    install_progress_hooks()
    separators[quality] = sep
    state.update(status="ready")
    log.info("%s model ready on %s", model, getattr(sep, "torch_device", "cpu"))
    return sep


def run(cmd: list[str]) -> None:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        raise FfmpegTimedOut(f"{cmd[0]} ran over {FFMPEG_TIMEOUT_SECONDS:.0f}s") from exc
    if result.returncode != 0:
        raise FfmpegFailed(f"{cmd[0]} failed: {result.stderr.strip()[-500:]}")


def stem_file_name(model_stem: str) -> str:
    # Without custom names the library writes "<input>_(<Stem>)_<model>".
    match = re.search(r"\(([^)]+)\)", model_stem)
    key = (match.group(1) if match else model_stem).strip().lower().replace("_", " ")
    return STEM_FILE_NAMES.get(key, key.replace(" ", "_"))


def is_silent(wav: Path) -> bool:
    import numpy as np
    import soundfile as sf

    peak = 0.0
    for block in sf.blocks(str(wav), blocksize=1 << 16, always_2d=True):
        peak = max(peak, float(np.abs(block).max(initial=0.0)))
    return peak < SILENCE_PEAK


def separate(job: Job, key: str, wav: Path, out_dir: Path, span: tuple[float, float]) -> list[Path]:
    """Runs one model pass over `wav`; returns the stem WAVs, named by stem."""
    check_job(job)
    if key not in separators:
        job.set(stage=f"loading {key} model", progress=span[0])
    separator = get_separator(key)

    job.set(stage="separating drum kit" if key == "kit" else "separating", progress=span[0], span=span)
    out_dir.mkdir()
    separator.model_instance.output_dir = str(out_dir)

    # Name outputs by stem so they can be mapped without parsing file names.
    cfg = getattr(separator.model_instance, "model_data_cfgdict", None)
    instruments = list(getattr(getattr(cfg, "training", None), "instruments", []) or [])
    custom = {name: name.lower() for name in instruments} or None
    separator.separate(str(wav), custom)

    wavs = sorted(out_dir.glob("*.wav"))
    if not wavs:
        raise RuntimeError("The model produced no stems")
    return wavs


def kit_file_name(model_stem: str) -> str:
    match = re.search(r"\(([^)]+)\)", model_stem)
    key = (match.group(1) if match else model_stem).strip().lower()
    return "kit_" + KIT_PIECE_NAMES.get(key, re.sub(r"[^a-z0-9]+", "_", key))


def is_backing_part(name: str) -> bool:
    """Whether a stem belongs in the backing mix: instruments, not drums or kit pieces."""
    return name not in ("drums", BACKING) and not name.startswith("kit_")


def mix_backing(parts: list[Path], dest: Path) -> None:
    run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", *[a for p in parts for a in ("-i", str(p))],
         "-filter_complex", f"amix=inputs={len(parts)}:normalize=0",
         "-c:a", "libvorbis", "-q:a", OGG_QUALITY, str(dest)])


def encode(job: Job, named: list[tuple[str, Path]], span: tuple[float, float]) -> None:
    lo, hi = span
    backing_parts: list[Path] = []
    for index, (name, wav) in enumerate(named):
        check_job(job)
        job.set(progress=lo + (hi - lo) * (index + 1) / len(named))
        if name != "drums" and is_silent(wav):
            # e.g. "keys" on a song without piano, or "ride" on a song that
            # never touches it: skip it so the mixer doesn't show a dead slider.
            continue
        if is_backing_part(name):
            backing_parts.append(wav)
        ogg = job.dir / f"{name}.ogg"
        if ogg.exists():
            # Two model stems mapped to the same name: mix them together.
            merged = job.dir / f"{name}.merge.ogg"
            run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(ogg), "-i", str(wav),
                 "-filter_complex", "amix=inputs=2:normalize=0", "-c:a", "libvorbis", "-q:a", OGG_QUALITY, str(merged)])
            merged.replace(ogg)
        else:
            run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(wav),
                 "-c:a", "libvorbis", "-q:a", OGG_QUALITY, str(ogg)])
        job.stems[name] = ogg
    # One instrument stem is its own backing; mixing only pays off from two.
    if len(backing_parts) >= 2:
        backing = job.dir / f"{BACKING}.ogg"
        try:
            mix_backing(backing_parts, backing)
            job.stems[BACKING] = backing
        except RuntimeError:
            # The stems themselves are fine; the app falls back to them.
            log.exception("Couldn't mix the backing track for job %s", job.id)
            backing.unlink(missing_ok=True)


def models_for(mode: str, quality: str) -> list[str]:
    return {
        "stems": [MODELS[quality]],
        "kit": [MODELS["kit"]],
        "stems+kit": [MODELS[quality], MODELS["kit"]],
    }[mode]


def cache_key(input_hashes: list[str], mode: str, quality: str) -> str:
    # Inputs are mixed with amix, which doesn't care about order, so sort them:
    # the same files sent in another order still hit.
    spec = {
        "v": CACHE_VERSION,
        "mode": mode,
        "models": models_for(mode, quality),
        "ogg": OGG_QUALITY,
        "inputs": sorted(input_hashes),
    }
    return hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()


def cache_entry(key: str) -> Path:
    # Two-character fan-out keeps any one directory from holding every entry.
    return CACHE_DIR / key[:2] / key


def cache_lookup(key: str) -> dict[str, Path] | None:
    """Stem name -> file for a complete cache entry, or None on a miss."""
    entry = cache_entry(key)
    try:
        manifest = json.loads((entry / "manifest.json").read_text())
    except (OSError, ValueError):
        return None
    stems = {name: entry / f"{name}.ogg" for name in manifest.get("stems", [])}
    if not stems or not all(path.is_file() for path in stems.values()):
        log.warning("Cache entry %s is incomplete; ignoring it", key)
        return None
    return stems


def ensure_backing(key: str, stems: dict[str, Path]) -> dict[str, Path]:
    """Adds the backing mix to a cache entry stored before splits made one, so
    old entries gain it without splitting again. Best effort: on failure the
    entry is served as it was."""
    parts = [path for name, path in sorted(stems.items()) if is_backing_part(name)]
    if BACKING in stems or len(parts) < 2:
        return stems
    entry = cache_entry(key)
    token = uuid.uuid4().hex
    tmp_ogg = entry / f".{BACKING}.{token}.ogg"
    tmp_manifest = entry / f".manifest.{token}.json"
    try:
        mix_backing(parts, tmp_ogg)
        tmp_ogg.replace(entry / f"{BACKING}.ogg")
        manifest = json.loads((entry / "manifest.json").read_text())
        manifest["stems"] = sorted({*manifest.get("stems", []), BACKING})
        tmp_manifest.write_text(json.dumps(manifest, indent=2))
        tmp_manifest.replace(entry / "manifest.json")
        log.info("Added the backing mix to cache entry %s", key)
        return {**stems, BACKING: entry / f"{BACKING}.ogg"}
    except (OSError, ValueError, RuntimeError):
        log.exception("Couldn't add the backing mix to cache entry %s", key)
        tmp_ogg.unlink(missing_ok=True)
        tmp_manifest.unlink(missing_ok=True)
        return stems


def cache_store(job: Job) -> None:
    """Moves a finished job's stems into the cache and points the job at them.
    The entry is written to a temporary folder and renamed into place, so a
    crash never leaves a half-written entry that looks complete."""
    key = job.cache_key
    if not key:
        return
    entry = cache_entry(key)
    tmp = CACHE_DIR / ".tmp" / uuid.uuid4().hex
    try:
        tmp.mkdir(parents=True)
        for name, path in job.stems.items():
            shutil.copyfile(path, tmp / f"{name}.ogg")
        manifest = {
            "key": key,
            "version": CACHE_VERSION,
            "mode": job.mode,
            "quality": job.quality,
            "models": models_for(job.mode, job.quality),
            "stems": sorted(job.stems),
            "created": time.time(),
        }
        (tmp / "manifest.json").write_text(json.dumps(manifest, indent=2))
        entry.parent.mkdir(parents=True, exist_ok=True)
        try:
            tmp.rename(entry)
        except OSError:
            # An entry is already there. Either another job stored this key
            # first, and its complete entry is as good as ours, or it's the
            # incomplete entry (a stem file went missing) that made this job
            # split again. Replace that one, or every later request for the
            # song would miss the cache and split it again too.
            if cache_lookup(key):
                shutil.rmtree(tmp, ignore_errors=True)
            else:
                broken = CACHE_DIR / ".tmp" / f"broken-{uuid.uuid4().hex}"
                entry.rename(broken)
                tmp.rename(entry)
                shutil.rmtree(broken, ignore_errors=True)
                log.info("Replaced incomplete cache entry %s", key)
        stems = cache_lookup(key)
        if stems:
            for path in job.stems.values():
                path.unlink(missing_ok=True)
            job.stems = stems
    except OSError:
        # A full or read-only disk shouldn't fail the split: serve the stems
        # from the job folder and just skip caching them.
        log.exception("Couldn't cache job %s", job.id)
        shutil.rmtree(tmp, ignore_errors=True)


def process(job: Job) -> None:
    global current_job
    current_job = job

    # Decode (and mix, if several files were sent) to one 44.1 kHz WAV.
    mix = job.dir / "mix.wav"
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-y"]
    for path in job.inputs:
        cmd += ["-i", str(path)]
    if len(job.inputs) > 1:
        cmd += ["-filter_complex", f"amix=inputs={len(job.inputs)}:normalize=0"]
    cmd += ["-ar", "44100", "-ac", "2", str(mix)]
    try:
        run(cmd)
    except FfmpegTimedOut as exc:
        raise JobFailed("timed_out") from exc
    except FfmpegFailed as exc:
        raise JobFailed("decode_failed") from exc

    named: list[tuple[str, Path]] = []
    if job.mode == "kit":
        wavs = separate(job, "kit", mix, job.dir / "kit", (5, 90))
        named = [(kit_file_name(w.stem), w) for w in wavs]
    else:
        both = job.mode == "stems+kit"
        wavs = separate(job, job.quality, mix, job.dir / "out", (5, 60 if both else 90))
        named = [(stem_file_name(w.stem), w) for w in wavs]
        if both:
            drums = [w for name, w in named if name == "drums"]
            if not drums:
                raise JobFailed("no_drums")
            kit = separate(job, "kit", drums[0], job.dir / "kit", (60, 90))
            named += [(kit_file_name(w.stem), w) for w in kit]

    job.set(stage="encoding", progress=90)
    encode(job, named, (90, 100))

    for sub in ("out", "kit"):
        shutil.rmtree(job.dir / sub, ignore_errors=True)
    mix.unlink(missing_ok=True)
    for path in job.inputs:
        path.unlink(missing_ok=True)
    cache_store(job)


def worker(stop: threading.Event) -> None:
    global current_job
    try:
        # Warm up the default preset so the first split doesn't wait for it.
        get_separator(DEFAULT_QUALITY)
    except JobFailed:
        pass  # logged by get_separator and reported through /health
    except Exception:  # noqa: BLE001 - the worker must keep serving other presets
        log.exception("Default model failed to load")

    while not stop.is_set():
        try:
            # Wakes up now and then to notice `stop`, so a shutdown (or a test
            # client closing) doesn't leave this thread behind.
            job_id = pending.get(timeout=THREAD_POLL_SECONDS)
        except queue.Empty:
            continue
        with lock:
            # Checked and claimed under the lock, so a cancel either beats the
            # start (and the job never runs) or sees it running.
            job = jobs.get(job_id)
            if not job or job.cancelled:
                continue
            job.set(status="running", stage="preparing", progress=1, deadline=clock() + JOB_TIMEOUT_SECONDS)
        started = time.time()
        error_code = None
        try:
            process(job)
            outcome = "done"
            log.info("Job %s done in %.0fs: %s", job.id, time.time() - started, sorted(job.stems))
        except Cancelled:
            outcome = "cancelled"
        except JobFailed as exc:
            log.error("Job %s failed: %s", job.id, exc.code, exc_info=exc.__cause__ or exc)
            outcome, error_code = "error", exc.code
        except FfmpegTimedOut:
            log.exception("Job %s failed: an ffmpeg step timed out", job.id)
            outcome, error_code = "error", "timed_out"
        except Exception:  # noqa: BLE001 - any other failure is still a finished job
            log.exception("Job %s failed", job.id)
            outcome, error_code = "error", "internal"
        finally:
            current_job = None
        finish(job, outcome, error_code)
        if outcome == "cancelled":
            shutil.rmtree(job.dir, ignore_errors=True)


def finish(job: Job, outcome: str, error_code: str | None = None) -> bool:
    """Moves a running job to its final status ("done", "error" or
    "cancelled"). Returns False, changing nothing, if the job already left
    "running": the watchdog may have timed it out while the model was stuck."""
    with lock:
        if job.status != "running":
            return False
        if outcome == "error":
            assert error_code is not None
            job.set(status="error", stage="error", error=JOB_ERROR_MESSAGES[error_code], error_code=error_code)
        else:
            job.set(status=outcome, stage=outcome, progress=100 if outcome == "done" else job.progress)
        if job.cache_key and inflight.get(job.cache_key) == job.id:
            inflight.pop(job.cache_key, None)
        return True


def expire_overdue_job() -> None:
    """Times out the running job once it's WATCHDOG_GRACE_SECONDS past its
    deadline. Normally the job stops itself at the deadline (check_job); this
    covers a model stuck where no check runs. Python can't kill the thread, so
    the job is also flagged cancelled in case the model ever returns."""
    job = current_job
    if not job or clock() <= job.deadline + WATCHDOG_GRACE_SECONDS:
        return
    job.cancelled = True
    if finish(job, "error", "timed_out"):
        log.error("Job %s is stuck past its deadline; timed it out. The worker stays busy until the model returns.", job.id)


def janitor(stop: threading.Event) -> None:
    while not stop.wait(JANITOR_INTERVAL_SECONDS):
        expire_overdue_job()
        cutoff = time.time() - JOB_TTL_SECONDS
        with lock:
            # Queued jobs are kept however long they wait; only finished,
            # failed and cancelled ones expire.
            stale = [j for j in jobs.values() if j.status not in ("queued", "running") and j.updated < cutoff]
            for job in stale:
                jobs.pop(job.id, None)
                shutil.rmtree(job.dir, ignore_errors=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    shutil.rmtree(WORK_DIR, ignore_errors=True)
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    if CACHE_ENABLED:
        # Leftovers from a store that was interrupted; finished entries stay.
        shutil.rmtree(CACHE_DIR / ".tmp", ignore_errors=True)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        log.info("Caching splits in %s", CACHE_DIR)
    stop = threading.Event()
    threads = [
        threading.Thread(target=worker, args=(stop,), daemon=True, name="separator"),
        threading.Thread(target=janitor, args=(stop,), daemon=True, name="janitor"),
    ]
    for thread in threads:
        thread.start()
    yield
    stop.set()
    for thread in threads:
        # A model pass can't be interrupted; don't hold up shutdown for it.
        thread.join(timeout=THREAD_POLL_SECONDS * 2)


app = FastAPI(title="SightKick stem server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(StarletteHTTPException)
async def http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    # Every error response is {"detail": <our message>, "code": <HTTP_ERROR_CODES>}.
    code = HTTP_ERROR_CODES.get(exc.status_code) or ("bad_request" if exc.status_code < 500 else "internal")
    return JSONResponse({"detail": exc.detail, "code": code}, exc.status_code, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, _exc: RequestValidationError) -> JSONResponse:
    # FastAPI's own 422 body lists pydantic errors; send our message instead.
    detail = "Send the audio as multipart 'files', with optional 'quality' and 'mode' fields"
    return JSONResponse({"detail": detail, "code": "bad_request"}, 400)


@app.middleware("http")
async def private_network_access(request: Request, call_next):
    # Lets pages served from the internet (e.g. GitHub Pages) call this server
    # on localhost in Chromium, which asks first via a preflight.
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.get("/health")
def health() -> dict:
    return {
        "ok": any(model_states[q]["status"] != "error" for q in QUALITIES),
        "apiVersion": API_VERSION,
        "defaultQuality": DEFAULT_QUALITY,
        "models": {
            key: {"model": MODELS[key], **model_states[key]}
            for key in MODELS
        },
        "modes": list(MODES),
        "queued": pending.qsize(),
        "cache": CACHE_ENABLED,
    }


@app.post("/jobs", status_code=202)
async def create_job(
    files: list[UploadFile] = File(...),
    quality: str = Form(DEFAULT_QUALITY),
    mode: str = Form("stems"),
) -> dict:
    if quality not in QUALITIES:
        raise HTTPException(400, f"quality must be one of: {', '.join(QUALITIES)}")
    if mode not in MODES:
        raise HTTPException(400, f"mode must be one of: {', '.join(MODES)}")
    needed = ([quality] if mode != "kit" else []) + (["kit"] if "kit" in mode else [])
    for key in needed:
        if model_states[key]["status"] == "error":
            raise HTTPException(503, f"{MODELS[key]} failed to load; see the server log")
    if not files:
        raise HTTPException(400, "Send at least one audio file")

    job_id = uuid.uuid4().hex
    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True)
    inputs: list[Path] = []
    hashes: list[str] = []
    total = 0
    try:
        for index, upload in enumerate(files):
            suffix = Path(upload.filename or "").suffix.lower()[:8] or ".audio"
            dest = job_dir / f"input{index}{suffix}"
            digest = hashlib.sha256()
            with dest.open("wb") as out:
                while chunk := await upload.read(1 << 20):
                    total += len(chunk)
                    if total > MAX_UPLOAD_MB * 1024 * 1024:
                        raise HTTPException(413, f"Upload is over {MAX_UPLOAD_MB} MB")
                    digest.update(chunk)
                    out.write(chunk)
            inputs.append(dest)
            hashes.append(digest.hexdigest())
    except BaseException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

    key = cache_key(hashes, mode, quality) if CACHE_ENABLED else None
    job = Job(id=job_id, dir=job_dir, inputs=inputs, quality=quality, mode=mode, cache_key=key)
    with lock:
        cached = cache_lookup(key) if key else None
        if not cached:
            joined = jobs.get(inflight.get(key, "")) if key else None
            if joined and joined.status in ("queued", "running") and not joined.cancelled:
                shutil.rmtree(job_dir, ignore_errors=True)
                joined.watchers += 1
                log.info("Job request joined running job %s (%d clients)", joined.id, joined.watchers)
                return joined.to_json(queue_position(joined))
            jobs[job_id] = job
            if key:
                inflight[key] = job_id
    if not cached:
        pending.put(job_id)
        return job.to_json(queue_position(job))

    assert key
    shutil.rmtree(job_dir, ignore_errors=True)
    # Outside the lock: mixing an old entry's backing takes a few seconds.
    stems = await asyncio.to_thread(ensure_backing, key, cached)
    job.set(status="done", stage="done", progress=100, stems=stems, cached=True)
    with lock:
        jobs[job_id] = job
    log.info("Job %s served from cache %s", job_id, key)
    return job.to_json(None)


def get_job(job_id: str) -> Job:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown or expired job")
    return job


@app.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = get_job(job_id)
    return job.to_json(queue_position(job))


@app.get("/jobs/{job_id}/stems/{name}")
def job_stem(job_id: str, name: str) -> FileResponse:
    job = get_job(job_id)
    path = job.stems.get(name)
    if job.status != "done" or not path or not path.exists():
        raise HTTPException(404, "Stem not available")
    return FileResponse(path, media_type="audio/ogg", filename=f"{name}.ogg")


@app.delete("/jobs/{job_id}")
def cancel_job(job_id: str) -> dict:
    job = get_job(job_id)
    # One lock for the whole decision: a request joining this job, or the
    # worker starting it, must see either the job before the cancel or after
    # it, never a job that is half cancelled.
    with lock:
        job.watchers -= 1
        if job.watchers > 0:
            # Another client still follows this job: only this one lets go.
            return {"id": job.id, "cancelled": True}
        job.cancelled = True
        # A running job stops at the model's next chunk; the worker records it.
        drop = job.status != "running"
        if job.status == "queued":
            job.set(status="cancelled", stage="cancelled")
        if drop:
            jobs.pop(job.id, None)
            if job.cache_key and inflight.get(job.cache_key) == job.id:
                inflight.pop(job.cache_key, None)
    if drop:
        shutil.rmtree(job.dir, ignore_errors=True)
    return {"id": job.id, "cancelled": True}
