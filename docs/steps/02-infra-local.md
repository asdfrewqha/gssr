# Step 2: Local Infrastructure (Main PC)

## Goal

Start all backend services on Main PC using Docker Compose: Postgres, Valkey, RabbitMQ, MinIO, LiveKit, Nginx, Cloudflare Tunnel, Prometheus, Grafana, Loki, Portainer.

## Prerequisites

- Docker + Docker Compose v2 installed
- Step 1 (migrations) completed
- Cloudflare account with a tunnel token (for external access — optional for first local run)

## Steps

### 1. Copy env file

```bash
cp infra/compose/.env.example infra/compose/.env
# Edit .env — fill in passwords, MinIO credentials, JWT secret
```

### 2. Start core services

```bash
cd infra/compose
docker compose -f docker-compose.mainpc.yml up -d \
  postgres valkey rabbitmq minio livekit
```

### 3. Run migrations

```bash
# Wait ~5s for postgres to be ready, then:
docker run --rm --network gssr_default \
  -e GOOSE_DRIVER=postgres \
  -e GOOSE_DBSTRING="$DATABASE_URL" \
  -v $(pwd)/../../migrations:/migrations \
  ghcr.io/pressly/goose:latest up
```

### 4. Start application services

```bash
docker compose -f docker-compose.mainpc.yml up -d \
  workers celery nginx prometheus grafana loki promtail cadvisor node-exporter portainer
```

### 5. Start Cloudflare Tunnel (optional — needed for external access)

```bash
# First time: get tunnel token from Cloudflare Zero Trust dashboard
# Add token to infra/cloudflare/config.yml, then:
docker compose -f docker-compose.mainpc.yml up -d cloudflared
```

## Required Environment Variables (`.env`)

```bash
POSTGRES_USER=gssr
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=gssr
DATABASE_URL=postgres://gssr:<password>@postgres:5432/gssr

VALKEY_URL=redis://valkey:6379

RABBITMQ_DEFAULT_USER=gssr
RABBITMQ_DEFAULT_PASS=<strong-password>

MINIO_ROOT_USER=gssr
MINIO_ROOT_PASSWORD=<strong-password>
MINIO_BUCKET=gssr

JWT_SECRET=<random-64-char-string>
LIVEKIT_API_KEY=<livekit-key>
LIVEKIT_API_SECRET=<livekit-secret>

GRAFANA_PASSWORD=<admin-password>
```

## Verification

```bash
docker compose -f docker-compose.mainpc.yml ps
# All containers should be "running" or "healthy"

curl http://localhost:8000/health      # workers FastAPI
curl http://localhost:9000/minio/health/live  # MinIO
curl http://localhost:3000             # Grafana login page
```

Open Portainer at `http://localhost:9000` (first run: set admin password).

## Troubleshooting

- **Postgres not ready**: add `depends_on: postgres: condition: service_healthy` and a healthcheck to postgres in docker-compose
- **MinIO bucket not created**: run `mc alias set local http://localhost:9000 gssr <password> && mc mb local/gssr`
- **Port conflicts**: check that 5432, 6379, 5672, 9000, 3000 are free on host
