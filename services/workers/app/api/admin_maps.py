import io
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AdminUser
from app.config import settings
from app.db.base import get_db
from app.storage.minio_client import minio_client

router = APIRouter(tags=["admin-maps"])

DB = Annotated[AsyncSession, Depends(get_db)]


# ──────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────


class MapCreate(BaseModel):
    name: str
    description: str | None = None
    x_min: float = 0.0
    x_max: float
    y_min: float = 0.0
    y_max: float
    coord_type: str = "pixels"


class MapUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    x_min: float | None = None
    x_max: float | None = None
    y_min: float | None = None
    y_max: float | None = None
    coord_type: str | None = None


# ──────────────────────────────────────────────
# Maps
# ──────────────────────────────────────────────


@router.get("/maps")
async def list_maps(db: DB, _: AdminUser):
    rows = (
        (
            await db.execute(
                text("""
        SELECT m.id, m.name, COALESCE(m.description,'') AS description,
               m.x_min, m.x_max, m.y_min, m.y_max, m.coord_type,
               COUNT(f.id) AS floor_count,
               m.created_at
        FROM maps m
        LEFT JOIN floors f ON f.map_id = m.id
        GROUP BY m.id
        ORDER BY m.name
    """)
            )
        )
        .mappings()
        .all()
    )
    return [_map_row(r) for r in rows]


@router.post("/maps", status_code=status.HTTP_201_CREATED)
async def create_map(payload: MapCreate, db: DB, _: AdminUser):
    row = (
        (
            await db.execute(
                text("""
            INSERT INTO maps (name, description, x_min, x_max, y_min, y_max, coord_type)
            VALUES (:name, :description, :x_min, :x_max, :y_min, :y_max, :coord_type)
            RETURNING id, name, COALESCE(description,'') AS description,
                      x_min, x_max, y_min, y_max, coord_type, created_at
        """),
                payload.model_dump(),
            )
        )
        .mappings()
        .one()
    )
    await db.commit()
    return _map_row(row)


@router.get("/maps/{map_id}")
async def get_map(map_id: str, db: DB, _: AdminUser):
    row = (
        (
            await db.execute(
                text("""
            SELECT id, name, COALESCE(description,'') AS description,
                   x_min, x_max, y_min, y_max, coord_type, created_at
            FROM maps WHERE id = :id
        """),
                {"id": map_id},
            )
        )
        .mappings()
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="map not found")

    floors = (
        (
            await db.execute(
                text("""
            SELECT f.id, f.floor_number, COALESCE(f.label,'') AS label, f.image_url,
                   COUNT(p.id) AS pano_count
            FROM floors f
            LEFT JOIN panoramas p ON p.floor_id = f.id
            WHERE f.map_id = :map_id
            GROUP BY f.id, f.floor_number, f.label, f.image_url
            ORDER BY f.floor_number
        """),
                {"map_id": map_id},
            )
        )
        .mappings()
        .all()
    )

    result = _map_row(row)
    result["floors"] = [_floor_row(f) for f in floors]
    return result


@router.put("/maps/{map_id}")
async def update_map(map_id: str, payload: MapUpdate, db: DB, _: AdminUser):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="no fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["id"] = map_id
    result = await db.execute(
        text(f"UPDATE maps SET {set_clause} WHERE id = :id RETURNING id"),
        updates,
    )
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="map not found")
    await db.commit()
    return {"ok": True}


@router.delete("/maps/{map_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_map(map_id: str, db: DB, _: AdminUser):
    result = await db.execute(text("DELETE FROM maps WHERE id = :id RETURNING id"), {"id": map_id})
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="map not found")
    await db.commit()
    _delete_minio_prefix(f"maps/{map_id}/")


# ──────────────────────────────────────────────
# Floors
# ──────────────────────────────────────────────


@router.post("/maps/{map_id}/floors", status_code=status.HTTP_201_CREATED)
async def add_floor(
    map_id: str,
    floor_number: Annotated[int, Form()],
    image: Annotated[UploadFile, File()],
    db: DB,
    _: AdminUser,
    label: Annotated[str | None, Form()] = None,
):
    row = (await db.execute(text("SELECT id FROM maps WHERE id = :id"), {"id": map_id})).one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="map not found")

    floor_id = str(uuid.uuid4())
    content = await image.read()
    ext = _ext(image.filename or "floor.jpg")
    minio_key = f"maps/{map_id}/floors/{floor_id}/overlay{ext}"

    minio_client.put_object(
        settings.minio_bucket,
        minio_key,
        io.BytesIO(content),
        len(content),
        content_type=image.content_type or "image/jpeg",
    )

    image_url = f"/{settings.minio_bucket}/{minio_key}"

    floor = (
        (
            await db.execute(
                text("""
            INSERT INTO floors (id, map_id, floor_number, label, image_url)
            VALUES (:id, :map_id, :floor_number, :label, :image_url)
            RETURNING id, floor_number, COALESCE(label,'') AS label, image_url
        """),
                {
                    "id": floor_id,
                    "map_id": map_id,
                    "floor_number": floor_number,
                    "label": label,
                    "image_url": image_url,
                },
            )
        )
        .mappings()
        .one()
    )
    await db.commit()
    return _floor_row(floor)


@router.delete("/maps/{map_id}/floors/{floor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_floor(map_id: str, floor_id: str, db: DB, _: AdminUser):
    result = await db.execute(
        text("DELETE FROM floors WHERE id = :id AND map_id = :map_id RETURNING id"),
        {"id": floor_id, "map_id": map_id},
    )
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="floor not found")
    await db.commit()
    _delete_minio_prefix(f"maps/{map_id}/floors/{floor_id}/")


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────


def _map_row(r) -> dict:
    return {
        "id": str(r["id"]),
        "name": r["name"],
        "description": r["description"],
        "x_min": r["x_min"],
        "x_max": r["x_max"],
        "y_min": r["y_min"],
        "y_max": r["y_max"],
        "coord_type": r["coord_type"],
        "floor_count": r.get("floor_count", 0),
        "created_at": str(r["created_at"]),
    }


def _floor_row(r) -> dict:
    return {
        "id": str(r["id"]),
        "floor_number": r["floor_number"],
        "label": r["label"],
        "image_url": r["image_url"],
        "pano_count": r.get("pano_count", 0),
    }


def _ext(filename: str) -> str:
    return ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ".jpg"


def _delete_minio_prefix(prefix: str) -> None:
    """Best-effort delete of all MinIO objects under a prefix."""
    try:
        objects = minio_client.list_objects(settings.minio_bucket, prefix=prefix, recursive=True)
        for obj in objects:
            minio_client.remove_object(settings.minio_bucket, obj.object_name)
    except Exception:
        pass
