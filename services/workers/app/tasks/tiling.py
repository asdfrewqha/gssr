import logging
import os
import tempfile

import pyvips

from app.config import settings
from app.storage.minio_client import minio_client
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="tile_panorama", bind=True, max_retries=3)
def tile_panorama(self, pano_id: str):
    """Download raw panorama from MinIO, generate DeepZoom tiles, upload back."""
    from sqlalchemy import text

    from app.db.base import sync_engine

    logger.info("Tiling panorama %s", pano_id)

    # Update status to "tiling"
    with sync_engine.begin() as conn:
        conn.execute(
            text("UPDATE panoramas SET tile_status = 'tiling' WHERE id = :id"),
            {"id": pano_id},
        )

    try:
        raw_key = f"raw/{pano_id}.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "panorama.jpg")

            # Download original
            minio_client.fget_object(settings.minio_bucket, raw_key, raw_path)

            # Generate DeepZoom tiles
            out_dir = os.path.join(tmpdir, "tiles")
            img = pyvips.Image.new_from_file(raw_path, access="sequential")
            img.dzsave(
                out_dir,
                layout="google",
                tile_size=256,
                overlap=0,
                suffix=".webp[Q=85]",
                depth="onetile",
            )

            # Upload tile tree to MinIO
            prefix = f"maps/panoramas/{pano_id}"
            for root, _, files in os.walk(out_dir):
                for fname in files:
                    local_path = os.path.join(root, fname)
                    rel = os.path.relpath(local_path, out_dir)
                    minio_key = f"{prefix}/{rel}".replace("\\", "/")
                    minio_client.fput_object(settings.minio_bucket, minio_key, local_path)

        # Mark as tiled
        with sync_engine.begin() as conn:
            conn.execute(
                text("UPDATE panoramas SET tile_status = 'tiled' WHERE id = :id"),
                {"id": pano_id},
            )
        logger.info("Tiling complete for %s", pano_id)

    except Exception as exc:
        logger.error("Tiling failed for %s: %s", pano_id, exc)
        with sync_engine.begin() as conn:
            conn.execute(
                text("UPDATE panoramas SET tile_status = 'failed' WHERE id = :id"),
                {"id": pano_id},
            )
        raise self.retry(exc=exc, countdown=60) from exc
