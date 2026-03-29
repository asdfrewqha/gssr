from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, func, or_, select, update

from app.api.deps import DB, AdminUser
from app.models import Guess, User

router = APIRouter(tags=["admin-users"])


@router.get("/users")
async def list_users(
    db: DB,
    _: AdminUser,
    page: int = 1,
    per_page: int = 50,
    search: str | None = None,
    user_status: str | None = None,  # "active" | "banned" | "unverified"
):
    q = select(User)
    count_q = select(func.count(User.id))

    if search:
        like = f"%{search}%"
        q = q.where(or_(User.username.ilike(like), User.email.ilike(like)))
        count_q = count_q.where(or_(User.username.ilike(like), User.email.ilike(like)))

    if user_status == "banned":
        q = q.where(User.banned.is_(True))
        count_q = count_q.where(User.banned.is_(True))
    elif user_status == "unverified":
        q = q.where(User.email_verified.is_(False))
        count_q = count_q.where(User.email_verified.is_(False))
    elif user_status == "active":
        q = q.where(User.banned.is_(False), User.email_verified.is_(True))
        count_q = count_q.where(User.banned.is_(False), User.email_verified.is_(True))

    total = (await db.execute(count_q)).scalar()
    users = (
        (await db.execute(q.order_by(User.created_at.desc()).limit(per_page).offset((page - 1) * per_page)))
        .scalars()
        .all()
    )
    return {"page": page, "per_page": per_page, "total": total, "items": [_user_out(u) for u in users]}


@router.get("/users/pending-review")
async def pending_review(db: DB, _: AdminUser):
    """Users registered but not yet email-verified."""
    users = (
        (
            await db.execute(
                select(User)
                .where(User.email_verified.is_(False), User.banned.is_(False))
                .order_by(User.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_user_out(u) for u in users]


@router.get("/users/{user_id}")
async def get_user(user_id: str, db: DB, _: AdminUser):
    u = await db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="user not found")

    match_count = (
        await db.execute(select(func.count(Guess.match_id.distinct())).where(Guess.user_id == user_id))
    ).scalar()
    total_score = (
        await db.execute(select(func.coalesce(func.sum(Guess.score), 0)).where(Guess.user_id == user_id))
    ).scalar()

    return {**_user_out(u), "match_count": match_count, "total_score": total_score}


@router.put("/users/{user_id}/ban")
async def ban_user(user_id: str, db: DB, _: AdminUser):
    result = await db.execute(update(User).where(User.id == user_id).values(banned=True).returning(User.id))
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="user not found")
    await db.commit()
    return {"id": user_id, "banned": True}


@router.put("/users/{user_id}/unban")
async def unban_user(user_id: str, db: DB, _: AdminUser):
    result = await db.execute(update(User).where(User.id == user_id).values(banned=False).returning(User.id))
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="user not found")
    await db.commit()
    return {"id": user_id, "banned": False}


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: str, db: DB, _: AdminUser):
    result = await db.execute(delete(User).where(User.id == user_id).returning(User.id))
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="user not found")
    await db.commit()


@router.get("/stats")
async def admin_stats(db: DB, _: AdminUser):
    from app.models import Floor, Map, Match, Panorama

    maps = (await db.execute(select(func.count(Map.id)))).scalar()
    floors = (await db.execute(select(func.count(Floor.id)))).scalar()
    panoramas = (await db.execute(select(func.count(Panorama.id)))).scalar()
    panoramas_ready = (
        await db.execute(
            select(func.count(Panorama.id)).where(
                Panorama.tile_status == "tiled", Panorama.moderation_status == "clean"
            )
        )
    ).scalar()
    panoramas_pending = (
        await db.execute(select(func.count(Panorama.id)).where(Panorama.moderation_status.in_(["pending", "flagged"])))
    ).scalar()
    players = (await db.execute(select(func.count(User.id)))).scalar()
    matches = (await db.execute(select(func.count(Match.id)))).scalar()
    matches_active = (await db.execute(select(func.count(Match.id)).where(Match.status == "active"))).scalar()

    return {
        "maps": maps,
        "floors": floors,
        "panoramas": {"total": panoramas, "ready": panoramas_ready, "pending_review": panoramas_pending},
        "players": players,
        "matches": {"total": matches, "active": matches_active},
    }


def _user_out(u: User) -> dict:
    return {
        "id": str(u.id),
        "username": u.username,
        "email": u.email,
        "email_verified": u.email_verified,
        "elo": u.elo,
        "xp": u.xp,
        "banned": u.banned,
        "created_at": str(u.created_at),
    }
