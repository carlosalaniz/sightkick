"""Tests for the job queue and split cache, with the models stubbed out.

Needs ffmpeg plus: pip install fastapi python-multipart httpx numpy soundfile pytest
Run from stem-server/: python -m pytest test_app.py
"""

import io
import os
import subprocess
import tempfile
import threading
import time
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


class StubSeparator:
    """Stands in for separate(): writes a drums and a bass stem and counts runs.
    Set `gate` to hold a run until the test releases it."""

    def __init__(self):
        self.runs = 0
        self.gate: threading.Event | None = None

    def __call__(self, job, key, wav, out_dir, span):
        if self.gate:
            self.gate.wait(5)
        self.runs += 1
        out_dir.mkdir()
        data, rate = sf.read(str(wav))
        names = ["kick", "snare"] if key == "kit" else ["drums", "bass"]
        paths = []
        for name in names:
            path = out_dir / f"{name}.wav"
            sf.write(str(path), data, rate)
            paths.append(path)
        return paths


@pytest.fixture
def stub(monkeypatch):
    sep = StubSeparator()
    monkeypatch.setattr(app, "separate", sep)
    monkeypatch.setattr(app, "get_separator", lambda quality: None)
    real_run = app.run

    def run(cmd):
        # Some ffmpeg builds (e.g. Homebrew's) lack libvorbis; fall back to
        # ffmpeg's own experimental Vorbis encoder for the tests.
        if "libvorbis" in cmd and not HAS_LIBVORBIS:
            i = cmd.index("libvorbis")
            cmd = cmd[:i] + ["vorbis", "-strict", "-2", "-ac", "2"] + cmd[i + 1:]
        real_run(cmd)

    monkeypatch.setattr(app, "run", run)
    return sep


HAS_LIBVORBIS = "libvorbis" in subprocess.run(
    ["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True
).stdout


@pytest.fixture
def client(stub):
    with TestClient(app.app) as c:
        yield c


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


def test_second_request_for_same_audio_is_served_from_cache(client, stub):
    audio = wav_bytes(220)
    first = wait_done(client, post(client, audio)["id"])
    assert first["status"] == "done"
    assert first["cached"] is False
    assert first["stems"] == ["bass", "drums"]

    second = post(client, audio)
    assert second["status"] == "done"
    assert second["cached"] is True
    assert second["stems"] == ["bass", "drums"]
    assert stub.runs == 1

    a = client.get(f"/jobs/{first['id']}/stems/drums").content
    b = client.get(f"/jobs/{second['id']}/stems/drums").content
    assert a == b and len(a) > 0


def test_deleting_a_job_keeps_its_cache_entry(client, stub):
    audio = wav_bytes(330)
    job = wait_done(client, post(client, audio)["id"])
    client.delete(f"/jobs/{job['id']}")

    again = post(client, audio)
    assert again["cached"] is True
    assert client.get(f"/jobs/{again['id']}/stems/bass").status_code == 200


def test_mode_and_audio_are_part_of_the_key(client, stub):
    audio = wav_bytes(440)
    wait_done(client, post(client, audio)["id"])
    kit = post(client, audio, mode="kit")
    assert kit["cached"] is False
    assert wait_done(client, kit["id"])["stems"] == ["kit_kick", "kit_snare"]

    other = post(client, wav_bytes(441))
    assert other["cached"] is False
    wait_done(client, other["id"])
    assert stub.runs == 3


def test_same_audio_while_splitting_joins_the_running_job(client, stub):
    stub.gate = threading.Event()
    audio = wav_bytes(550)
    first = post(client, audio)
    second = post(client, audio)
    assert second["id"] == first["id"]

    # One client cancelling must not cancel the job for the other.
    client.delete(f"/jobs/{first['id']}")
    stub.gate.set()
    job = wait_done(client, second["id"])
    assert job["status"] == "done"
    assert stub.runs == 1


def test_incomplete_cache_entry_is_a_miss(client, stub):
    audio = wav_bytes(660)
    wait_done(client, post(client, audio)["id"])
    for path in Path(os.environ["SK_CACHE_DIR"]).glob("*/*/drums.ogg"):
        path.unlink()

    again = post(client, audio)
    assert again["cached"] is False
    assert wait_done(client, again["id"])["status"] == "done"
    assert stub.runs == 2
