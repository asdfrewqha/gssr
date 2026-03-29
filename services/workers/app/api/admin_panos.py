import contextlib
import uuid
from datetime import timedelta
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select, update

from app.api.deps import DB, AdminUser
from app.config import settings
from app.models import Floor, Map, Panorama
from app.storage.minio_client import minio_client

router = APIRouter(tags=["admin-panoramas"])


# ──────────────────────────────────────────────
# Upload — two-step presigned flow
# ──────────────────────────────────────────────


@router.get("/panoramas/upload-url", status_code=status.HTTP_201_CREATED)
async def get_upload_url(
    floor_id: str,
    x: float,
    y: float,
    db: DB,
    _: AdminUser,
    north_offset: float = 0.0,
):
    """Step 1: create panorama record + return presigned PUT URL for direct browser→MinIO upload."""
    f = await db.get(Floor, floor_id)
    if not f:
        raise HTTPException(status_code=404, detail="floor not found")

    pano_id = str(uuid.uuid4())

    presigned = minio_client.presigned_put_object(
        settings.minio_bucket_panoramas,
        f"raw/{pano_id}.jpg",
        expires=timedelta(hours=1),
    )

    # Replace internal Docker endpoint with public-facing MinIO URL
    parsed = urlparse(presigned)
    pub = urlparse(settings.minio_public_url)
    upload_url = urlunparse(parsed._replace(scheme=pub.scheme, netloc=pub.netloc))

    p = Panorama(
        id=pano_id,
        floor_id=floor_id,
        x=x,
        y=y,
        north_offset=north_offset,
        moderation_status="clean",
    )
    db.add(p)
    await db.commit()

    return {"pano_id": pano_id, "upload_url": upload_url}


class _ConfirmUpload(BaseModel):
    pano_id: str


@router.post("/panoramas/confirm-upload", status_code=status.HTTP_202_ACCEPTED)
async def confirm_upload(body: _ConfirmUpload, db: DB, _: AdminUser):
    """Step 2: called after browser PUT succeeds — dispatches tiling + NSFW score tasks."""
    p = await db.get(Panorama, body.pano_id)
    if not p:
        raise HTTPException(status_code=404, detail="panorama not found")

    from app.tasks.moderation import moderate_panorama
    from app.tasks.tiling import tile_panorama

    tile_panorama.delay(body.pano_id)
    moderate_panorama.delay(body.pano_id)

    return {"pano_id": body.pano_id, "tile_status": "pending"}


# ──────────────────────────────────────────────
# Listing
# ──────────────────────────────────────────────


@router.get("/panoramas/pending")
async def list_pending(db: DB, _: AdminUser):
    """Panoramas awaiting moderation review."""
    rows = (
        await db.execute(
            select(Panorama, Floor.floor_number, Map.id.label("map_id"), Map.name.label("map_name"))
            .join(Floor, Floor.id == Panorama.floor_id)
            .join(Map, Map.id == Floor.map_id)
            .where(Panorama.moderation_status.in_(["pending", "flagged"]))
            .order_by(Panorama.nsfw_score.desc().nulls_last(), Panorama.created_at.asc())
        )
    ).all()
    return [_pano_row(p, floor_number, map_id, map_name) for p, floor_number, map_id, map_name in rows]


@router.get("/panoramas")
async def list_panoramas(
    db: DB,
    _: AdminUser,
    floor_id: str | None = None,
    tile_status: str | None = None,
    moderation_status: str | None = None,
    page: int = 1,
    per_page: int = 50,
):
    q = (
        select(Panorama, Floor.floor_number, Map.id.label("map_id"), Map.name.label("map_name"))
        .join(Floor, Floor.id == Panorama.floor_id)
        .join(Map, Map.id == Floor.map_id)
    )
    if floor_id:
        q = q.where(Panorama.floor_id == floor_id)
    if tile_status:
        q = q.where(Panorama.tile_status == tile_status)
    if moderation_status:
        q = q.where(Panorama.moderation_status == moderation_status)

    rows = (
        await db.execute(q.order_by(Panorama.created_at.desc()).limit(per_page).offset((page - 1) * per_page))
    ).all()
    return [_pano_row(p, floor_number, map_id, map_name) for p, floor_number, map_id, map_name in rows]


