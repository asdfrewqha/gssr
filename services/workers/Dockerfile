FROM python:3.11-slim

# gcc + python3-dev: build tools for pip packages
# hugin-tools: nona for cube-face projection (panorama tiling)
# ffmpeg: dual-fisheye → equirectangular conversion (Samsung SM-C200 / Gear 360)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    hugin-tools \
    ffmpeg \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Download NSFW ONNX model (GantMan inception model via Fyko, ~12 MB).
# Skip if already present (e.g. mounted or baked into a derived image).
RUN mkdir -p models && \
    [ -f models/nsfw.onnx ] || \
    wget -q -O models/nsfw.onnx \
      https://github.com/Fyko/nsfw/releases/download/v0.2.0/model.onnx

# Default: run FastAPI. Override CMD for Celery worker.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
