"""Internal endpoints called by the Go game service (not exposed to clients)."""

import re

from fastapi import APIRouter
from pydantic import BaseModel

from app.tasks.email import send_verification_email

router = APIRouter(tags=["internal"])

# ─────────────────────────────────────────────────────────────────────────────
# Simple profanity / inappropriate-text filter
# Works with Russian and English; can be extended via wordlist files.
# ─────────────────────────────────────────────────────────────────────────────

# Russian and English profanity / hate-speech root words (normalised lowercase).
# This list is intentionally minimal — extend it as needed.
_BLOCKED_PATTERNS: list[re.Pattern[str]] = [
    # Russian mat roots (covers most declensions via partial match)
    re.compile(r"хуй|хуе|хуя|пизд|ёбан|ебан|еба|нахуй|блядь|бляд|пидар|пидор|мудак|мудил|ёбн|ёб$", re.IGNORECASE),
    # Common English profanity
    re.compile(r"\bf+u+c+k\b|\bshit\b|\bcunt\b|\bnigger\b|\bnigga\b|\bfaggot\b|\bretard\b", re.IGNORECASE),
    # Nationalist / hate symbols
    re.compile(r"\b88\b|heil|nazi|свастик|фашист|расист", re.IGNORECASE),
]


def _is_clean(text: str) -> tuple[bool, str | None]:
    """Return (is_clean, reason). reason is None when clean."""
    for pattern in _BLOCKED_PATTERNS:
        if pattern.search(text):
            return False, "contains inappropriate content"
    return True, None


class _TextCheckRequest(BaseModel):
    text: str


class _TextCheckResponse(BaseModel):
    clean: bool
    reason: str | None = None


@router.post("/internal/check-text", response_model=_TextCheckResponse)
async def check_text(body: _TextCheckRequest) -> _TextCheckResponse:
    """Check a username or display-name for profanity / hate speech."""
    clean, reason = _is_clean(body.text)
    return _TextCheckResponse(clean=clean, reason=reason)


class _SendVerificationEmailRequest(BaseModel):
    user_id: str
    email: str
    token: str


@router.post("/internal/send-verification-email", status_code=202)
async def trigger_verification_email(body: _SendVerificationEmailRequest) -> dict:
    """Enqueue a verification email for a newly registered user."""
    send_verification_email.delay(body.user_id, body.email, body.token)
    return {"queued": True}
