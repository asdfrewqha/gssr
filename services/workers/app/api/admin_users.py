from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AdminUser
from app.db.base import get_db

router = APIRouter(tags=["admin-users"])

DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("/users")
async def list_users(db: DB, _: AdminUser, page: int = 1, per_page: int = 50):
    offset = (page - 1) * per_page
    rows = (
        (
            await db.execute(
                text("""
            SELECT id, username, elo, banned, is_admin, created_at
            FROM users
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """),
                {"limit": per_page, "offset": offset},
            )
        )
        .mappings()
        .all()
    )
    total = (await db.execute(text("SELECT COUNT(*) FROM users"))).scalar()
    return {"page": page, "per_page": per_page, "total": total, "items": [_user_row(r) for r in rows]}


@router.get("/users/{user_id}")
async def get_user(user_id: str, db: DB, _: AdminUser):
    row = (
        (
            await db.execute(
                text("""
            SELECT u.id, u.username, u.elo, u.banned, u.is_admin, u.created_at,
                   COUNT(DISTINCT g.match_id) AS match_count,
                   COALESCE(SUM(g.score), 0) AS total_score
            FROM users u
            LEFT JOIN guesses g ON g.user_id = u.id
            WHERE u.id = :id
            GROUP BY u.id
        """),
                {"id": user_id},
            )
        )
        .mappings()
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="user not found")
    return {**_user_row(row), "match_count": row["match_count"], "total_score": row["total_score"]}


@router.put("/users/{user_id}/ban")
async def ban_user(user_id: str, db: DB, _: AdminUser):
    result = await db.execute(text("UPDATE users SET banned = TRUE WHERE id = :id RETURNING id"), {"id": user_id})
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="user not found")
    await db.commit()
    return {"id": user_id, "banned": True}


@router.put("/users/{user_id}/unban")
async def unban_user(user_id: str, db: DB, _: AdminUser):
    result = await db.execute(text("UPDATE users SET banned = FALSE WHERE id = :id RETURNING id"), {"id": user_id})
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="user not found")
    await db.commit()
    return {"id": user_id, "banned": False}


@router.get("/stats")
async def admin_stats(db: DB, _: AdminUser):
    maps = (await db.execute(text("SELECT COUNT(*) FROM maps"))).scalar()
    floors = (await db.execute(text("SELECT COUNT(*) FROM floors"))).scalar()
    panoramas = (await db.execute(text("SELECT COUNT(*) FROM panoramas"))).scalar()
    panoramas_ready = (
        await db.execute(text("SELECT COUNT(*) FROM panoramas WHERE tile_status='tiled' AND moderation_status='clean'"))
    ).scalar()
    panoramas_pending = (
        await db.execute(text("SELECT COUNT(*) FROM panoramas WHERE moderation_status IN ('pending','flagged')"))
    ).scalar()
    players = (await db.execute(text("SELECT COUNT(*) FROM users"))).scalar()
    matches = (await db.execute(text("SELECT COUNT(*) FROM matches"))).scalar()
    matches_active = (await db.execute(text("SELECT COUNT(*) FROM matches WHERE status='active'"))).scalar()

    return {
        "maps": maps,
        "floors": floors,
        "panoramas": {"total": panoramas, "ready": panoramas_ready, "pending_review": panoramas_pending},
        "players": players,
        "matches": {"total": matches, "active": matches_active},
    }


def _user_row(r) -> dict:
    return {
        "id": str(r["id"]),
        "username": r["username"],
        "elo": r["elo"],
        "banned": r["banned"],
        "is_admin": r["is_admin"],
        "created_at": str(r["created_at"]),
    }
