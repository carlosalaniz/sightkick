"""Tests for the job queue and split cache, with the separation library faked.

Needs ffmpeg plus: pip install fastapi python-multipart httpx numpy soundfile pytest
Run from stem-server/: python -m pytest test_app.py
"""

import hashlib
import io
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import types
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

_tmp = Path(tempfile.mkdtemp(prefix="sk-stem-test-"))
os.environ["SK_CACHE_DIR"] = str(_tmp / "cache")
os.environ["SK_WORK_DIR"] = str(_tmp / "work")

import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def wav_bytes(freq: float) -> bytes:
    t = np.linspace(0, 0.5, 22050, endpoint=False)
    buf = io.BytesIO()
    sf.write(buf, 0.3 * np.sin(2 * np.pi * freq * t), 44100, format="WAV")
    return buf.getvalue()


class FakeAudioSeparator:
    """Stands in for the python-audio-separator package at its import path, so
    our adapter (get_separator, separate, the progress hooks, stem naming) runs
    for real on top of it.

    Like the library, its Separator writes one WAV per stem into the model's
    output_dir: "<input>_(<Stem>)_<model>.wav" for Demucs, or the custom names
    it's given for models whose config lists their instruments (RoFormer,
    MDX23C). Its chunk loop goes through the module-level tqdm that
    install_progress_hooks replaces.

    Knobs: `stems` (what the instrument model finds), `kit_pieces`, `gate`
    (hold every chunk until the test sets it), `fail` (raise from a run),
    `broken` (model files whose load_model raises)."""

    def __init__(self):
        self.runs = 0
        self.loads: list[str] = []
        self.stems = ["Drums", "Bass"]
        self.kit_pieces = ["kick", "snare"]
        self.gate: threading.Event | None = None
        self.fail: Exception | None = None
        self.broken: set[str] = set()
        self.chunks_started = threading.Event()

        lib = self
        tqdm_module = types.ModuleType("tqdm")
        tqdm_module.tqdm = lambda iterable=None, *a, **k: iterable

        class Separator:
            def __init__(self, **kwargs):
                self.output_dir = kwargs["output_dir"]
                self.model_instance = None

            def load_model(self, model_filename):
                lib.loads.append(model_filename)
                if model_filename in lib.broken:
                    raise RuntimeError(f"LIBRARY-TEXT: no such file /models/{model_filename}")
                self.model_name = Path(model_filename).stem
                self.model_instance = types.SimpleNamespace(output_dir=self.output_dir)
                if model_filename == app.KIT_MODEL:
                    names = lib.kit_pieces
                elif model_filename.endswith(".yaml"):
                    names = None  # Demucs: no config with instrument names
                else:
                    names = lib.stems
                if names is not None:
                    self.model_instance.model_data_cfgdict = types.SimpleNamespace(
                        training=types.SimpleNamespace(instruments=list(names))
                    )

            def separate(self, audio_file_path, custom_output_names=None):
                lib.runs += 1
                data, rate = sf.read(audio_file_path)
                if custom_output_names:
                    tqdm = lib.modules["audio_separator.separator.architectures.mdxc_separator"].tqdm
                    outputs = [custom_output_names[n] for n in custom_output_names]
                else:
                    tqdm = lib.modules["audio_separator.separator.uvr_lib_v5.demucs.apply"].tqdm.tqdm
                    base = Path(audio_file_path).stem
                    outputs = [f"{base}_({n})_{self.model_name}" for n in lib.stems]
                for _ in tqdm(range(4)):
                    lib.chunks_started.set()
                    if lib.gate:
                        lib.gate.wait(5)
                    if lib.fail:
                        raise lib.fail
                paths = []
                for i, name in enumerate(outputs):
                    path = Path(self.model_instance.output_dir) / f"{name}.wav"
                    # A different pitch per stem, so a mix differs from any one stem.
                    tone = 0.1 * np.sin(np.arange(len(data)) * (i + 1) / 20)
                    sf.write(str(path), data * 0.5 + (tone[:, None] if data.ndim == 2 else tone), rate)
                    paths.append(str(path))
                return paths

        def module(name, **attrs):
            mod = types.ModuleType(name)
            for key, value in attrs.items():
                setattr(mod, key, value)
            return mod

        mdxc = module("audio_separator.separator.architectures.mdxc_separator", tqdm=tqdm_module.tqdm)
        demucs_apply = module("audio_separator.separator.uvr_lib_v5.demucs.apply", tqdm=tqdm_module)
        demucs = module("audio_separator.separator.uvr_lib_v5.demucs", apply=demucs_apply)
        uvr = module("audio_separator.separator.uvr_lib_v5", demucs=demucs)
        architectures = module("audio_separator.separator.architectures", mdxc_separator=mdxc)
        separator = module(
            "audio_separator.separator", Separator=Separator, architectures=architectures, uvr_lib_v5=uvr
        )
        self.modules = {
            "audio_separator": module("audio_separator", separator=separator),
            "audio_separator.separator": separator,
            "audio_separator.separator.architectures": architectures,
            "audio_separator.separator.architectures.mdxc_separator": mdxc,
            "audio_separator.separator.uvr_lib_v5": uvr,
            "audio_separator.separator.uvr_lib_v5.demucs": demucs,
            "audio_separator.separator.uvr_lib_v5.demucs.apply": demucs_apply,
        }


