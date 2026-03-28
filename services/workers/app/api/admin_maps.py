import io
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update

from app.api.deps import DB, AdminUser
from app.config import settings
from app.models import Floor, Map, Panorama
from app.storage.minio_client import minio_client

router = APIRouter(tags=["admin-maps"])


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
        await db.execute(
            select(
                Map.id,
                Map.name,
                Map.description,
                Map.x_min,
                Map.x_max,
                Map.y_min,
                Map.y_max,
                Map.coord_type,
                Map.created_at,
                func.count(Floor.id).label("floor_count"),
            )
            .outerjoin(Floor, Floor.map_id == Map.id)
            .group_by(Map.id)
            .order_by(Map.name)
        )
    ).all()
    return [_map_row(r) for r in rows]


@router.post("/maps", status_code=status.HTTP_201_CREATED)
async def create_map(payload: MapCreate, db: DB, _: AdminUser):
    m = Map(**payload.model_dump())
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return _map_obj(m, floor_count=0)


@router.get("/maps/{map_id}")
async def get_map(map_id: str, db: DB, _: AdminUser):
    m = await db.get(Map, map_id)
    if not m:
        raise HTTPException(status_code=404, detail="map not found")

    floors = (
        await db.execute(
            select(
                Floor.id,
                Floor.floor_number,
                Floor.label,
                Floor.image_url,
                func.count(Panorama.id).label("pano_count"),
            )
            .outerjoin(Panorama, Panorama.floor_id == Floor.id)
            .where(Floor.map_id == map_id)
            .group_by(Floor.id)
            .order_by(Floor.floor_number)
        )
    ).all()

    result = _map_obj(m)
    result["floors"] = [_floor_row(f) for f in floors]
    return result


@router.put("/maps/{map_id}")
async def update_map(map_id: str, payload: MapUpdate, db: DB, _: AdminUser):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="no fields to update")
    result = await db.execute(update(Map).where(Map.id == map_id).values(**updates).returning(Map.id))
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="map not found")
    await db.commit()
    return {"ok": True}


@router.delete("/maps/{map_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_map(map_id: str, db: DB, _: AdminUser):
    result = await db.execute(delete(Map).where(Map.id == map_id).returning(Map.id))
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
    m = await db.get(Map, map_id)
    if not m:
        raise HTTPException(status_code=404, detail="map not found")

    content = await image.read()
    ext = _ext(image.filename or "floor.jpg")

    # flush to get f.id before uploading to MinIO
    f = Floor(map_id=map_id, floor_number=floor_number, label=label, image_url="placeholder")
    db.add(f)
    await db.flush()

    minio_key = f"maps/{map_id}/floors/{f.id}/overlay{ext}"
    minio_client.put_object(
        settings.minio_bucket_floors,
        minio_key,
        io.BytesIO(content),
        len(content),
        content_type=image.content_type or "image/jpeg",
    )
    f.image_url = f"/{settings.minio_bucket_floors}/{minio_key}"
    await db.commit()
    await db.refresh(f)
    return _floor_obj(f)


@router.delete("/maps/{map_id}/floors/{floor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_floor(map_id: str, floor_id: str, db: DB, _: AdminUser):
    result = await db.execute(delete(Floor).where(Floor.id == floor_id, Floor.map_id == map_id).returning(Floor.id))
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="floor not found")
    await db.commit()
    _delete_minio_prefix(f"maps/{map_id}/floors/{floor_id}/")


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────


def _map_obj(m: Map, floor_count: int = 0) -> dict:
    return {
        "id": str(m.id),
        "name": m.name,
        "description": m.description or "",
        "x_min": m.x_min,
        "x_max": m.x_max,
        "y_min": m.y_min,
        "y_max": m.y_max,
        "coord_type": m.coord_type,
        "floor_count": floor_count,
        "created_at": str(m.created_at),
    }


def _map_row(r) -> dict:
    return {
        "id": str(r.id),
        "name": r.name,
        "description": r.description or "",
        "x_min": r.x_min,
        "x_max": r.x_max,
        "y_min": r.y_min,
        "y_max": r.y_max,
        "coord_type": r.coord_type,
        "floor_count": r.floor_count or 0,
        "created_at": str(r.created_at),
    }


def _floor_obj(f: Floor, pano_count: int = 0) -> dict:
    return {
        "id": str(f.id),
        "floor_number": f.floor_number,
        "label": f.label or "",
        "image_url": f.image_url,
        "pano_count": pano_count,
    }


def _floor_row(r) -> dict:
    return {
        "id": str(r.id),
        "floor_number": r.floor_number,
        "label": r.label or "",
        "image_url": r.image_url,
        "pano_count": r.pano_count or 0,
    }


def _ext(filename: str) -> str:
    return ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ".jpg"


def _delete_minio_prefix(prefix: str) -> None:
    try:
        objects = minio_client.list_objects(settings.minio_bucket_floors, prefix=prefix, recursive=True)
        for obj in objects:
            minio_client.remove_object(settings.minio_bucket_floors, obj.object_name)
    except Exception:
        pass
