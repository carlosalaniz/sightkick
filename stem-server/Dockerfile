# SightKick stem server: splits songs into stems with BS-RoFormer-SW.

# --- build: compile/install Python deps into a venv -------------------------
FROM python:3.12-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

# CPU-only PyTorch first, so pip doesn't pull the multi-GB CUDA build.
# For an NVIDIA GPU, build with: --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu124
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir torch --index-url ${TORCH_INDEX}

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- runtime ------------------------------------------------------------------
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    SK_MODEL_DIR=/models \
    SK_CACHE_DIR=/cache

WORKDIR /app
COPY app.py .

# The ~700 MB model is downloaded here on first start; mount a volume to keep it.
VOLUME /models
# Finished splits, kept forever; mount a volume so they survive the container.
VOLUME /cache
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8765/health')"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8765"]
