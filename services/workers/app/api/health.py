from fastapi import APIRouter

from app.config import settings
from app.db.base import engine
from app.storage.minio_client import minio_client

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    db_ok = True
    storage_ok = True

    try:
        async with engine.connect() as conn:
            await conn.execute("SELECT 1")
    except Exception:
        db_ok = False

    try:
        minio_client.bucket_exists(settings.minio_bucket)
    except Exception:
        storage_ok = False

    return {
        "status": "ok" if db_ok and storage_ok else "degraded",
        "db": "ok" if db_ok else "error",
        "storage": "ok" if storage_ok else "error",
    }
