# Step 3: Game Engine Service (Go Fiber)

## Goal

Build and run the Go Fiber game engine service that handles auth, game rooms, WebSocket multiplayer, and scoring. Runs on Zynq ARM nodes (and locally on x86 for dev).

## Prerequisites

- Go 1.22+ installed
- Step 1 (DB schema) and Step 2 (infra) completed
- Valkey and Postgres accessible

## Steps

### 1. Initialize Go module

```bash
cd services/game
go mod init github.com/yourorg/gssr-game
go mod tidy
```

### 2. Set environment variables

```bash
export POSTGRES_URL="postgres://gssr:password@localhost:5432/gssr"
export VALKEY_URL="redis://localhost:6379"
export JWT_SECRET="your-64-char-secret"
export JWT_ACCESS_TTL="15m"
export JWT_REFRESH_TTL="168h"
export LIVEKIT_URL="ws://localhost:7880"
export LIVEKIT_API_KEY="your-key"
export LIVEKIT_API_SECRET="your-secret"
export PORT="3000"
```

### 3. Run locally

```bash
go run ./cmd/server
```

### 4. Build for Zynq ARM

```bash
make build-arm
# Produces: dist/game-server-arm (static binary, ~15MB)
```

### 5. Build Docker image (multi-arch)

```bash
docker buildx build \
  --platform linux/amd64,linux/arm/v7 \
  -t user/gssr-game:dev \
  --load \
  .
```

## Key Implementation Notes

### JWT Flow

- `POST /api/auth/login` → issues access token (15min) + refresh token (7d)
- Both stored as `HttpOnly; Secure; SameSite=Strict` cookies
- Refresh token hash stored in Valkey with key `refresh:{user_id}:{token_hash}`
- `POST /api/auth/refresh` → validates Valkey entry, issues new pair (rotation)

### Room State in Valkey

Room state is stored as JSON at key `room:{room_id}`:

```json
{
  "id": "uuid",
  "host_id": "uuid",
  "map_id": "uuid",
  "players": [...],
  "status": "waiting|active|finished",
  "current_round": 1,
  "current_pano_id": "uuid"
}
```

All Zynq nodes share this state via Valkey — stateless compute.

### WebSocket Hub

One hub per room, goroutine-per-connection model:

```text
client connects → register in hub
hub broadcasts → all clients in room
client disconnects → unregister, broadcast player_left
```

### Scoring Formula

```go
Score = 5000 * exp(-(distance / K))
// K is configurable per map (default: 200 pixels)
// Floor mismatch → 0 points regardless of distance
```

## Verification

```bash
# Register user
curl -c cookies.txt -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test123"}'

# Login
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test123"}'

# Get profile (uses cookie)
curl -b cookies.txt http://localhost:3000/api/users/me

# Health check
curl http://localhost:3000/health
# → {"status":"ok"}

# Prometheus metrics
curl http://localhost:2112/metrics
```

## Troubleshooting

- **"connection refused" to Postgres**: check POSTGRES_URL, ensure postgres container is up
- **JWT "signature invalid"**: JWT_SECRET mismatch between nodes — all Zynq nodes must share the same secret from Valkey or env
- **WebSocket connection dropped**: check Nginx `proxy_read_timeout` and `proxy_send_timeout` — set both to 3600s
