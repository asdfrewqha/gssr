from fastapi import APIRouter

router = APIRouter(tags=["admin-panoramas"])


@router.get("/panoramas/pending")
async def list_pending():
    # TODO: query DB for panoramas with moderation_status='pending'
    return []


@router.post("/panoramas", status_code=201)
async def upload_panorama():
    # TODO: receive equirectangular image, store raw, dispatch tiling + moderation tasks
    return {"id": "placeholder", "status": "queued"}


@router.post("/panoramas/{pano_id}/approve")
async def approve_panorama(pano_id: str):
    # TODO: set moderation_status='published'
    return {"id": pano_id, "status": "published"}


@router.post("/panoramas/{pano_id}/reject")
async def reject_panorama(pano_id: str):
    # TODO: set moderation_status='rejected', delete tiles from MinIO
    return {"id": pano_id, "status": "rejected"}
