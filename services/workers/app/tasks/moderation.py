import logging
import os
import tempfile

import numpy as np
import onnxruntime as rt
from PIL import Image

from app.config import settings
from app.storage.minio_client import minio_client
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

_session = None


def _get_session():
    global _session
    if _session is None:
        _session = rt.InferenceSession(settings.nsfw_model_path)
    return _session


def _preprocess(img_path: str) -> np.ndarray:
    """Resize to 224×224, normalize to [-1, 1], add batch dim."""
    img = Image.open(img_path).convert("RGB").resize((224, 224))
    arr = np.array(img, dtype=np.float32) / 127.5 - 1.0
    return np.expand_dims(arr, axis=0)


@celery_app.task(name="moderate_panorama", bind=True, max_retries=2)
def moderate_panorama(self, pano_id: str):
    """Run NSFW detection on a panorama's raw image."""
    from sqlalchemy import text

    from app.db.base import sync_engine

    logger.info("Moderating panorama %s", pano_id)

    if not os.path.exists(settings.nsfw_model_path):
        logger.warning("NSFW model not found at %s, skipping moderation for %s", settings.nsfw_model_path, pano_id)
        return

    try:
        raw_key = f"raw/{pano_id}.jpg"
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            tmp_path = f.name

        minio_client.fget_object(settings.minio_bucket_panoramas, raw_key, tmp_path)

        session = _get_session()
        input_name = session.get_inputs()[0].name
        tensor = _preprocess(tmp_path)
        outputs = session.run(None, {input_name: tensor})
        # Expected output: [[drawings, hentai, neutral, porn, sexy]]
        scores = outputs[0][0]
        classes = ["drawings", "hentai", "neutral", "porn", "sexy"]
        result = dict(zip(classes, scores.tolist(), strict=False))
        nsfw_score = result.get("porn", 0) + result.get("hentai", 0)

        os.unlink(tmp_path)

        flagged = nsfw_score > settings.nsfw_threshold
        logger.info("Panorama %s NSFW score=%.3f%s", pano_id, nsfw_score, " [HIGH]" if flagged else "")

        with sync_engine.begin() as conn:
            conn.execute(
                text("UPDATE panoramas SET nsfw_score = :score WHERE id = :id"),
                {"score": float(nsfw_score), "id": pano_id},
            )

    except Exception as exc:
        logger.error("Moderation failed for %s: %s", pano_id, exc)
        raise self.retry(exc=exc, countdown=30) from exc
