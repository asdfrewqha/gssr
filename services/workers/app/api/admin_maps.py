from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["admin-maps"])


class MapCreate(BaseModel):
    name: str
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    coord_type: str | None = "cartesian"


@router.get("/maps")
async def list_maps():
    return []


@router.post("/maps", status_code=201)
async def create_map(payload: MapCreate):
    # TODO: persist to DB
    return {"id": "placeholder", **payload.model_dump()}


@router.post("/maps/{map_id}/floors", status_code=201)
async def add_floor(map_id: str):
    # TODO: receive floor image, upload to MinIO, create Floor record
    return {"map_id": map_id, "floor_id": "placeholder"}
