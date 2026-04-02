# GSSR — GeoGuessr School Edition

Self-hosted multiplayer panorama-guessing game. Players are dropped into a custom 2D floor-plan panorama and must click the correct location on a map. Supports multiplayer rooms, solo play, ELO ranking, and admin panel.

---

## 1. Architecture

```text
                   ┌─────────────────┐
                   │   Cloudflare    │  DNS-only (grey cloud, no proxy)
                   │  Pages (static) │  + CDN for frontend/admin
                   └────────┬────────┘
                            │ :443/:80  (TLS terminated at nginx)
                   ┌────────▼────────┐
                   │     nginx       │  reverse proxy, rate limiting
                   │  (HTTP/1.1 only)│  HTTP/2 disabled — ISP kills it
                   └────────┬────────┘
          ┌─────────────────┼──────────────────────────────┐
          │                 │                              │
   ┌──────▼──────┐  ┌───────▼──────┐            ┌─────────▼─────────┐
   │ zynq_game   │  │ workers:8000 │            │   minio:9000      │
   │ upstream    │  │  (FastAPI)   │            │  gssr-panoramas   │
   │ :3000 REST  │  └───────┬──────┘            │  gssr-floors      │
   │ :3001 sio   │          │ Celery            │  gssr-avatars     │
   └──────┬──────┘          │                   └───────────────────┘
          │           ┌─────▼──────┐
   ┌──────▼──────┐    │ rabbitmq   │
   │  postgres   │    └────────────┘
   │  valkey ◄───┼── socket.io Valkey adapter (pub/sub cross-node)
   └─────────────┘
```

**zynq_game upstream** = main PC (`game:3000/3001`, weight 5) + 5× Zynq ARM nodes (weight 1 each),
all active via `least_conn`. Room state lives in Valkey → any node can serve any request.

### 1.1 Services & Ports

| Service | Port | Access | Description |
| --- | --- | --- | --- |
| nginx | 80, 443 | Public (Cloudflare DNS) | Reverse proxy |
| game | 3000 | Internal | Go Fiber — REST API, `/metrics` |
| game socket.io | 3001 | Internal (via nginx `/socket.io/`) | net/http socket.io server |
| workers | 8000 | Internal | FastAPI — admin API, `/metrics` |
| celery | — | — | Tasks: tiling, NSFW, ELO |
| postgres | 5432 | Internal | PostgreSQL 16 |
| valkey | 6379 | Internal | Room state, sessions, refresh tokens |
| rabbitmq | 5672 / 15672 | `/utils/mq/` (Basic Auth) | Celery broker / management UI |
| minio | 9000 | Internal (S3 API via nginx `/s3/`) | Object storage |
| minio console | 9001 | `minio.${DOMAIN}` (Basic Auth) | MinIO web UI |
| livekit | 7880 | Internal (via `/livekit/`) | WebRTC SFU voice chat |
| grafana | 3000 | `/utils/grafana/` (Basic Auth) | Dashboards |
| prometheus | 9090 | Internal | Metrics scraper |
| loki | 3100 | Internal | Log aggregation |
| pgadmin | 5050 | `/utils/pgadmin/` (Basic Auth) | Postgres UI |
| portainer | 9000 | `/utils/portainer/` (Basic Auth) | Docker UI |

### 1.2 Cluster Topology

