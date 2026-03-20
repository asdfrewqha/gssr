from fastapi import APIRouter

router = APIRouter(tags=["admin-users"])


@router.get("/users")
async def list_users(page: int = 1, per_page: int = 50):
    # TODO: paginated query from DB
    return {"page": page, "per_page": per_page, "items": []}


@router.put("/users/{user_id}/ban")
async def ban_user(user_id: str):
    # TODO: set banned=true in DB
    return {"id": user_id, "banned": True}


@router.get("/stats")
async def admin_stats():
    # TODO: aggregate counts from DB
    return {"maps": 0, "panoramas": 0, "players": 0, "matches": 0}
