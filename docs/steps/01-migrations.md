# Step 1: Database Schema (Migrations)

## Goal

Create the PostgreSQL schema for all game entities using goose SQL migrations.

## Prerequisites

- Docker installed on Main PC
- `docs/steps/02-infra-local.md` not required yet — you can run migrations against a temporary Postgres container

## Steps

### 1. Install goose

```bash
go install github.com/pressly/goose/v3/cmd/goose@latest
# or use Docker:
alias goose='docker run --rm --network host ghcr.io/pressly/goose:latest'
```

### 2. Set DATABASE_URL

```bash
export DATABASE_URL="postgres://gssr:gssr@localhost:5432/gssr?sslmode=disable"
```

### 3. Run migrations

```bash
goose -dir migrations postgres "$DATABASE_URL" up
```

### 4. Check status

```bash
goose -dir migrations postgres "$DATABASE_URL" status
```

## Schema Overview

| Table | Key columns |
| --- | --- |
| users | id, username, password_hash, avatar_url, elo, banned, created_at |
| maps | id, name, x_min, x_max, y_min, y_max, coord_type |
| floors | id, map_id, floor_number, image_url |
| panoramas | id, floor_id, x, y, north_offset, tile_status, moderation_status |
| matches | id, room_id, map_id, started_at, ended_at |
| guesses | id, match_id, user_id, panorama_id, guess_x, guess_y, guess_floor_id, score |

## Verification

```bash
psql "$DATABASE_URL" -c "\dt"
# Should list: users, maps, floors, panoramas, matches, guesses
```

## Troubleshooting

- **"dial tcp: connection refused"** — Postgres not running. Start it: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=gssr -e POSTGRES_USER=gssr -e POSTGRES_DB=gssr postgres:16-alpine`
- **"already applied"** — migrations already ran. Use `goose status` to check.
- **Rollback one step**: `goose -dir migrations postgres "$DATABASE_URL" down`
