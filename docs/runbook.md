# GSSR Runbook

## 1. Архитектура

```
┌─────────────┐      ┌──────────────┐
│  Cloudflare  │─────▶│   nginx:443   │
│  (DNS proxy) │      │   :80         │
└─────────────┘      └──────┬───────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                  ▼
   ┌────────────┐   ┌────────────┐    ┌────────────┐
   │ game:3000  │   │workers:8000│    │ minio:9000 │
   │ (Go/Fiber) │   │ (FastAPI)  │    │  (S3)      │
   └─────┬──────┘   └─────┬──────┘    └────────────┘
         │                 │
   ┌─────┴─────┐    ┌─────┴─────┐
   │postgres   │    │ celery    │
   │valkey     │    │ rabbitmq  │
   └───────────┘    └───────────┘
```

### Сервисы и порты

| Сервис | Порт | Описание |
|--------|------|----------|
| nginx | 80, 443 | Reverse proxy (публичный) |
| game | 3000 | Go Fiber — auth, game API, WebSocket |
| workers | 8000 | FastAPI — admin API, health |
| celery | — | Worker: tiling, moderation, ELO |
| postgres | 5432 | PostgreSQL 16 |
| valkey | 6379 | Redis-совместимый кеш (rooms, sessions) |
| rabbitmq | 5672/15672 | Celery broker / management UI |
| minio | 9000/9001 | S3-совместимое хранилище / console |
| livekit | 7880 | WebRTC SFU (голосовой чат) |
| grafana | 3000→3001 | Мониторинг дашборды |
| prometheus | 9090 | Метрики |
| loki | 3100 | Агрегация логов |
| portainer | 9000→9002 | Docker UI |

### Zynq ARM ноды (backup)

5 нод (192.168.1.101–105) с контейнером `gssr-game` (linux/arm/v7). При наличии нод nginx балансирует на них как backup. Без нод — всё идёт на `game:3000` (Main PC).

## 2. SSH доступ

```bash
# Main PC (deploy user, порт 1337)
ssh -p 1337 deploy@<server-ip>

# SSH tunnel для админских панелей
ssh -L 3001:localhost:3001 \
    -L 9001:localhost:9001 \
    -L 15672:localhost:15672 \
    -L 9002:localhost:9002 \
    -p 1337 deploy@<server-ip>
```

После tunnel:
- **Grafana**: http://localhost:3001 (admin / `$GRAFANA_PASSWORD`)
- **MinIO Console**: http://localhost:9001 (gssr / `$MINIO_ROOT_PASSWORD`)
- **RabbitMQ**: http://localhost:15672 (gssr / `$RABBITMQ_PASS`)
- **Portainer**: http://localhost:9002

## 3. Деплой

### Автоматический (CI)

Деплой запускается автоматически после успешной сборки `Build Game Service` или `Build Workers Service` на main. Также можно запустить вручную через `workflow_dispatch` в GitHub Actions.

Стратегия: `git archive → SCP → SSH: tar -x + write .env + docker compose up`. Сервер не нуждается в git или GitHub-токене.

### Ручной

```bash
ssh -p 1337 deploy@<server-ip>
cd /opt/gssr

# Обновить один сервис
docker compose -f infra/compose/docker-compose.mainpc.yml pull game
docker compose -f infra/compose/docker-compose.mainpc.yml \
  up -d --no-build --force-recreate game nginx

# Полный рестарт всего стека
docker compose -f infra/compose/docker-compose.mainpc.yml \
  up -d --no-build --force-recreate
```

## 4. Мониторинг

### Health endpoints

```bash
# Game service
curl http://localhost:3000/health    # {"status":"ok"}

# Workers
curl http://localhost:8000/health    # {"status":"ok"}
```

### Метрики

- Game: `http://game:3000/metrics` (Prometheus format)
- Workers: `http://workers:8000/metrics`
- Grafana дашборды через SSH tunnel (http://localhost:3001)

### Логи

```bash
# Все сервисы
docker compose -f infra/compose/docker-compose.mainpc.yml logs -f

# Конкретный сервис
docker compose -f infra/compose/docker-compose.mainpc.yml logs -f game
docker compose -f infra/compose/docker-compose.mainpc.yml logs -f workers
docker compose -f infra/compose/docker-compose.mainpc.yml logs -f celery

# Loki (через Grafana) — структурированные логи с фильтрацией
```

## 5. БД операции

### Миграции

```bash
# На сервере (через SSH)
cd /opt/gssr
docker run --rm --network gssr_default \
  -v "$(pwd)/migrations:/migrations" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  golang:1.22-alpine \
  sh -c 'go install github.com/pressly/goose/v3/cmd/goose@v3.20.0 && \
    goose -dir /migrations postgres \
    "postgres://gssr:${POSTGRES_PASSWORD}@postgres:5432/gssr?sslmode=disable" up'
```

### Бэкап

```bash
docker compose -f infra/compose/docker-compose.mainpc.yml exec postgres \
  pg_dump -U gssr gssr | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Подключение к psql

```bash
docker compose -f infra/compose/docker-compose.mainpc.yml exec postgres \
  psql -U gssr gssr
```

## 6. Частые проблемы

### ISP сбрасывает TCP-соединения (~38 секунд)

**Провайдер**: Ростелеком. Убивает TCP-соединения примерно через 38 секунд. Upload ~400 B/s до Cloudflare.

**Решения**:
- HTTP/2 отключён — ISP убивает мультиплексированное соединение, роняя все запросы. С HTTP/1.1 каждый файл идёт по отдельному соединению.
- `cloudflared` (Argo Tunnel) не работает по той же причине.
- Cloudflare orange-cloud (DNS proxy) — единственный рабочий вариант.

### SSL Inspection (школа/корпоративная сеть)

Docker-контейнеры не могут скачать Go-модули через `go mod download` — прокси подменяет TLS-сертификат.

**Решение**: `go mod vendor` + `-mod=vendor` в Dockerfile. Все зависимости в репо.

### nginx не стартует

```bash
# Проверить конфиг
docker compose -f infra/compose/docker-compose.mainpc.yml exec nginx nginx -t

# Частые причины:
# - Отсутствуют SSL-сертификаты (infra/nginx/ssl/origin.pem + origin.key)
# - Upstream-контейнер не запущен (game/workers)
# - Ошибка в upstream.conf
```

### Контейнер в restart loop

```bash
# Посмотреть логи
docker compose -f infra/compose/docker-compose.mainpc.yml logs --tail=50 <service>

# Частые причины:
# - Отсутствует переменная окружения (panic: required env var not set)
# - Postgres ещё не healthy (depends_on с condition решает)
# - Неверный POSTGRES_URL/VALKEY_URL
```

## 7. Ротация секретов

1. Обновить секрет в **GitHub → Settings → Secrets and variables → Actions**
2. Запустить **Deploy to Main PC** workflow (workflow_dispatch)
3. CI перезапишет `infra/compose/.env` и пересоздаст контейнеры

Список секретов:
`POSTGRES_PASSWORD`, `RABBITMQ_PASS`, `MINIO_ROOT_PASSWORD`, `JWT_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GRAFANA_PASSWORD`, `ORIGIN_CERT`, `ORIGIN_KEY`, `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `MAINPC_SSH_HOST`, `MAINPC_SSH_KEY`

Переменные: `DOMAIN`
