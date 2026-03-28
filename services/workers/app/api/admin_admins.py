"""Admin management endpoints — create/list/delete admin accounts."""

import bcrypt
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, select

from app.api.deps import DB, AdminUser
from app.models import Admin

router = APIRouter(tags=["admin-admins"])


class AdminCreate(BaseModel):
    username: str
    password: str
    email: str | None = None

    @field_validator("username")
    @classmethod
    def username_length(cls, v: str) -> str:
        if not 3 <= len(v) <= 32:
            raise ValueError("username must be 3–32 characters")
        return v

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        return v


@router.get("/admins")
async def list_admins(db: DB, _: AdminUser):
    admins = (await db.execute(select(Admin).order_by(Admin.created_at))).scalars().all()
    return [_admin_out(a) for a in admins]


@router.post("/admins", status_code=status.HTTP_201_CREATED)
async def create_admin(payload: AdminCreate, db: DB, current: AdminUser):
    # Check username uniqueness
    existing = (await db.execute(select(Admin).where(Admin.username == payload.username))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="username already taken")

    pw_hash = bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode()
    a = Admin(
        username=payload.username,
        password_hash=pw_hash,
        email=payload.email,
        created_by=current.get("uid"),  # uid = creator's admin UUID in Go JWT
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return _admin_out(a)


@router.delete("/admins/{admin_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_admin(admin_id: str, db: DB, current: AdminUser):
    if str(current.get("uid", "")) == admin_id:
        raise HTTPException(status_code=400, detail="cannot delete yourself")
    result = await db.execute(delete(Admin).where(Admin.id == admin_id).returning(Admin.id))
    if not result.one_or_none():
        raise HTTPException(status_code=404, detail="admin not found")
    await db.commit()


def _admin_out(a: Admin) -> dict:
    return {
        "id": str(a.id),
        "username": a.username,
        "email": a.email,
        "created_by": str(a.created_by) if a.created_by else None,
        "created_at": str(a.created_at),
    }
