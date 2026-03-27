"""Shared FastAPI dependencies."""

from typing import Annotated

import jwt
from fastapi import Cookie, Depends, Header, HTTPException, status

from app.config import settings


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.admin_jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as err:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token expired") from err
    except jwt.InvalidTokenError as err:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token") from err


async def admin_required(
    access_token: Annotated[str | None, Cookie()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    """Accept JWT from cookie (access_token) or Authorization: Bearer header."""
    token: str | None = None
    if access_token:
        token = access_token
    elif authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ")

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing token")

    payload = _decode_token(token)
    if not payload.get("is_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin only")
    return payload


AdminUser = Annotated[dict, Depends(admin_required)]
