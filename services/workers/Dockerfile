FROM python:3.11-slim

# gcc + python3-dev needed to compile pyvips cffi extension (slim image has no build tools)
# libvips-dev provides the native library for panorama tiling
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Default: run FastAPI. Override CMD for Celery worker.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
