import contextlib
import io
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AdminUser
from app.config import settings
from app.db.base import get_db
from app.storage.minio_client import minio_client

router = APIRouter(tags=["admin-panoramas"])

DB = Annotated[AsyncSession, Depends(get_db)]


# ──────────────────────────────────────────────
# Upload
# ──────────────────────────────────────────────


@router.post("/panoramas", status_code=status.HTTP_201_CREATED)
async def upload_panorama(
    floor_id: Annotated[str, Form()],
    x: Annotated[float, Form()],
    y: Annotated[float, Form()],
    image: Annotated[UploadFile, File()],
    db: DB,
    _: AdminUser,
    north_offset: Annotated[float, Form()] = 0.0,
):
    """Upload equirectangular panorama → MinIO raw/ → dispatch tiling + moderation."""
    row = (await db.execute(text("SELECT id FROM floors WHERE id = :id"), {"id": floor_id})).one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="floor not found")

    pano_id = str(uuid.uuid4())
    content = await image.read()

    minio_client.put_object(
        settings.minio_bucket,
        f"raw/{pano_id}.jpg",
        io.BytesIO(content),
        len(content),
        content_type="image/jpeg",
    )

    await db.execute(
        text("""
            INSERT INTO panoramas (id, floor_id, x, y, north_offset,
                                   tile_status, moderation_status)
            VALUES (:id, :floor_id, :x, :y, :north_offset, 'pending', 'pending')
        """),
        {"id": pano_id, "floor_id": floor_id, "x": x, "y": y, "north_offset": north_offset},
    )
    await db.commit()

    # Lazy import to avoid Celery bootstrap at module import time
    from app.tasks.moderation import moderate_panorama
    from app.tasks.tiling import tile_panorama

    tile_panorama.delay(pano_id)
    moderate_panorama.delay(pano_id)

    return {"id": pano_id, "tile_status": "pending", "moderation_status": "pending"}


# ──────────────────────────────────────────────
# Listing
# ──────────────────────────────────────────────


@router.get("/panoramas/pending")
async def list_pending(db: DB, _: AdminUser):
    """Panoramas awaiting moderation review (pending or flagged)."""
    rows = (
        (
            await db.execute(
                text("""
        SELECT p.id, p.floor_id, p.x, p.y, p.north_offset,
               p.tile_status, p.moderation_status, p.nsfw_score, p.created_at,
               f.floor_number, m.id AS map_id, m.name AS map_name
        FROM panoramas p
        JOIN floors f ON f.id = p.floor_id
        JOIN maps m ON m.id = f.map_id
        WHERE p.moderation_status IN ('pending', 'flagged')
        ORDER BY p.nsfw_score DESC NULLS LAST, p.created_at ASC
    """)
            )
        )
        .mappings()
        .all()
    )
    return [_pano_row(r) for r in rows]


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
    where_clauses: list[str] = []
    params: dict = {"limit": per_page, "offset": (page - 1) * per_page}

    if floor_id:
        where_clauses.append("p.floor_id = :floor_id")
        params["floor_id"] = floor_id
    if tile_status:
        where_clauses.append("p.tile_status = :tile_status")
        params["tile_status"] = tile_status
    if moderation_status:
        where_clauses.append("p.moderation_status = :moderation_status")
        params["moderation_status"] = moderation_status

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    rows = (
        (
            await db.execute(
                text(f"""
            SELECT p.id, p.floor_id, p.x, p.y, p.north_offset,
                   p.tile_status, p.moderation_status, p.nsfw_score, p.created_at,
                   f.floor_number, m.id AS map_id, m.name AS map_name
            FROM panoramas p
            JOIN floors f ON f.id = p.floor_id
            JOIN maps m ON m.id = f.map_id
            {where_sql}
            ORDER BY p.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
                params,
            )
        )
        .mappings()
        .all()
    )
    return [_pano_row(r) for r in rows]


@router.get("/panoramas/{pano_id}")
async def get_panorama(pano_id: str, db: DB, _: AdminUser):
    row = (
        (
            await db.execute(
                text("""
            SELECT p.id, p.floor_id, p.x, p.y, p.north_offset,
                   p.tile_status, p.moderation_status, p.nsfw_score, p.created_at,
                   f.floor_number, m.id AS map_id, m.name AS map_name
            FROM panoramas p
            JOIN floors f ON f.id = p.floor_id
            JOIN maps m ON m.id = f.map_id
            WHERE p.id = :id
        """),
                {"id": pano_id},
            )
        )
        .mappings()
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="panorama not found")
    return _pano_row(row)


# ──────────────────────────────────────────────
# Moderation
# ──────────────────────────────────────────────


@router.post("/panoramas/{pano_id}/approve")
async def approve_panorama(pano_id: str, db: DB, _: AdminUser):
    result = await db.execute(
        text("""
            UPDATE panoramas SET moderation_status = 'clean'
            WHERE id = :id AND moderation_status != 'rejected'
            RETURNING id
        """),
        {"id": pano_id},
    )
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="panorama not found or already rejected")
    await db.commit()
    return {"id": pano_id, "moderation_status": "clean"}


@router.post("/panoramas/{pano_id}/reject")
async def reject_panorama(pano_id: str, db: DB, _: AdminUser):
    result = await db.execute(
        text("UPDATE panoramas SET moderation_status = 'rejected' WHERE id = :id RETURNING id"),
        {"id": pano_id},
    )
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="panorama not found")
    await db.commit()
    _delete_minio_prefix(f"maps/panoramas/{pano_id}/")
    with contextlib.suppress(Exception):
        minio_client.remove_object(settings.minio_bucket, f"raw/{pano_id}.jpg")
    return {"id": pano_id, "moderation_status": "rejected"}


@router.post("/panoramas/{pano_id}/retile")
async def retile_panorama(pano_id: str, db: DB, _: AdminUser):
    """Re-dispatch tiling task for a failed panorama."""
    row = (await db.execute(text("SELECT id FROM panoramas WHERE id = :id"), {"id": pano_id})).one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="panorama not found")

    await db.execute(text("UPDATE panoramas SET tile_status = 'pending' WHERE id = :id"), {"id": pano_id})
    await db.commit()

    from app.tasks.tiling import tile_panorama

    tile_panorama.delay(pano_id)
    return {"id": pano_id, "tile_status": "pending"}


@router.delete("/panoramas/{pano_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_panorama(pano_id: str, db: DB, _: AdminUser):
    result = await db.execute(text("DELETE FROM panoramas WHERE id = :id RETURNING id"), {"id": pano_id})
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="panorama not found")
    await db.commit()
    _delete_minio_prefix(f"maps/panoramas/{pano_id}/")
    with contextlib.suppress(Exception):
        minio_client.remove_object(settings.minio_bucket, f"raw/{pano_id}.jpg")


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────


def _pano_row(r) -> dict:
    return {
        "id": str(r["id"]),
        "floor_id": str(r["floor_id"]),
        "floor_number": r["floor_number"],
        "map_id": str(r["map_id"]),
        "map_name": r["map_name"],
        "x": r["x"],
        "y": r["y"],
        "north_offset": r["north_offset"],
        "tile_status": r["tile_status"],
        "moderation_status": r["moderation_status"],
        "nsfw_score": r["nsfw_score"],
        "created_at": str(r["created_at"]),
    }


def _delete_minio_prefix(prefix: str) -> None:
    try:
        objects = minio_client.list_objects(settings.minio_bucket, prefix=prefix, recursive=True)
        for obj in objects:
            minio_client.remove_object(settings.minio_bucket, obj.object_name)
    except Exception:
        pass