@router.get("/panoramas/{pano_id}")
async def get_panorama(pano_id: str, db: DB, _: AdminUser):
    row = (
        await db.execute(
            select(Panorama, Floor.floor_number, Map.id.label("map_id"), Map.name.label("map_name"))
            .join(Floor, Floor.id == Panorama.floor_id)
            .join(Map, Map.id == Floor.map_id)
            .where(Panorama.id == pano_id)
        )
    ).one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="panorama not found")
    p, floor_number, map_id, map_name = row
    return _pano_row(p, floor_number, map_id, map_name)


# ──────────────────────────────────────────────
# Moderation
# ──────────────────────────────────────────────


@router.post("/panoramas/{pano_id}/approve")
async def approve_panorama(pano_id: str, db: DB, _: AdminUser):
    result = await db.execute(
        update(Panorama)
        .where(Panorama.id == pano_id, Panorama.moderation_status != "rejected")
        .values(moderation_status="clean")
        .returning(Panorama.id)
    )
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="panorama not found or already rejected")
    await db.commit()
    return {"id": pano_id, "moderation_status": "clean"}


@router.post("/panoramas/{pano_id}/reject")
async def reject_panorama(pano_id: str, db: DB, _: AdminUser):
    result = await db.execute(
        update(Panorama).where(Panorama.id == pano_id).values(moderation_status="rejected").returning(Panorama.id)
    )
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="panorama not found")
    await db.commit()
    _delete_minio_prefix(f"maps/panoramas/{pano_id}/")
    with contextlib.suppress(Exception):
        minio_client.remove_object(settings.minio_bucket_panoramas, f"raw/{pano_id}.jpg")
    return {"id": pano_id, "moderation_status": "rejected"}


@router.post("/panoramas/{pano_id}/retile")
async def retile_panorama(pano_id: str, db: DB, _: AdminUser):
    result = await db.execute(
        update(Panorama).where(Panorama.id == pano_id).values(tile_status="pending").returning(Panorama.id)
    )
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="panorama not found")
    await db.commit()

    from app.tasks.tiling import tile_panorama

    tile_panorama.delay(pano_id)
    return {"id": pano_id, "tile_status": "pending"}


@router.delete("/panoramas/{pano_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_panorama(pano_id: str, db: DB, _: AdminUser):
    result = await db.execute(delete(Panorama).where(Panorama.id == pano_id).returning(Panorama.id))
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="panorama not found")
    await db.commit()
    _delete_minio_prefix(f"maps/panoramas/{pano_id}/")
    with contextlib.suppress(Exception):
        minio_client.remove_object(settings.minio_bucket_panoramas, f"raw/{pano_id}.jpg")


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────


def _pano_row(p: Panorama, floor_number: int, map_id, map_name: str) -> dict:
    return {
        "id": str(p.id),
        "floor_id": str(p.floor_id),
        "floor_number": floor_number,
        "map_id": str(map_id),
        "map_name": map_name,
        "x": p.x,
        "y": p.y,
        "north_offset": p.north_offset,
        "tile_status": p.tile_status,
        "moderation_status": p.moderation_status,
        "nsfw_score": p.nsfw_score,
        "created_at": str(p.created_at),
    }


def _delete_minio_prefix(prefix: str) -> None:
    try:
        objects = minio_client.list_objects(settings.minio_bucket_panoramas, prefix=prefix, recursive=True)
        for obj in objects:
            minio_client.remove_object(settings.minio_bucket_panoramas, obj.object_name)
    except Exception:
        pass
