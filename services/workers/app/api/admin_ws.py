"""WebSocket endpoints for real-time admin events (tiling status + user registrations)."""

import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.deps import AdminUser
from app.config import settings

router = APIRouter(tags=["admin-ws"])
logger = logging.getLogger(__name__)


def _redis() -> aioredis.Redis:
    return aioredis.from_url(settings.valkey_url, decode_responses=True)


@router.websocket("/ws/pano/{pano_id}")
async def ws_pano_status(websocket: WebSocket, pano_id: str, _: AdminUser):
    """Stream tile_status updates for a specific panorama.
    Sends plain strings: 'tiling' | 'tiled' | 'failed'.
    Closes automatically after 'tiled' or 'failed'.
    """
    await websocket.accept()
    r = _redis()
    pubsub = r.pubsub()
    await pubsub.subscribe(f"pano:status:{pano_id}")
    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            status = message["data"]
            await websocket.send_text(status)
            if status in ("tiled", "failed"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(f"pano:status:{pano_id}")
        await r.aclose()


@router.websocket("/ws/users")
async def ws_user_events(websocket: WebSocket, _: AdminUser):
    """Stream new user registration events.
    Sends JSON strings: {"id": "...", "username": "..."}.
    """
    await websocket.accept()
    r = _redis()
    pubsub = r.pubsub()
    await pubsub.subscribe("events:users:new")
    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            await websocket.send_text(message["data"])
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe("events:users:new")
        await r.aclose()