| Node | Count | Arch | Runs |
| --- | --- | --- | --- |
| Main PC | 1 | linux/amd64 | All services (postgres, valkey, workers, nginx, …) + game |
| Zynq nodes | 5 | linux/arm/v7 | `gssr-game` only (connects to main PC's Valkey + Postgres) |
| Cloudflare Pages | — | CDN | frontend (port 5173), admin (port 5174) |

Zynq nodes use `ZYNQ_POSTGRES_URL` / `ZYNQ_VALKEY_URL` from their `.env` to reach main PC's services.

---

## 2. Key Design Decisions

### 2.1 Two-Server Architecture (Fiber + socket.io)

Go Fiber uses **fasthttp**, which does not implement `http.Hijacker`. The socket.io library
(`zishang520/socket.io`) requires HTTP hijacking for WebSocket upgrades, so socket.io cannot
share the Fiber listener. Two separate servers run in the same process:

- `:3000` — Fiber (fasthttp), REST API
- `:3001` — `net/http`, socket.io

nginx routes `/api/` → `zynq_game` (port 3000) and `/socket.io/` → `zynq_game_sio` (port 3001).

### 2.2 Socket.io Valkey Adapter (Cross-Node Broadcasts)

Without a shared adapter, `h.io.To(room).Emit(...)` only reaches clients connected to the
same process. A guess hitting Zynq node A would never reach a client on node B.

**Solution**: `github.com/zishang520/socket.io-go-redis v1.3.0` wraps the existing `go-redis/v9`
client. Every `Emit()` publishes to a Valkey pub/sub channel; all nodes subscribe and forward
to their local clients.

```go
ioServer.SetAdapter(&sioadapter.RedisAdapterBuilder{
    Redis: siotypes.NewRedisClient(ctx, valkey.Client),
})
```

Zynq nodes already connect to main PC's Valkey via `ZYNQ_VALKEY_URL`, so the adapter works
across the whole cluster with no extra infrastructure.

### 2.3 Auth — Two Cookie Pairs

| Cookie | TTL | Purpose |
| --- | --- | --- |
| `access_token` | 4h | Player JWT (claim: `uid`) |
| `refresh_token` | 30d | Player refresh |
| `admin_token` | 4h | Admin JWT (claims: `uid` + `adm: true`) |
| `admin_refresh` | 30d | Admin refresh |

The game service middleware tries `access_token` first, falls back to `admin_token`. Workers
`deps.py` reads only `admin_token`. Admin refresh calls `/api/auth/admin-refresh` (separate
from player `/api/auth/refresh`).

**Critical**: Fiber middleware that rejects auth must use `fiber.NewError(...)` — using
`c.Status(...).JSON(...)` returns `nil`, so `c.Next()` is called regardless → panic downstream.

### 2.4 Scoring Formula

```text
Score = 5000 × exp(−d / K)
```

- `d` — Euclidean distance in **pixel units** (coordinates sent as normalized [0,1] × 1000)
- `K` — strictness coefficient per difficulty:

| Mode | K | Timer |
| --- | --- | --- |
| Solo Easy | 350 | 120s |
| Solo Normal / Multiplayer | 200 | 60s / configured |
| Solo Hard | 100 | 30s |

- Wrong floor → **score 0** regardless of distance
- Distance stored as 0–1414 pseudo-pixel units (diagonal of 1000×1000 grid)

### 2.5 Panorama Pipeline

```text
Admin uploads → presigned PUT → MinIO /gssr-panoramas/raw/{id}.jpg
                                         ↓ confirm-upload
                               Celery: pyvips tiles → /gssr-panoramas/maps/{id}/…
                               Celery: NSFW onnxruntime → records score (no auto-reject)
```

- Panoramas are auto-approved (`moderation_status = 'clean'`) on creation
- NSFW task only records a score; admin can manually Reject from admin panel
- Presigned PUT goes directly browser → MinIO (no nginx body buffering)
- nginx `/gssr-panoramas/raw/` location proxies with `Host: minio:9000` to match S3 signature

### 2.6 Room State Machine & Anti-Race

Room state JSON lives in Valkey at `room:{id}` (TTL 24h). The `RoundToken` field is a UUID
regenerated at each round start. Both the **server-side round timer** and the **last-guess
handler** call `advanceRound()`. Before scoring, `advanceRound` re-fetches state from Valkey
and aborts if `RoundToken` has changed — preventing double-advance.

```text
waiting → (host calls /start) → active → (all guessed OR timer fires) → advanceRound
                                          → next round (new RoundToken) OR finished
```

Room membership is managed **exclusively via REST**:

- `POST /api/rooms/:id/join` — adds player to Valkey state
- `DELETE /api/rooms/:id/leave` — removes player from Valkey state
- socket.io disconnect does **not** remove the player (this was a critical bug; now fixed)

### 2.7 Known Constraints

| Constraint | Cause | Mitigation |
| --- | --- | --- |
| HTTP/2 disabled | ISP (Rostelecom) kills muxed TCP connections after ~38s | HTTP/1.1 only in nginx |
| cloudflared unusable | Same ISP TCP kill — single tunnel = all requests drop | Cloudflare DNS-only (grey cloud) |
| Upload ~400 B/s | Rostelecom residential uplink | Gzip on all text responses |
| SSL Inspection (school network) | Corporate proxy replaces TLS cert | `go mod vendor` + `-mod=vendor` in Dockerfile; no network needed during build |
| Grafana port 3001 | Grafana binds `127.0.0.1:3001` on host; socket.io also uses 3001 | No conflict: socket.io port 3001 is **not exposed** on host (`ports:` not set in compose); SSH tunnel for grafana is separate |

---

## 3. User Flows

### 3.1 Registration & Login

```text
POST /api/auth/register  → sends verification email (Celery)
GET  /api/auth/verify-email?token=  → marks email_verified=true, redirects to /verified
POST /api/auth/login  → sets access_token + refresh_token cookies
```

Only `email_verified=true` users appear on the leaderboard.

### 3.2 Multiplayer Game

```text
1. Player: POST /api/rooms          → creates room in Valkey, gets room_id
2. Others: POST /api/rooms/:id/join → added to Valkey state; socket.io emits player_joined
3. All:    socket.io connect        → { auth: { roomId } } → joins sio room
4. Host:   POST /api/rooms/:id/start
           → random panoramas selected from DB
           → match record created in postgres
           → socket.io emits round_started to all
           → server-side timer started (RoundToken)
5. Each:   POST /api/rooms/:id/guess
           → score calculated, saved to postgres
           → socket.io emits guess_broadcast
           → if all guessed → advanceRound()
6. advanceRound:
           → socket.io emits round_ended (scores + correct location)
           → if rounds remain → next round, new RoundToken
           → if last round → socket.io emits game_ended
             → POST /internal/elo triggers ELO recalculation in workers
```

### 3.3 Solo Play

REST-only (no socket.io). Client-side countdown timer (UX only — server uses DB timestamps).

```text
POST /api/solo/start?difficulty=easy|normal|hard&rounds=N
GET  /api/solo/:id           → current panorama
POST /api/solo/:id/guess     → score returned immediately
GET  /api/solo/:id/result    → final score + XP earned
POST /api/solo/:id/abandon   → mark abandoned
GET  /api/solo/history       → past sessions
```

XP = `total_score / 1000`.

### 3.4 Admin Panorama Upload

```text
GET  /admin/panoramas/upload-url  → presigned MinIO PUT URL
Browser: PUT {presigned_url}      → file lands at gssr-panoramas/raw/{id}.jpg
POST /admin/panoramas/confirm-upload  → triggers Celery tiling + NSFW tasks
WebSocket /admin/ws/pano/{id}     → tiling progress updates
```

---

## 4. Initial Setup

### 4.1 Server User

```bash
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG docker deploy
sudo mkdir -p /home/deploy/.ssh
sudo sh -c 'echo "ssh-ed25519 AAAA... github-actions" > /home/deploy/.ssh/authorized_keys'
sudo chown -R deploy:deploy /home/deploy/.ssh && sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

### 4.2 Non-Standard SSH Port

```bash
# /etc/ssh/sshd_config
Port 1337
sudo systemctl restart sshd
```

### 4.3 Cloudflare DNS

- `api.yourdomain.com` → server IP, **DNS-only (grey cloud)**. Do NOT proxy (orange cloud) —
  ~400 B/s uplink + ISP TCP kills make Cloudflare proxying unusable.
- `minio.yourdomain.com` → same server IP, **DNS-only (grey cloud)** — MinIO console subdomain.
- `yourdomain.com` + `admin.yourdomain.com` → Cloudflare Pages (orange cloud OK).

### 4.4 SSL Certificate (Let's Encrypt via Certbot)

Certbot runs as a container (`certbot/dns-cloudflare`) and renews automatically every 12h.
First-time issuance happens during CI deploy. Requires `CLOUDFLARE_API_TOKEN` with
`Zone:DNS:Edit` permission.

The cert covers both `api.` and `minio.` subdomains. Include **both** with `-d` flags — the
cert is stored at `/etc/letsencrypt/live/api.yourdomain.com/` (first domain is the name).

```bash
# Issue / re-issue manually (run once on server, or let CI handle it):
docker run --rm \
  -v /opt/gssr/letsencrypt:/etc/letsencrypt \
  -v /opt/gssr/infra/compose/certbot/cloudflare.ini:/cloudflare.ini:ro \
  certbot/dns-cloudflare certonly \
    --dns-cloudflare --dns-cloudflare-credentials /cloudflare.ini \
    --non-interactive --agree-tos -m you@example.com \
    -d api.yourdomain.com -d minio.yourdomain.com
```

> To add more subdomains later, re-run the same `certonly` command with all `-d` flags.
> `certbot renew` (the automatic renewal service) picks up the updated cert automatically.

### 4.5 Generate Secrets

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "RABBITMQ_PASS=$(openssl rand -hex 16)"
echo "MINIO_ROOT_PASSWORD=$(openssl rand -hex 16)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "LIVEKIT_API_KEY=$(openssl rand -hex 8)"
echo "LIVEKIT_API_SECRET=$(openssl rand -hex 24)"
echo "GRAFANA_PASSWORD=$(openssl rand -hex 12)"
echo "PGADMIN_PASSWORD=$(openssl rand -hex 12)"
```

### 4.6 SSH Key for CI

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/gssr-deploy
# Public key  → /home/deploy/.ssh/authorized_keys on server
# Private key → GitHub Secret MAINPC_SSH_KEY
```

---

## 5. GitHub Secrets & Variables

Repository → Settings → Secrets and variables → Actions

### Secrets

| Secret | How to get | Description |
| --- | --- | --- |
| `MAINPC_SSH_HOST` | server IP/hostname | SSH target |
| `MAINPC_SSH_PORT` | e.g. `1337` | SSH port |
| `MAINPC_SSH_KEY` | `ssh-keygen -t ed25519` | Private key for `deploy@server` |
| `ZYNQ_SSH_HOST_*` | Zynq IP per node | e.g. `ZYNQ_SSH_HOST_1`=192.168.1.101 |
| `ZYNQ_SSH_KEY` | same or separate key | Private key for Zynq deploy |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | PostgreSQL password |
| `RABBITMQ_PASS` | `openssl rand -hex 16` | RabbitMQ password (user: gssr) |
| `MINIO_ROOT_PASSWORD` | `openssl rand -hex 16` | MinIO root password |
| `JWT_SECRET` | `openssl rand -hex 32` | Shared JWT secret (game + workers) |
| `LIVEKIT_API_KEY` | `openssl rand -hex 8` | LiveKit key |
| `LIVEKIT_API_SECRET` | `openssl rand -hex 24` | LiveKit secret |
| `GRAFANA_PASSWORD` | any password | Grafana admin password |
| `PGADMIN_PASSWORD` | any password | pgAdmin password |
| `ADMIN_USERNAME` | any username | Initial admin account + HTTP Basic Auth for `/utils/` |
| `ADMIN_PASSWORD` | any password | Initial admin account + HTTP Basic Auth for `/utils/` |
| `CERT_EMAIL` | your email | Let's Encrypt registration email |
| `DOCKERHUB_USERNAME` | Docker Hub login | Image registry |
| `DOCKERHUB_TOKEN` | Docker Hub → Security | Access token |
| `CLOUDFLARE_API_TOKEN` | CF Dashboard → API Tokens | Scope: `Zone:DNS:Edit` (certbot) + `Cloudflare Pages:Edit` (deploy) |
| `CLOUDFLARE_ACCOUNT_ID` | CF Dashboard sidebar | Account ID |

### Variables (visible in logs)

| Variable | Example | Description |
| --- | --- | --- |
| `DOMAIN` | `school.example.com` | Base domain |
| `VITE_API_URL` | `https://api.school.example.com` | Game API URL for frontend |
| `VITE_WS_URL` | `https://api.school.example.com` | socket.io origin (HTTP, **not** `ws://`) |
| `VITE_S3_URL` | `https://api.school.example.com` | MinIO base URL (no bucket path) |
| `VITE_LIVEKIT_URL` | `wss://api.school.example.com/livekit` | LiveKit URL |

> `VITE_WS_URL` is the **HTTP origin** (`https://…`), not a `ws://` URL. The socket.io client
> upgrades to WebSocket automatically. Empty string = same origin (correct for Vite dev proxy).
> `VITE_S3_URL` is the **base** URL — panorama raw image: `${VITE_S3_URL}/gssr-panoramas/raw/{id}.jpg`.
> Was previously named `VITE_MINIO_URL` (renamed).

### What CI Does With Secrets

Deploy workflow (`deploy-mainpc.yml`):

1. `git archive HEAD | gzip → SCP deploy.tar.gz` to server (no git needed on server)
2. SSH: `tar -x` + write `infra/compose/.env` from secrets via `printf '%s\n' "${VAR}"` (safe for special chars)
3. Write `livekit.yaml` from `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`
4. Write `certbot/cloudflare.ini` from `CLOUDFLARE_API_TOKEN`
5. Generate `infra/nginx/utils.htpasswd` from `ADMIN_USERNAME` / `ADMIN_PASSWORD`:
   `echo "$ADMIN_USERNAME:$(openssl passwd -apr1 "$ADMIN_PASSWORD")" > infra/nginx/utils.htpasswd`
6. `docker compose pull && docker compose up -d --force-recreate`
7. Run goose migrations

---

## 6. Deploy

### Automatic (CI)

Triggers on push to `main` after the build workflows complete, or manually via
GitHub Actions → Deploy to Main PC → Run workflow.

### Manual (on server)

```bash
ssh -p <SSH_PORT> deploy@<server-ip>
cd /opt/gssr

# Alias (add to /home/deploy/.bashrc)
alias dc='docker compose -f /opt/gssr/infra/compose/docker-compose.mainpc.yml'

# Update single service
dc pull game && dc up -d --no-build --force-recreate game

# Full restart
dc up -d --no-build --force-recreate

# Status
dc ps
```

### Run Migrations Manually

```bash
cd /opt/gssr
docker run --rm --network gssr_default \
  -v "$(pwd)/migrations:/migrations" \
  -e GOOSE_DBSTRING="postgres://gssr:${POSTGRES_PASSWORD}@postgres:5432/gssr?sslmode=disable" \
  golang:1.22-alpine \
  sh -c 'go install github.com/pressly/goose/v3/cmd/goose@v3.20.0 && \
    goose -dir /migrations postgres "${GOOSE_DBSTRING}" up'
```

---

## 7. Local Development

### Requirements

| Tool | Version |
| --- | --- |
| Go | 1.22+ |
| Python | 3.11+ |
| Node.js | 20+ |
| Docker + Compose v2 | 24+ |
| Make | any |

### Quick Start

```bash
# 1. Clone
git clone https://github.com/<org>/gssr && cd gssr

# 2. Copy env
cp .env.example .env  # edit passwords — anything works locally

# 3. Vendor (first time or after go.mod changes)
make vendor

# 4. Start infra (postgres, valkey, rabbitmq, minio)
make dev

# 5. Migrations
make migrate-up DATABASE_URL=postgres://gssr:changeme@localhost:5432/gssr?sslmode=disable

# 6. Run services (separate terminals)
cd services/game && go run ./cmd/server          # :3000 REST + :3001 socket.io
cd services/workers && uvicorn app.main:app --port 8000 --reload
cd frontend && npm install && npm run dev         # :5173
cd admin && npm install && npm run dev            # :5174
```

### Game Service Env (minimal)

```env
POSTGRES_URL=postgres://gssr:changeme@localhost:5432/gssr?sslmode=disable
VALKEY_URL=redis://localhost:6379
JWT_SECRET=dev-secret-at-least-32-chars-long-for-hmac
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme
```

### Workers Env (minimal)

```env
WORKERS_DATABASE_URL=postgresql+asyncpg://gssr:changeme@localhost:5432/gssr
RABBITMQ_URL=amqp://gssr:changeme@localhost:5672/
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=gssr
MINIO_SECRET_KEY=changeme
MINIO_PUBLIC_URL=http://localhost:9000
ADMIN_CORS_ORIGINS=http://localhost:5174
ADMIN_JWT_SECRET=dev-secret-at-least-32-chars-long-for-hmac
NSFW_MODEL_PATH=models/nsfw.onnx
```

Full variable reference: `.env.example`.

---

## 8. Admin Access

Admin tools are exposed directly via nginx with HTTP Basic Auth. Credentials for all `/utils/`
routes and `minio.${DOMAIN}` are `ADMIN_USERNAME` / `ADMIN_PASSWORD` (same as the app admin
account). The htpasswd file is generated by CI on each deploy.

### 8.1 Developer Docs (no auth required)

| URL | Description |
| --- | --- |
| `https://api.${DOMAIN}/utils/game/docs/` | Game service — Swagger UI (swag/gofiber) |
| `https://api.${DOMAIN}/utils/workers/docs` | Workers service — FastAPI auto-docs |
| `https://api.${DOMAIN}/utils/workers/redoc` | Workers service — ReDoc |

### 8.2 Admin Tools (HTTP Basic Auth)

| Panel | URL | App credentials |
| --- | --- | --- |
| Grafana | `https://api.${DOMAIN}/utils/grafana/` | admin / `$GRAFANA_PASSWORD` |
| pgAdmin | `https://api.${DOMAIN}/utils/pgadmin/` | `admin@gssr.dev` / `$PGADMIN_PASSWORD` |
| RabbitMQ | `https://api.${DOMAIN}/utils/mq/` | gssr / `$RABBITMQ_PASS` |
| Portainer | `https://api.${DOMAIN}/utils/portainer/` | (set on first login) |
| MinIO Console | `https://minio.${DOMAIN}/` | gssr / `$MINIO_ROOT_PASSWORD` |

> Browser shows an HTTP Basic Auth dialog first (ADMIN_USERNAME / ADMIN_PASSWORD), then the
> tool's own login page.

### 8.3 pgAdmin First-Time Setup

Add Server → Host: `postgres`, Port: `5432`, User: `gssr`, Password: `$POSTGRES_PASSWORD`.

### 8.4 htpasswd — Manual Regeneration

If you need to regenerate the password file on the server without a full CI deploy:

```bash
ssh -p <SSH_PORT> deploy@<server>
echo "ADMIN_USERNAME:$(openssl passwd -apr1 'NEW_PASSWORD')" \
  > /opt/gssr/infra/nginx/utils.htpasswd
docker exec gssr-nginx-1 nginx -s reload
```

---

## 9. Monitoring

### Health Checks

```bash
curl http://localhost:3000/health   # {"status":"ok"}
curl http://localhost:8000/health   # {"status":"ok"}
dc ps                               # check STATE = healthy
```

### Prometheus Targets

| Target | Metrics |
| --- | --- |
| `game:3000/metrics` | Go Fiber request counts, latency |
| `workers:8000/metrics` | FastAPI request counts |
| `cadvisor:8080` | Container resource usage |
| `dockerhost:9100` | Host CPU/RAM/disk (node-exporter) |
| `postgres-exporter:9187` | PostgreSQL stats |
| `rabbitmq:15692` | Queue depths, message rates |

### Logs

```bash
dc logs -f                          # all services live
dc logs --tail=100 game             # last 100 lines of game
dc logs --tail=100 celery           # Celery task logs

# Loki (via Grafana): Explore → Loki → {container_name="gssr-game-1"}
```

---

## 10. Database

### Migrations

10 migration files (goose) in `migrations/`:

| File | Tables |
| --- | --- |
| 00001 | users |
| 00002 | maps, floors |
| 00003 | panoramas |
| 00004 | matches, guesses |
| 00005 | admins |
| 00006 | extend_users (xp, email_verified) |
| 00007 | email_verification_tokens |
| 00008 | solo_sessions, solo_guesses |

### Backup & Restore

```bash
# Backup
dc exec postgres pg_dump -U gssr gssr | gzip > ~/backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Restore
gunzip -c backup_20240101_120000.sql.gz | dc exec -T postgres psql -U gssr gssr

# psql direct
dc exec postgres psql -U gssr gssr
```

### Rotate JWT Secret

> Rotating `JWT_SECRET` invalidates **all active sessions** (players must log in again).

1. Update secret in GitHub → Settings → Secrets
2. Run Deploy workflow
3. CI rewrites `.env` and recreates game + workers containers

### Rotate Postgres Password

```bash
# 1. Update in GitHub Secrets
# 2. Run Deploy workflow (updates .env)
# 3. Also update password inside Postgres:
dc exec postgres psql -U gssr -c "ALTER USER gssr PASSWORD 'new_password';"
```

---

## 11. Troubleshooting

### nginx doesn't start

```bash
dc exec nginx nginx -t

# Common causes:
# - SSL cert missing: infra/nginx/ssl/letsencrypt/live/api.domain.com/
# - Upstream container not running (game/workers)
# - ${DOMAIN} not substituted: envsubst runs in CI before docker compose up
```

### Container in restart loop

```bash
dc logs --tail=50 <service>

# game: "required env var not set: POSTGRES_URL" → check .env
# game: "dial tcp: connection refused" → postgres not healthy yet (depends_on handles this)
# workers: DB connection error → check WORKERS_DATABASE_URL (not DATABASE_URL)
```

### Game service unhealthy

```bash
dc exec game wget -qO- http://localhost:3000/health
# Healthcheck uses wget — image must be alpine-based, not scratch
```

### socket.io clients can't connect / events not delivered

1. Check nginx `/socket.io/` location points to `http://zynq_game_sio`
2. Check game service port 3001 is reachable: `dc exec nginx curl http://game:3001/socket.io/`
3. Valkey adapter logs: `dc logs game | grep -i socket`
4. If Zynq node: verify `ZYNQ_VALKEY_URL` reaches main PC's Valkey

### Panorama upload fails (presigned PUT)

```bash
# nginx must have a dedicated location for /gssr-panoramas/raw/
# with proxy_set_header Host minio:9000 (required for S3 signature matching)
dc exec nginx nginx -T | grep gssr-panoramas
```

### Guesses return 403 / 404 after round start

Root cause: socket.io disconnect was removing players from Valkey room state (fixed).
If regressed: check `SetupSocketIO()` — the `disconnect` handler must be a no-op.

### Grafana shows "No data"

1. `dc logs prometheus` — check scrape errors
2. Open `https://api.${DOMAIN}/utils/grafana/` → Connections → Data Sources → Prometheus → Test
3. node-exporter uses `extra_hosts: dockerhost:host-gateway` to reach host network

### `/utils/` returns 401 with no browser dialog (or nginx 500)

`infra/nginx/utils.htpasswd` is missing or empty. Re-run CI deploy, or manually:

```bash
echo "$ADMIN_USERNAME:$(openssl passwd -apr1 "$ADMIN_PASSWORD")" \
  > /opt/gssr/infra/nginx/utils.htpasswd
docker exec gssr-nginx-1 nginx -s reload
```

### ISP drops connections during long operations

- Panorama uploads: nginx `proxy_read_timeout 300s` on `/admin/` and presigned upload locations
- WebSocket: `proxy_read_timeout 3600s` on `/socket.io/`
- HTTP/2: **must remain disabled** — ISP kills the shared TCP connection, dropping all in-flight requests

---

## 12. File Structure

```text
gssr/
├── .github/
│   ├── workflows/
│   │   ├── build-game.yml          # Docker build gssr-game (linux/amd64 + linux/arm/v7)
│   │   ├── build-workers.yml       # Docker build gssr-workers (linux/amd64)
│   │   ├── deploy-mainpc.yml       # SCP+SSH deploy to Main PC
│   │   ├── deploy-zynq.yml         # SSH deploy to 5× Zynq nodes
│   │   ├── deploy-frontend.yml     # Cloudflare Pages (wrangler)
│   │   └── deploy-admin.yml        # Cloudflare Pages (wrangler)
│   └── secrets.example.env         # Reference for all CI secrets/variables
├── services/
│   ├── game/                       # Go 1.22, Fiber v2
│   │   ├── cmd/server/main.go      # Entry point: Fiber:3000 + socket.io:3001
│   │   ├── internal/
│   │   │   ├── auth/               # JWT middleware, register/login/refresh, SeedAdmin
│   │   │   ├── config/             # Config{} loaded from env
│   │   │   ├── db/                 # Postgres (pgx/v5) + Valkey (go-redis/v9)
│   │   │   ├── game/               # CalculateScore, Distance
│   │   │   ├── leaderboard/        # GET /api/leaderboard, GET /api/users/:id/profile
│   │   │   ├── maps/               # GET /api/maps, GET /api/maps/:id
│   │   │   ├── room/               # Room CRUD, socket.io setup, advanceRound
│   │   │   ├── solo/               # Solo session CRUD
│   │   │   └── user/               # GET /api/users/me
│   │   └── vendor/                 # go mod vendor (committed; -mod=vendor in Dockerfile)
│   └── workers/                    # Python 3.11, FastAPI + Celery
│       ├── app/
│       │   ├── api/                # admin_maps, admin_panos, admin_users, admin_admins, internal
│       │   ├── tasks/              # tiling.py, moderation.py, elo.py, email.py
│       │   └── models.py           # SQLAlchemy 2.0 ORM
│       └── requirements.txt
├── frontend/                       # React 18 + Vite + Zustand + Tailwind
│   └── src/
│       ├── hooks/useSocket.ts      # socket.io-client, individual Zustand selectors
│       ├── pages/                  # Login, Register, Lobby, Room, Game, GameOver,
│       │                           #   PlayGame (solo), PlayResult, Leaderboard
│       └── components/             # PanoramaViewer, GuessMap, FloorSelector, RoundResults
├── admin/                          # React 18 + Vite + Tailwind (admin panel)
│   └── src/pages/                  # Dashboard, Maps, MapDetail, Panoramas,
│                                   #   Users, AdminManagement
├── infra/
│   ├── compose/
│   │   ├── docker-compose.mainpc.yml
│   │   ├── docker-compose.zynq.yml
│   │   ├── docker-compose.test.yml  # E2E test stack (tmpfs postgres+minio)
│   │   └── .env                     # (gitignored — written by CI)
│   ├── nginx/
│   │   ├── nginx.conf               # HTTP/1.1, gzip, rate-limit zones, Docker DNS resolver
│   │   ├── upstream.conf            # upstreams + api.${DOMAIN} + minio.${DOMAIN} server blocks
│   │   ├── proxy_params.conf        # Common proxy headers
│   │   └── utils.htpasswd           # (gitignored) generated by CI from ADMIN_USERNAME/PASSWORD
│   ├── rabbitmq/
│   │   ├── enabled_plugins          # [rabbitmq_management, rabbitmq_prometheus]
│   │   └── rabbitmq.conf            # management.path_prefix = /utils/mq
│   └── monitoring/
│       ├── prometheus.yml
│       ├── loki.yml / promtail.yml
│       └── grafana/provisioning/
├── migrations/                      # goose SQL (00001–00008)
├── .env.example                     # Master reference for ALL variables
├── Makefile
└── docs/
    ├── plan.md                      # Original roadmap
    └── arch-plan.md                 # Original architecture blueprint
```
