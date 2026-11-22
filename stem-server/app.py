"""SightKick stem server.

A small HTTP service that splits a song into stems (drums, bass, vocals, ...)
with a source-separation model, so the browser build can mute the drums on
songs that ship as a single mixed audio file. Two presets:

- fast: HTDemucs (Demucs v4), the model the desktop app's splitter uses
- best: BS-RoFormer-SW, slower but with cleaner drums

Jobs run one at a time on a single worker thread; each model is loaded the
first time it's needed and then kept in memory.
"""

from __future__ import annotations

import logging
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
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

MODELS = {
    "fast": os.environ.get("SK_FAST_MODEL", "htdemucs.yaml"),
    "best": os.environ.get("SK_BEST_MODEL", "BS-Roformer-SW.ckpt"),
}
DEFAULT_QUALITY = os.environ.get("SK_DEFAULT_QUALITY", "fast")
MODEL_DIR = os.environ.get("SK_MODEL_DIR", "/models")
WORK_DIR = Path(os.environ.get("SK_WORK_DIR", Path(tempfile.gettempdir()) / "sightkick-stems"))
MAX_UPLOAD_MB = int(os.environ.get("SK_MAX_UPLOAD_MB", "200"))
JOB_TTL_SECONDS = int(os.environ.get("SK_JOB_TTL_SECONDS", "3600"))
OGG_QUALITY = os.environ.get("SK_OGG_QUALITY", "6")
# Stems whose peak stays below this (about -50 dBFS) are treated as empty.
SILENCE_PEAK = 10 ** (-50 / 20)
ALLOWED_ORIGINS = os.environ.get("SK_ALLOWED_ORIGINS", "*").split(",")

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

log = logging.getLogger("stem-server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


class Cancelled(Exception):
    pass


@dataclass
class Job:
    id: str
    dir: Path
    inputs: list[Path]
    quality: str = DEFAULT_QUALITY
    status: str = "queued"  # queued | running | done | error | cancelled
    stage: str = "queued"
    progress: float = 0.0
    error: str | None = None
    stems: dict[str, Path] = field(default_factory=dict)
    cancelled: bool = False
    updated: float = field(default_factory=time.time)

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
            "model": MODELS[self.quality],
            "queuePosition": position,
            "stems": sorted(self.stems),
            "error": self.error,
        }


jobs: dict[str, Job] = {}
pending: "queue.Queue[str]" = queue.Queue()
lock = threading.Lock()
current_job: Job | None = None
# quality -> {"status": not loaded | loading | ready | error, "error": str}
model_states = {q: {"status": "not loaded", "error": None} for q in MODELS}
separators: dict[str, object] = {}


def queue_position(job: Job) -> int | None:
    if job.status != "queued":
        return None
    with pending.mutex:
        waiting = list(pending.queue)
    return waiting.index(job.id) + 1 if job.id in waiting else None


class ProgressIter:
    """Stands in for tqdm in the models' chunk loops: reports progress on the
    current job and lets a cancel stop the model between chunks."""

    def __init__(self, iterable=None, *args, **kwargs):
        self.iterable = iterable if iterable is not None else []
        try:
            self.total = len(self.iterable)
        except TypeError:
            self.total = kwargs.get("total") or 0

    def __iter__(self):
        job = current_job
        for index, item in enumerate(self.iterable):
            if job and job.cancelled:
                raise Cancelled()
            yield item
            if job and self.total:
                # 5-90% is the model; the rest is decoding and encoding.
                job.set(progress=5 + 85 * (index + 1) / self.total)

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
    """Returns the separator for a preset, loading (and on first use
    downloading) its model if needed. Only called from the worker thread."""
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
        state.update(status="error", error=str(exc))
        raise
    install_progress_hooks()
    separators[quality] = sep
    state.update(status="ready")
    log.info("%s model ready on %s", model, getattr(sep, "torch_device", "cpu"))
    return sep


def run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {result.stderr.strip()[-500:]}")


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


