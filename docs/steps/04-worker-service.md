# Step 4: Worker Service (Python FastAPI + Celery)

## Goal

Run the admin REST API, panorama tiling pipeline (libvips → MinIO), NSFW moderation (onnxruntime), and ELO recalculation worker on Main PC.

## Prerequisites

- Python 3.11+, pip
- libvips system library installed (`apt install libvips-dev` on Debian/Ubuntu)
- Step 2 (infra) completed — Postgres, Valkey, RabbitMQ, MinIO running

## Steps

### 1. Install system dependencies

```bash
# Debian/Ubuntu
sudo apt update && sudo apt install -y libvips-dev

# Verify
vips --version
```

### 2. Install Python dependencies

```bash
cd services/workers
pip install -r requirements.txt
```

### 3. Download NSFW model

```bash
# Download nsfwdetector ONNX model (~50MB)
mkdir -p models
curl -L https://github.com/GantMan/nsfw_model/releases/download/1.1.0/nsfw.onnx \
  -o models/nsfw.onnx
```

### 4. Set environment variables

```bash
export DATABASE_URL="postgresql+asyncpg://gssr:password@localhost:5432/gssr"
export VALKEY_URL="redis://localhost:6379"
export RABBITMQ_URL="amqp://gssr:password@localhost:5672/"
export MINIO_ENDPOINT="localhost:9000"
export MINIO_ACCESS_KEY="gssr"
export MINIO_SECRET_KEY="password"
export MINIO_BUCKET="gssr"
export NSFW_MODEL_PATH="models/nsfw.onnx"
export NSFW_THRESHOLD="0.7"
export ADMIN_JWT_SECRET="same-as-game-service"
```

### 5. Run FastAPI dev server

```bash
uvicorn app.main:app --reload --port 8000
```

### 6. Run Celery worker (separate terminal)

```bash
celery -A app.tasks.celery_app worker -l info -Q default -c 4
```

## Key Implementation Notes

### Tiling Pipeline

Upload flow:

```text
POST /admin/panoramas (multipart file upload)
  → save raw file to MinIO: /raw/{pano_id}.jpg
  → create DB record (tile_status="pending")
  → tile_panorama.delay(pano_id)   ← Celery task
  → moderate_panorama.delay(pano_id)   ← Celery task (parallel)
```

Tiling task (`tasks/tiling.py`):

```python
import pyvips
img = pyvips.Image.new_from_file(raw_path)
img.dzsave(output_dir, layout="google", tile_size=256, overlap=0,
           suffix=".webp[Q=85]", depth="onetile")
# Upload entire tile tree to MinIO
# Update pano.tile_status = "tiled"
```

### NSFW Moderation

```python
import onnxruntime as rt
session = rt.InferenceSession("models/nsfw.onnx")
# Preprocess: resize to 299x299, normalize to [-1, 1]
# Run inference → get "nsfw" probability score
# If score > NSFW_THRESHOLD: pano.moderation_status = "flagged"
# Else: pano.moderation_status = "clean"
```

### ELO Recalculation

Triggered by RabbitMQ message `match.ended` (published by game service):

```python
# Elo formula: new_rating = old_rating + K * (actual - expected)
# K = 32 for new players (< 30 games), K = 16 for experienced
# expected = 1 / (1 + 10^((opponent_rating - player_rating) / 400))
```

## Verification

```bash
# Health check
curl http://localhost:8000/health
# → {"status":"ok","db":"ok","storage":"ok"}

# Upload a test panorama (requires admin JWT)
curl -b admin-cookies.txt -X POST http://localhost:8000/admin/panoramas \
  -F "file=@test-panorama.jpg" \
  -F "floor_id=<uuid>" \
  -F "x=512" \
  -F "y=256" \
  -F "north_offset=0"

# Check Celery task processed:
# MinIO: browse http://localhost:9001 → gssr bucket → panoramas/{id}/
# DB: SELECT tile_status, moderation_status FROM panoramas WHERE id = '<id>';
```

## Troubleshooting

- **`libvips not found`**: ensure `libvips-dev` is installed AND `pyvips` pip package, not just one
- **Celery tasks not running**: check RabbitMQ is up (`docker ps`), check RABBITMQ_URL
- **NSFW model missing**: re-run the model download step; check NSFW_MODEL_PATH env var
- **MinIO access denied**: check bucket policy — set bucket to public-read for tile serving or pre-signed URLs
