# GSSR Project Memory

## Project: GSSR (GeoGuessr School Edition)

Self-hosted multiplayer panorama guessing game. Greenfield, fully implemented skeleton.

## Stack

- **services/game**: Go Fiber v2 + pgx/v5 + go-redis/v9 + golang-jwt/v5 + fiberprometheus; target linux/arm/v7 (Zynq nodes) + linux/amd64
- **services/workers**: Python FastAPI + Celery (RabbitMQ broker, Valkey backend) + pyvips (tiling) + onnxruntime (NSFW) + boto3 (MinIO)
- **frontend**: React 18 + Vite + Zustand + Leaflet L.CRS.Simple + Marzipano + nsfwjs + LiveKit; port 5173
- **admin**: separate React+Vite, port 5174, proxies to workers:8000
- **migrations**: goose SQL, 6 files (users, maps, floors, panoramas, matches, guesses)

## Infrastructure

- **Main PC**: postgres, valkey, rabbitmq, minio, livekit, nginx, cloudflared, portainer, prometheus, grafana, loki, promtail, cadvisor, node-exporter — all in `infra/compose/docker-compose.mainpc.yml`
- **Zynq x5**: only gssr-game container (linux/arm/v7) — `infra/compose/docker-compose.zynq.yml`
- **Cloudflare Tunnel**: no open router ports; Cloudflare Access protects admin/s3/grafana/mq/portainer
- **Cloudflare Pages**: frontend/ and admin/ static hosting
- **Compose file paths**: `.env` for mainpc lives at `infra/compose/.env` (docker compose reads it from compose file dir); `livekit.yaml` at `infra/compose/livekit.yaml` (gitignored, written by CI)

## CI/CD Design Decisions

- **Deploy strategy**: `git archive HEAD → SCP deploy.tar.gz → SSH: tar -x + write .env + docker compose up` — server needs NO git/GitHub token
- **Secrets passed via SSH**: `envs:` parameter of appleboy/ssh-action; values written using `printf '%s\n' "${VAR}"` (safe for special chars)
- **New secrets added**: POSTGRES_PASSWORD, RABBITMQ_PASS, MINIO_ROOT_PASSWORD, JWT_SECRET, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, GRAFANA_PASSWORD, ZYNQ_POSTGRES_URL, ZYNQ_VALKEY_URL, DOMAIN (variable)
- **No GH_DEPLOY_TOKEN needed**: SCP approach eliminates the need for git on server
- **livekit.yaml**: written by deploy-mainpc.yml SSH script from secrets; gitignored

## Go Build: Vendor Directory

- `services/game/Dockerfile` uses `-mod=vendor` — no network needed inside Docker
- Run `make vendor` once (calls `go mod vendor`) then commit `vendor/`
- Reason: corporate/school networks with SSL inspection break `go mod download` inside Docker containers (TLS version mismatch on proxy.golang.org)

## Test Stack

- `infra/compose/docker-compose.test.yml` — ephemeral stack (tmpfs for postgres+minio, offset ports)
- **goose in test stack**: uses `golang:1.22-alpine` image + `go install goose@v3.20.0` (avoids ghcr.io auth issues)
- `goose-cache` named volume caches the goose binary across restarts
- `make test-up` = `docker compose up -d --build` + `docker compose wait migrate`
- `make e2e` = test-up + playwright + test-down

## Environment Files Structure

- Root `.env.example` — master reference for ALL vars (CI secrets + local dev)
- Root `.env` — local dev master (gitignored)
- `services/game/.env` / `services/workers/.env` — service-specific local dev
- `frontend/.env` / `admin/.env` — Vite vars local dev
- `infra/compose/.env` — docker-compose vars (gitignored, written by CI in prod)
- `.github/secrets.example.env` — GitHub Actions secrets/variables reference

## Key Formulas

- **Scoring**: `Score = 5000 * exp(-(d/K))`, floor mismatch → 0
- **ELO**: K=32 for <30 matches, K=16 for ≥30; pairwise; recalculated by Celery post-match

## Docs

`docs/steps/01-12-*.md` — operational runbooks for each implementation step