def process(job: Job) -> None:
    global current_job
    current_job = job
    job.set(status="running", stage="preparing", progress=1)

    # Decode (and mix, if several files were sent) to one 44.1 kHz WAV.
    mix = job.dir / "mix.wav"
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-y"]
    for path in job.inputs:
        cmd += ["-i", str(path)]
    if len(job.inputs) > 1:
        cmd += ["-filter_complex", f"amix=inputs={len(job.inputs)}:normalize=0"]
    cmd += ["-ar", "44100", "-ac", "2", str(mix)]
    run(cmd)

    if job.cancelled:
        raise Cancelled()

    if job.quality not in separators:
        job.set(stage="loading model", progress=2)
    separator = get_separator(job.quality)

    job.set(stage="separating", progress=5)
    out_dir = job.dir / "out"
    out_dir.mkdir()
    separator.model_instance.output_dir = str(out_dir)

    # Name outputs by stem so they can be mapped without parsing file names.
    stems = getattr(separator.model_instance, "model_data_cfgdict", None)
    instruments = list(getattr(getattr(stems, "training", None), "instruments", []) or [])
    custom = {name: name.lower() for name in instruments} or None
    separator.separate(str(mix), custom)

    job.set(stage="encoding", progress=90)
    wavs = sorted(out_dir.glob("*.wav"))
    if not wavs:
        raise RuntimeError("The model produced no stems")

    for index, wav in enumerate(wavs):
        if job.cancelled:
            raise Cancelled()
        name = stem_file_name(wav.stem)
        if name != "drums" and is_silent(wav):
            # e.g. "keys" on a song without piano: skip it so the mixer
            # doesn't show a dead slider.
            job.set(progress=90 + 10 * (index + 1) / len(wavs))
            continue
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
        job.set(progress=90 + 10 * (index + 1) / len(wavs))

    shutil.rmtree(out_dir, ignore_errors=True)
    mix.unlink(missing_ok=True)
    for path in job.inputs:
        path.unlink(missing_ok=True)
    job.set(status="done", stage="done", progress=100)


def worker() -> None:
    global current_job
    try:
        # Warm up the default preset so the first split doesn't wait for it.
        get_separator(DEFAULT_QUALITY)
    except Exception:  # noqa: BLE001 - reported through /health
        log.exception("Default model failed to load")

    while True:
        job_id = pending.get()
        job = jobs.get(job_id)
        if not job or job.cancelled:
            continue
        started = time.time()
        try:
            process(job)
            log.info("Job %s done in %.0fs: %s", job.id, time.time() - started, sorted(job.stems))
        except Cancelled:
            job.set(status="cancelled", stage="cancelled")
            shutil.rmtree(job.dir, ignore_errors=True)
        except Exception as exc:  # noqa: BLE001 - surface any failure to the client
            log.exception("Job %s failed", job.id)
            job.set(status="error", stage="error", error=str(exc))
        finally:
            current_job = None


def janitor() -> None:
    while True:
        time.sleep(60)
        cutoff = time.time() - JOB_TTL_SECONDS
        with lock:
            stale = [j for j in jobs.values() if j.status != "running" and j.updated < cutoff]
            for job in stale:
                jobs.pop(job.id, None)
                shutil.rmtree(job.dir, ignore_errors=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    shutil.rmtree(WORK_DIR, ignore_errors=True)
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=worker, daemon=True, name="separator").start()
    threading.Thread(target=janitor, daemon=True, name="janitor").start()
    yield


app = FastAPI(title="SightKick stem server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
        "ok": any(state["status"] != "error" for state in model_states.values()),
        "defaultQuality": DEFAULT_QUALITY,
        "models": {
            quality: {"model": MODELS[quality], **model_states[quality]}
            for quality in MODELS
        },
        "queued": pending.qsize(),
    }


@app.post("/jobs", status_code=202)
async def create_job(
    files: list[UploadFile] = File(...),
    quality: str = Form(DEFAULT_QUALITY),
) -> dict:
    if quality not in MODELS:
        raise HTTPException(400, f"quality must be one of: {', '.join(MODELS)}")
    if model_states[quality]["status"] == "error":
        raise HTTPException(503, f"{MODELS[quality]} failed to load: {model_states[quality]['error']}")
    if not files:
        raise HTTPException(400, "Send at least one audio file")

    job_id = uuid.uuid4().hex
    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True)
    inputs: list[Path] = []
    total = 0
    try:
        for index, upload in enumerate(files):
            suffix = Path(upload.filename or "").suffix.lower()[:8] or ".audio"
            dest = job_dir / f"input{index}{suffix}"
            with dest.open("wb") as out:
                while chunk := await upload.read(1 << 20):
                    total += len(chunk)
                    if total > MAX_UPLOAD_MB * 1024 * 1024:
                        raise HTTPException(413, f"Upload is over {MAX_UPLOAD_MB} MB")
                    out.write(chunk)
            inputs.append(dest)
    except BaseException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

    job = Job(id=job_id, dir=job_dir, inputs=inputs, quality=quality)
    with lock:
        jobs[job_id] = job
    pending.put(job_id)
    return job.to_json(queue_position(job))


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
    job.cancelled = True
    if job.status == "queued":
        job.set(status="cancelled", stage="cancelled")
    if job.status != "running":
        with lock:
            jobs.pop(job.id, None)
        shutil.rmtree(job.dir, ignore_errors=True)
    return {"id": job.id, "cancelled": True}