HAS_LIBVORBIS = "libvorbis" in subprocess.run(
    ["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True
).stdout


@pytest.fixture
def lib(monkeypatch):
    fake = FakeAudioSeparator()
    for name, module in fake.modules.items():
        monkeypatch.setitem(sys.modules, name, module)
    # Each test starts from a fresh server: no loaded models, jobs or queue.
    monkeypatch.setattr(app, "separators", {})
    monkeypatch.setattr(app, "model_states", {k: {"status": "not loaded", "error": None} for k in app.MODELS})
    monkeypatch.setattr(app, "jobs", {})
    monkeypatch.setattr(app, "inflight", {})
    monkeypatch.setattr(app, "pending", queue.Queue())

    real_run = app.run

    def run(cmd, **kwargs):
        # Some ffmpeg builds (e.g. Homebrew's) lack libvorbis; fall back to
        # ffmpeg's own experimental Vorbis encoder for the tests.
        if "libvorbis" in cmd and not HAS_LIBVORBIS:
            i = cmd.index("libvorbis")
            cmd = cmd[:i] + ["vorbis", "-strict", "-2", "-ac", "2"] + cmd[i + 1:]
        real_run(cmd, **kwargs)

    monkeypatch.setattr(app, "run", run)
    return fake


@pytest.fixture
def client(lib):
    # Leaving the block runs the app's shutdown, which stops its threads.
    with TestClient(app.app) as c:
        yield c
        if lib.gate:
            lib.gate.set()  # let a held model pass finish so the worker can exit
    alive = [t.name for t in threading.enumerate() if t.name in ("separator", "janitor")]
    assert not alive, f"threads left running: {alive}"


def post(client, audio: bytes, mode: str = "stems") -> dict:
    res = client.post(
        "/jobs",
        files=[("files", ("song.wav", audio, "audio/wav"))],
        data={"quality": "fast", "mode": mode},
    )
    assert res.status_code == 202, res.text
    return res.json()


def wait_done(client, job_id: str) -> dict:
    for _ in range(200):
        job = client.get(f"/jobs/{job_id}").json()
        if job["status"] not in ("queued", "running"):
            return job
        time.sleep(0.05)
    raise AssertionError("job never finished")


def test_second_request_for_same_audio_is_served_from_cache(client, lib):
    audio = wav_bytes(220)
    first = wait_done(client, post(client, audio)["id"])
    assert first["status"] == "done"
    assert first["cached"] is False
    assert first["stems"] == ["bass", "drums"]

    second = post(client, audio)
    assert second["status"] == "done"
    assert second["cached"] is True
    assert second["stems"] == ["bass", "drums"]
    assert lib.runs == 1

    a = client.get(f"/jobs/{first['id']}/stems/drums").content
    b = client.get(f"/jobs/{second['id']}/stems/drums").content
    assert a == b and len(a) > 0


def test_deleting_a_job_keeps_its_cache_entry(client, lib):
    audio = wav_bytes(330)
    job = wait_done(client, post(client, audio)["id"])
    client.delete(f"/jobs/{job['id']}")

    again = post(client, audio)
    assert again["cached"] is True
    assert client.get(f"/jobs/{again['id']}/stems/bass").status_code == 200


def test_mode_and_audio_are_part_of_the_key(client, lib):
    audio = wav_bytes(440)
    wait_done(client, post(client, audio)["id"])
    kit = post(client, audio, mode="kit")
    assert kit["cached"] is False
    assert wait_done(client, kit["id"])["stems"] == ["kit_kick", "kit_snare"]

    other = post(client, wav_bytes(441))
    assert other["cached"] is False
    wait_done(client, other["id"])
    assert lib.runs == 3


def test_same_audio_while_splitting_joins_the_running_job(client, lib):
    lib.gate = threading.Event()
    audio = wav_bytes(550)
    first = post(client, audio)
    second = post(client, audio)
    assert second["id"] == first["id"]

    # One client cancelling must not cancel the job for the other.
    client.delete(f"/jobs/{first['id']}")
    lib.gate.set()
    job = wait_done(client, second["id"])
    assert job["status"] == "done"
    assert lib.runs == 1


def test_incomplete_cache_entry_is_a_miss(client, lib):
    audio = wav_bytes(660)
    wait_done(client, post(client, audio)["id"])
    for path in Path(os.environ["SK_CACHE_DIR"]).glob("*/*/drums.ogg"):
        path.unlink()

    again = post(client, audio)
    assert again["cached"] is False
    assert wait_done(client, again["id"])["status"] == "done"
    assert lib.runs == 2


def test_instrument_stems_also_come_mixed_into_a_backing_track(client, lib):
    lib.stems = ["Drums", "Bass", "Vocals", "Other"]
    job = wait_done(client, post(client, wav_bytes(770))["id"])
    assert job["stems"] == ["backing", "bass", "drums", "song", "vocals"]
    backing = client.get(f"/jobs/{job['id']}/stems/backing").content
    bass = client.get(f"/jobs/{job['id']}/stems/bass").content
    assert len(backing) > 0 and backing != bass

    again = post(client, wav_bytes(770))
    assert again["cached"] is True
    assert "backing" in again["stems"]


def test_a_single_instrument_or_a_kit_split_gets_no_backing(client, lib):
    job = wait_done(client, post(client, wav_bytes(880))["id"])
    assert "backing" not in job["stems"]
    kit = wait_done(client, post(client, wav_bytes(880), mode="kit")["id"])
    assert "backing" not in kit["stems"]


def test_old_cache_entries_gain_a_backing_track_without_splitting_again(client, lib):
    lib.stems = ["Drums", "Bass", "Vocals"]
    audio = wav_bytes(990)
    wait_done(client, post(client, audio)["id"])
    # Turn the entry into one stored before splits made a backing mix.
    key = app.cache_key([hashlib.sha256(audio).hexdigest()], "stems", "fast")
    manifest_path = app.cache_entry(key) / "manifest.json"
    (manifest_path.parent / "backing.ogg").unlink()
    manifest = json.loads(manifest_path.read_text())
    manifest["stems"].remove("backing")
    manifest_path.write_text(json.dumps(manifest))

    again = post(client, audio)
    assert again["cached"] is True
    assert "backing" in again["stems"]
    assert lib.runs == 1
    assert "backing" in json.loads(manifest_path.read_text())["stems"]
    assert client.get(f"/jobs/{again['id']}/stems/backing").status_code == 200


def wait_for(condition, what: str) -> None:
    for _ in range(200):
        if condition():
            return
        time.sleep(0.02)
    raise AssertionError(f"timed out waiting for {what}")


def test_cancelling_a_running_job_stops_it_between_chunks(client, lib):
    lib.gate = threading.Event()
    job = post(client, wav_bytes(1100))
    wait_for(lib.chunks_started.is_set, "the model to start")

    assert client.delete(f"/jobs/{job['id']}").json() == {"id": job["id"], "cancelled": True}
    lib.gate.set()
    done = wait_done(client, job["id"])
    assert done["status"] == "cancelled"
    # Cancelled work leaves nothing in the cache: the same audio splits again.
    lib.gate = None
    again = post(client, wav_bytes(1100))
    assert again["cached"] is False
    assert wait_done(client, again["id"])["status"] == "done"


def test_cancelling_a_queued_job_drops_it_before_it_runs(client, lib):
    lib.gate = threading.Event()
    running = post(client, wav_bytes(1200))
    wait_for(lib.chunks_started.is_set, "the first job to start")
    queued = post(client, wav_bytes(1201))
    assert queued["status"] == "queued" and queued["queuePosition"] == 1

    client.delete(f"/jobs/{queued['id']}")
    assert client.get(f"/jobs/{queued['id']}").status_code == 404
    lib.gate.set()
    assert wait_done(client, running["id"])["status"] == "done"
    assert lib.runs == 1

    # The cancelled job no longer owns its audio: a new request starts fresh.
    lib.gate = None
    fresh = post(client, wav_bytes(1201))
    assert fresh["id"] != queued["id"]
    assert wait_done(client, fresh["id"])["status"] == "done"
