import logging
import math
import os
import tempfile

import numpy as np
import py360convert
from PIL import Image

from app.config import settings
from app.storage.minio_client import minio_client
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

# Pannellum multires parameters
CUBE_FACE_RESOLUTION = 4096  # pixels per cube face at max level
TILE_RESOLUTION = 512  # pixels per tile
MAX_LEVEL = int(math.log2(CUBE_FACE_RESOLUTION // TILE_RESOLUTION)) + 1  # = 4

# py360convert face key → Pannellum face code
FACE_MAP = {"F": "f", "B": "b", "L": "l", "R": "r", "U": "u", "D": "d"}


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

            # Load equirectangular as numpy array
            e_img = np.array(Image.open(raw_path).convert("RGB"))
            logger.info("Panorama %s: input size %dx%d", pano_id, e_img.shape[1], e_img.shape[0])

            # Convert equirectangular → 6 cube faces at CUBE_FACE_RESOLUTION
            # faces: dict {'F','B','L','R','U','D'} → numpy uint8 (face_w, face_w, 3)
            faces = py360convert.e2c(e_img, face_w=CUBE_FACE_RESOLUTION, cube_format="dict")

            # Remove old tiles before uploading new ones
            try:
                old = minio_client.list_objects(settings.minio_bucket_panoramas, prefix=f"{prefix}/", recursive=True)
                for obj in old:
                    minio_client.remove_object(settings.minio_bucket_panoramas, obj.object_name)
            except Exception as cleanup_exc:
                logger.warning("Old tile cleanup failed for %s: %s", pano_id, cleanup_exc)

            total_tiles = 0
            for py360_key, face_code in FACE_MAP.items():
                face_img = Image.fromarray(faces[py360_key])

                for level in range(1, MAX_LEVEL + 1):
                    level_size = TILE_RESOLUTION * (2 ** (level - 1))
                    resized = face_img.resize((level_size, level_size), Image.LANCZOS)

                    num_tiles = level_size // TILE_RESOLUTION
                    for ty in range(num_tiles):
                        for tx in range(num_tiles):
                            tile = resized.crop(
                                (
                                    tx * TILE_RESOLUTION,
                                    ty * TILE_RESOLUTION,
                                    (tx + 1) * TILE_RESOLUTION,
                                    (ty + 1) * TILE_RESOLUTION,
                                )
                            )
                            tile_path = os.path.join(tmpdir, f"t_{level}_{face_code}_{ty}_{tx}.webp")
                            tile.save(tile_path, "WEBP", quality=85)
                            minio_client.fput_object(
                                settings.minio_bucket_panoramas,
                                f"{prefix}/{level}/{face_code}/{ty}_{tx}.webp",
                                tile_path,
                            )
                            os.unlink(tile_path)
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
