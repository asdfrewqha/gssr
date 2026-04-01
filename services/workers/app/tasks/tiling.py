import glob
import logging
import math
import os
import subprocess
import sys
import tempfile

from PIL import Image

from app.config import settings
from app.storage.minio_client import minio_client
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

# Pannellum multires parameters — must match PanoramaViewer constants
CUBE_FACE_RESOLUTION = 4096  # pixels per cube face at max level
TILE_RESOLUTION = 512  # pixels per tile
MAX_LEVEL = int(math.log2(CUBE_FACE_RESOLUTION // TILE_RESOLUTION)) + 1  # = 4

# generate.py lives at /app/generate.py inside the container (WORKDIR /app)
_GENERATE_PY = os.path.join(os.path.dirname(__file__), "..", "..", "generate.py")


@celery_app.task(name="tile_panorama", bind=True, max_retries=3)
def tile_panorama(self, pano_id: str):
    """Convert equirectangular panorama to Pannellum multires cube tiles and upload to MinIO."""
    import redis as _redis
    from sqlalchemy import text

    from app.db.base import sync_engine

    logger.info("Tiling panorama %s", pano_id)

    _r = _redis.from_url(settings.valkey_url)

    def _publish(status: str) -> None:
        _r.publish(f"pano:status:{pano_id}", status)

    with sync_engine.begin() as conn:
        conn.execute(
            text("UPDATE panoramas SET tile_status = 'tiling' WHERE id = :id"),
            {"id": pano_id},
        )
    _publish("tiling")

    try:
        raw_key = f"raw/{pano_id}.jpg"
        prefix = f"maps/panoramas/{pano_id}"

        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "panorama.jpg")
            minio_client.fget_object(settings.minio_bucket_panoramas, raw_key, raw_path)

            # Generate compressed preview (2048×1024, q=40) before tiling so viewer
            # can show equirectangular fallback while tiles are being generated.
            preview_path = os.path.join(tmpdir, "preview.jpg")
            with Image.open(raw_path) as img:
                preview = img.resize((2048, 1024), Image.LANCZOS)
                preview.save(preview_path, "JPEG", quality=40, optimize=True)
            minio_client.fput_object(
                settings.minio_bucket_panoramas,
                f"{prefix}/preview.jpg",
                preview_path,
                content_type="image/jpeg",
            )
            logger.debug("Preview uploaded for %s", pano_id)

            output_dir = os.path.join(tmpdir, "output")

            # generate.py uses argparse at module level so must be called as subprocess.
            # Outputs tiles as: output/{level}/{face}{row}_{col}.jpg
            # Path template for viewer: /%l/%s%y_%x (matches Pannellum generate.py exactly)
            proc = subprocess.run(
                [
                    sys.executable,
                    os.path.abspath(_GENERATE_PY),
                    raw_path,
                    "-o",
                    output_dir,
                    "-s",
                    str(TILE_RESOLUTION),
                    "-c",
                    str(CUBE_FACE_RESOLUTION),
                    "-H",
                    "360",
                    "-V",
                    "180",
                    "-q",
                    "85",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
            if proc.returncode != 0:
                logger.error("generate.py failed (exit %d):\n%s", proc.returncode, proc.stderr)
                raise subprocess.CalledProcessError(proc.returncode, proc.args)
            logger.debug("generate.py finished for %s", pano_id)

            # Remove old tiles before uploading new ones
            try:
                old = minio_client.list_objects(settings.minio_bucket_panoramas, prefix=f"{prefix}/", recursive=True)
                for obj in old:
                    minio_client.remove_object(settings.minio_bucket_panoramas, obj.object_name)
            except Exception as cleanup_exc:
                logger.warning("Old tile cleanup failed for %s: %s", pano_id, cleanup_exc)

            # Upload tiles: output/{level}/{face}{row}_{col}.jpg → prefix/{level}/{face}{row}_{col}.jpg
            total_tiles = 0
            for tile_path in glob.glob(os.path.join(output_dir, "*", "*.jpg")):
                rel = os.path.relpath(tile_path, output_dir).replace(os.sep, "/")
                minio_client.fput_object(
                    settings.minio_bucket_panoramas,
                    f"{prefix}/{rel}",
                    tile_path,
                    content_type="image/jpeg",
                )
                total_tiles += 1

        with sync_engine.begin() as conn:
            conn.execute(
                text("UPDATE panoramas SET tile_status = 'tiled' WHERE id = :id"),
                {"id": pano_id},
            )
        _publish("tiled")
        logger.info("Tiling complete for %s: %d tiles, %d levels", pano_id, total_tiles, MAX_LEVEL)

    except Exception as exc:
        logger.error("Tiling failed for %s: %s", pano_id, exc)
        with sync_engine.begin() as conn:
            conn.execute(
                text("UPDATE panoramas SET tile_status = 'failed' WHERE id = :id"),
                {"id": pano_id},
            )
        _publish("failed")
        raise self.retry(exc=exc, countdown=60) from exc
