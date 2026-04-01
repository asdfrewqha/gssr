"""SQLAlchemy 2.0 ORM models — mirrors the goose migration schema."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    UUID,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, ENUM
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# ─────────────────────────────────────────────────────────────────────────────
# Enum types (must match PostgreSQL ENUM names exactly)
# ─────────────────────────────────────────────────────────────────────────────

TileStatusEnum = ENUM("pending", "tiling", "tiled", "failed", name="tile_status", create_type=False)
ModerationStatusEnum = ENUM("pending", "clean", "flagged", "rejected", name="moderation_status", create_type=False)
MatchStatusEnum = ENUM("waiting", "active", "finished", name="match_status", create_type=False)
SoloStatusEnum = ENUM("active", "finished", "abandoned", name="solo_status", create_type=False)


# ─────────────────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────────────────


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(72), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    elo: Mapped[int] = mapped_column(Integer, nullable=False, default=1000)
    xp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    banned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    guesses: Mapped[list[Guess]] = relationship("Guess", back_populates="user")
    solo_sessions: Mapped[list[SoloSession]] = relationship("SoloSession", back_populates="user")
    email_tokens: Mapped[list[EmailVerificationToken]] = relationship("EmailVerificationToken", back_populates="user")


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(72), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admins.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Map(Base):
    __tablename__ = "maps"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    x_min: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    x_max: Mapped[float] = mapped_column(Float, nullable=False)
    y_min: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    y_max: Mapped[float] = mapped_column(Float, nullable=False)
    coord_type: Mapped[str] = mapped_column(String(32), nullable=False, default="pixels")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    floors: Mapped[list[Floor]] = relationship("Floor", back_populates="map", cascade="all, delete-orphan")
    solo_sessions: Mapped[list[SoloSession]] = relationship("SoloSession", back_populates="map")


class Floor(Base):
    __tablename__ = "floors"
    __table_args__ = (UniqueConstraint("map_id", "floor_number"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    map_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("maps.id", ondelete="CASCADE"), nullable=False
    )
    floor_number: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str | None] = mapped_column(String(64))
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    map: Mapped[Map] = relationship("Map", back_populates="floors")
    panoramas: Mapped[list[Panorama]] = relationship("Panorama", back_populates="floor", cascade="all, delete-orphan")


class Panorama(Base):
    __tablename__ = "panoramas"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    floor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("floors.id", ondelete="CASCADE"), nullable=False
    )
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    north_offset: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    tile_status: Mapped[str] = mapped_column(TileStatusEnum, nullable=False, default="pending")
    moderation_status: Mapped[str] = mapped_column(ModerationStatusEnum, nullable=False, default="pending")
    nsfw_score: Mapped[float | None] = mapped_column(Float)
    haov: Mapped[float] = mapped_column(Float, nullable=False, server_default="360.0")
    vaov: Mapped[float] = mapped_column(Float, nullable=False, server_default="180.0")
    voffset: Mapped[float] = mapped_column(Float, nullable=False, server_default="0.0")
    source_format: Mapped[str] = mapped_column(String(32), nullable=False, server_default="equirectangular")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    floor: Mapped[Floor] = relationship("Floor", back_populates="panoramas")
    guesses: Mapped[list[Guess]] = relationship("Guess", back_populates="panorama")
    solo_guesses: Mapped[list[SoloGuess]] = relationship("SoloGuess", back_populates="panorama")


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id: Mapped[str] = mapped_column(String(64), nullable=False)
    map_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("maps.id"), nullable=False)
    status: Mapped[str] = mapped_column(MatchStatusEnum, nullable=False, default="waiting")
    max_players: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    rounds: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    time_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    guesses: Mapped[list[Guess]] = relationship("Guess", back_populates="match")


class Guess(Base):
    __tablename__ = "guesses"
    __table_args__ = (UniqueConstraint("match_id", "user_id", "round"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    panorama_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("panoramas.id"), nullable=False)
    round: Mapped[int] = mapped_column(Integer, nullable=False)
    guess_x: Mapped[float | None] = mapped_column(Float)
    guess_y: Mapped[float | None] = mapped_column(Float)
    guess_floor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("floors.id"))
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    distance: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    match: Mapped[Match] = relationship("Match", back_populates="guesses")
    user: Mapped[User] = relationship("User", back_populates="guesses")
    panorama: Mapped[Panorama] = relationship("Panorama", back_populates="guesses")


class SoloSession(Base):
    __tablename__ = "solo_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    map_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("maps.id", ondelete="CASCADE"), nullable=False
    )
    difficulty: Mapped[str] = mapped_column(String(32), nullable=False, default="normal")
    status: Mapped[str] = mapped_column(SoloStatusEnum, nullable=False, default="active")
    rounds: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    pano_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False)
    current_round: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    total_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship("User", back_populates="solo_sessions")
    map: Mapped[Map] = relationship("Map", back_populates="solo_sessions")
    guesses: Mapped[list[SoloGuess]] = relationship("SoloGuess", back_populates="session", cascade="all, delete-orphan")


class SoloGuess(Base):
    __tablename__ = "solo_guesses"
    __table_args__ = (UniqueConstraint("session_id", "round"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("solo_sessions.id", ondelete="CASCADE"), nullable=False
    )
    panorama_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("panoramas.id"), nullable=False)
    round: Mapped[int] = mapped_column(Integer, nullable=False)
    guess_x: Mapped[float | None] = mapped_column(Float)
    guess_y: Mapped[float | None] = mapped_column(Float)
    guess_floor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("floors.id"))
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    distance: Mapped[float | None] = mapped_column(Float)
    time_taken_sec: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    session: Mapped[SoloSession] = relationship("SoloSession", back_populates="guesses")
    panorama: Mapped[Panorama] = relationship("Panorama", back_populates="solo_guesses")


class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    user: Mapped[User] = relationship("User", back_populates="email_tokens")
