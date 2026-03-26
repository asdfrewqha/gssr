# GSSR Runbook

## 1. Архитектура

```
                   ┌─────────────┐
                   │  Cloudflare  │  (DNS proxy, Full Strict SSL)
                   └──────┬──────┘
                          │ :443 / :80
                   ┌──────▼──────┐
                   │    nginx    │  reverse proxy
                   └──────┬──────┘
          ┌───────────────┼───────────────┐
          │               │               │
   ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
   │  game:3000  │ │workers:8000 │ │ minio:9000  │
   │  (Go/Fiber) │ │ (FastAPI)   │ │    (S3)     │
   └──────┬──────┘ └──────┬──────┘ └─────────────┘
          │               │
   ┌──────┴──────┐ ┌──────┴──────┐
   │  postgres   │ │   celery    │
   │  valkey     │ │  rabbitmq   │
   └─────────────┘ └─────────────┘
```

### Сервисы и порты

| Сервис | Порт | Доступ | Описание |
|--------|------|--------|----------|
| nginx | 80, 443 | Публичный (Cloudflare) | Reverse proxy для всего |
| game | 3000 | Внутренний | Go Fiber — auth, game API, WebSocket, /metrics |
| workers | 8000 | Внутренний | FastAPI — admin API, /metrics |
| celery | — | — | Worker: tiling, NSFW-модерация, ELO |
| postgres | 5432 | Внутренний | PostgreSQL 16 |
| valkey | 6379 | Внутренний | Redis-совместимый (rooms, sessions, refresh tokens) |
| rabbitmq | 5672 / 15672 | SSH tunnel | Celery broker / management UI |
| minio | 9000 / 9001 | SSH tunnel | S3 хранилище / console |
| livekit | 7880 | Внутренний (через nginx) | WebRTC SFU (голосовой чат) |
| pgadmin | 5050 | SSH tunnel | PostgreSQL web UI |
| grafana | 3000→3001 | SSH tunnel | Мониторинг дашборды |
| prometheus | 9090 | Внутренний | Сбор метрик |
| loki | 3100 | Внутренний | Агрегация логов |
| portainer | 9000→9002 | SSH tunnel | Docker management UI |

### Zynq ARM ноды (backup)

5 нод (192.168.1.101–105) с контейнером `gssr-game` (linux/arm/v7). nginx балансирует на них как backup. Без нод — всё идёт на `game:3000` (Main PC).

---

## 2. Первоначальная настройка

### 2.1 Создание пользователя deploy на сервере

```bash
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG docker deploy
# Задать SSH-ключ:
sudo mkdir -p /home/deploy/.ssh
sudo sh -c 'echo "ssh-ed25519 AAAA... github-actions-mainpc" > /home/deploy/.ssh/authorized_keys'
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

### 2.2 Настройка SSH-порта

```bash
# /etc/ssh/sshd_config
Port 1337   # или любой другой нестандартный

sudo systemctl restart sshd
```

### 2.3 Генерация всех секретов

```bash
# Скопировать и запустить — выведет готовые значения:
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "RABBITMQ_PASS=$(openssl rand -hex 16)"
echo "MINIO_ROOT_PASSWORD=$(openssl rand -hex 16)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "LIVEKIT_API_KEY=$(openssl rand -hex 8)"
echo "LIVEKIT_API_SECRET=$(openssl rand -hex 24)"
echo "GRAFANA_PASSWORD=$(openssl rand -hex 12)"
echo "PGADMIN_PASSWORD=$(openssl rand -hex 12)"
```

### 2.4 Cloudflare Origin Certificate

1. Cloudflare Dashboard → SSL/TLS → Origin Server → Create Certificate
2. Хосты: `*.example.com`, `example.com` (wildcard + apex)
3. Скачать PEM-сертификат и приватный ключ
4. Закодировать в base64 (одна строка без переносов):

```bash
base64 -w0 origin-cert.pem    # → ORIGIN_CERT
base64 -w0 origin-key.pem     # → ORIGIN_KEY
```

### 2.5 SSH-ключ для CI

```bash
ssh-keygen -t ed25519 -C "github-actions-mainpc" -f ~/.ssh/gssr-deploy
# Публичный ключ → /home/deploy/.ssh/authorized_keys на сервере
# Приватный ключ → GitHub Secret MAINPC_SSH_KEY (вставить как есть)
```

---

## 3. GitHub Secrets & Variables

Все секреты добавляются в: **Repository → Settings → Secrets and variables → Actions**

### Secrets (зашифрованные, не видны в логах)

| Секрет | Генерация | Описание |
|--------|-----------|----------|
| `MAINPC_SSH_HOST` | IP/hostname | Публичный адрес Main PC |
| `MAINPC_SSH_PORT` | напр. `1337` | SSH-порт Main PC |
| `MAINPC_SSH_KEY` | `ssh-keygen -t ed25519` | Приватный ключ для deploy@mainpc |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | Пароль PostgreSQL |
| `RABBITMQ_PASS` | `openssl rand -hex 16` | Пароль RabbitMQ (user: gssr) |
| `MINIO_ROOT_PASSWORD` | `openssl rand -hex 16` | Пароль MinIO (user: gssr) |
| `JWT_SECRET` | `openssl rand -hex 32` | Общий JWT-секрет (game + workers) |
| `LIVEKIT_API_KEY` | `openssl rand -hex 8` | LiveKit API key |
| `LIVEKIT_API_SECRET` | `openssl rand -hex 24` | LiveKit API secret |
| `GRAFANA_PASSWORD` | любой пароль | Grafana admin пароль |
| `PGADMIN_PASSWORD` | любой пароль | pgAdmin пароль (email: admin@gssr.local) |
| `DOCKERHUB_USERNAME` | username | DockerHub логин |
| `DOCKERHUB_TOKEN` | hub.docker.com → Security | DockerHub access token |
| `ORIGIN_CERT` | `base64 -w0 cert.pem` | Cloudflare Origin Certificate (base64) |
| `ORIGIN_KEY` | `base64 -w0 key.pem` | Cloudflare Origin Key (base64) |
| `CLOUDFLARE_API_TOKEN` | CF Dashboard → API Tokens | Scope: Cloudflare Pages Edit |
| `CLOUDFLARE_ACCOUNT_ID` | CF Dashboard sidebar | Account ID |

### Variables (видны в логах)

| Переменная | Пример | Описание |
|------------|--------|----------|
| `DOMAIN` | `school.example.com` | Базовый домен (game.DOMAIN, admin.DOMAIN) |
| `VITE_API_URL` | `https://game.school.example.com` | Game API URL для frontend |
| `VITE_WS_URL` | `wss://game.school.example.com` | WebSocket URL |
| `VITE_MINIO_URL` | `https://s3.school.example.com` | MinIO public URL |
| `VITE_LIVEKIT_URL` | `wss://game.school.example.com/livekit` | LiveKit URL |
| `VITE_ADMIN_API_URL` | `https://game.school.example.com/api` | Admin API URL |

### Что CI делает с секретами

Deploy workflow (`deploy-mainpc.yml`):
1. SCP архив `infra/` + `migrations/` на сервер
2. SSH → генерирует `infra/compose/.env` из секретов (printf, safe для спецсимволов)
3. Декодирует Origin Certificate из base64 → `infra/nginx/ssl/`
4. Генерирует `livekit.yaml` из API-ключей
5. `docker compose pull` + `up -d --force-recreate`
6. Запускает goose-миграции

---

## 4. SSH доступ

```bash
# Подключение к серверу
ssh -p <SSH_PORT> deploy@<server-ip>

# SSH tunnel для ВСЕХ админских панелей (одна команда)
ssh -L 3001:localhost:3001 \
    -L 5050:localhost:5050 \
    -L 9001:localhost:9001 \
    -L 15672:localhost:15672 \
    -L 9002:localhost:9002 \
    -p <SSH_PORT> deploy@<server-ip>
```

После tunnel — открыть в браузере:

| Панель | URL | Логин |
|--------|-----|-------|
| Grafana | http://localhost:3001 | admin / `$GRAFANA_PASSWORD` |
| pgAdmin | http://localhost:5050 | admin@gssr.local / `$PGADMIN_PASSWORD` |
| MinIO Console | http://localhost:9001 | gssr / `$MINIO_ROOT_PASSWORD` |
| RabbitMQ | http://localhost:15672 | gssr / `$RABBITMQ_PASS` |
| Portainer | http://localhost:9002 | (задаётся при первом входе) |

### Настройка pgAdmin (первый раз)

1. Открыть http://localhost:5050
2. Add New Server:
   - Name: `gssr`
   - Host: `postgres` (Docker DNS)
   - Port: `5432`
   - Username: `gssr`
   - Password: значение `POSTGRES_PASSWORD`
   - Save password: да

---

## 5. Деплой

### Автоматический (CI)

Триггеры:
- Автоматически после `Build Game Service` / `Build Workers Service` на main
- Ручной запуск: GitHub Actions → Deploy to Main PC → Run workflow

Стратегия: `git archive → SCP → SSH: tar + .env + docker compose up`. Сервер не нуждается в git.

### Ручной (на сервере)

```bash
ssh -p <SSH_PORT> deploy@<server-ip>
cd /opt/gssr

# Обновить один сервис
docker compose -f infra/compose/docker-compose.mainpc.yml pull game
docker compose -f infra/compose/docker-compose.mainpc.yml \
  up -d --no-build --force-recreate game nginx

# Полный рестарт всех сервисов
docker compose -f infra/compose/docker-compose.mainpc.yml \
  up -d --no-build --force-recreate

# Посмотреть статус
docker compose -f infra/compose/docker-compose.mainpc.yml ps
```

### Алиас для удобства

Добавить в `/home/deploy/.bashrc` на сервере:

```bash
alias dc='docker compose -f /opt/gssr/infra/compose/docker-compose.mainpc.yml'
# Использование: dc ps, dc logs -f game, dc restart workers
```

---

## 6. Мониторинг

### Health endpoints (на сервере)

```bash
# Game service
curl -s http://localhost:3000/health    # {"status":"ok"}

# Workers
curl -s http://localhost:8000/health    # {"status":"ok"}

# Docker health
dc ps   # STATE = healthy/running
```

### Prometheus targets

Prometheus скрейпит метрики каждые 15 секунд:
- `game:3000/metrics` — Go Fiber метрики
- `workers:8000/metrics` — FastAPI метрики
- `cadvisor:8080` — метрики контейнеров
- `dockerhost:9100` — метрики хоста (node-exporter)
- `postgres-exporter:9187` — метрики PostgreSQL
- `rabbitmq:15692` — метрики RabbitMQ

Проверить targets: Grafana → Explore → Prometheus → вкладка "Status" → Targets.

### Логи

```bash
# Все сервисы (live)
dc logs -f

# Конкретный сервис (последние 100 строк)
dc logs --tail=100 game
dc logs --tail=100 workers
dc logs --tail=100 celery

# Loki (через Grafana) — Explore → Loki → {container_name="gssr-game-1"}
```

---

## 7. База данных

### Миграции

```bash
# На сервере
cd /opt/gssr
docker run --rm --network gssr_default \
  -v "$(pwd)/migrations:/migrations" \
  -e POSTGRES_PASSWORD="<password>" \
  golang:1.22-alpine \
  sh -c 'go install github.com/pressly/goose/v3/cmd/goose@v3.20.0 && \
    goose -dir /migrations postgres \
    "postgres://gssr:${POSTGRES_PASSWORD}@postgres:5432/gssr?sslmode=disable" up'
```

### Бэкап

```bash
# Создать бэкап
dc exec postgres pg_dump -U gssr gssr | gzip > ~/backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Восстановить из бэкапа
gunzip -c backup_20240101_120000.sql.gz | dc exec -T postgres psql -U gssr gssr
```

### Прямой доступ к psql

```bash
dc exec postgres psql -U gssr gssr
```

### Через pgAdmin

SSH tunnel → http://localhost:5050 (см. раздел 4).

---

## 8. Частые проблемы

### ISP сбрасывает TCP-соединения (~38 секунд)

**Провайдер**: Ростелеком. Убивает TCP-соединения через ~38 секунд. Upload ~400 B/s.

**Что сделано**:
- HTTP/2 отключён в nginx (ISP убивает мультиплексированное соединение → все запросы падают)
- `cloudflared` (Argo Tunnel) не работает — та же причина
- Cloudflare orange-cloud (DNS proxy) — единственный рабочий вариант

### SSL Inspection (школьная/корпоративная сеть)

Docker не может скачать Go-модули — прокси подменяет TLS-сертификат.

**Решение**: `go mod vendor` + `-mod=vendor` в Dockerfile. Зависимости в репо, сеть при сборке не нужна.

### nginx не стартует

```bash
dc exec nginx nginx -t

# Причины:
# - Нет SSL-сертов (infra/nginx/ssl/origin.pem + origin.key)
# - game/workers контейнер не запущен (upstream недоступен)
# - Ошибка синтаксиса в upstream.conf
```

### Контейнер в restart loop

```bash
dc logs --tail=50 <service>

# Причины:
# - panic: required env var not set: ... → проверить .env
# - postgres ещё не healthy → depends_on condition решает
# - Неверный POSTGRES_URL / VALKEY_URL
```

### Game показывает unhealthy

Healthcheck использует `wget` внутри контейнера. Если образ собран на `FROM scratch` (нет wget), healthcheck всегда fail. Образ должен быть `FROM alpine:3.20`.

```bash
# Проверить вручную:
dc exec game wget -qO- http://localhost:3000/health
```

### Grafana показывает "No data"

1. Проверить что prometheus запущен: `dc logs prometheus`
2. Проверить targets: SSH tunnel → http://localhost:3001 → Connections → Data Sources → Prometheus → Test
3. Если node-exporter не скрейпится — prometheus использует `dockerhost:host-gateway` для доступа к host network

---

## 9. Ротация секретов

1. Обновить секрет в **GitHub → Settings → Secrets and variables → Actions**
2. Запустить **Deploy to Main PC** workflow (workflow_dispatch)
3. CI перезапишет `infra/compose/.env` и пересоздаст контейнеры

> **Важно**: при смене `JWT_SECRET` все текущие сессии пользователей станут невалидными.
> При смене `POSTGRES_PASSWORD` нужно также обновить пароль в PostgreSQL вручную:
> ```bash
> dc exec postgres psql -U gssr -c "ALTER USER gssr PASSWORD 'new_password';"
> ```

---

## 10. Файловая структура проекта

```
gssr/
├── .github/
│   ├── workflows/
│   │   ├── build-game.yml          # Сборка Docker-образа game
│   │   ├── build-workers.yml       # Сборка Docker-образа workers
│   │   ├── deploy-mainpc.yml       # Деплой на Main PC
│   │   ├── deploy-zynq.yml         # Деплой на Zynq ноды
│   │   ├── deploy-frontend.yml     # Деплой frontend на CF Pages
│   │   └── deploy-admin.yml        # Деплой admin на CF Pages
│   └── secrets.example.env         # Шаблон GitHub Secrets
├── services/
│   ├── game/                       # Go Fiber — game API
│   └── workers/                    # Python FastAPI — admin API + Celery
├── frontend/                       # React + Vite — игровой UI
├── admin/                          # React + Vite — админ-панель
├── infra/
│   ├── compose/
│   │   ├── docker-compose.mainpc.yml   # Main PC stack
│   │   ├── docker-compose.zynq.yml     # Zynq node stack
│   │   ├── docker-compose.test.yml     # Test stack
│   │   └── .env                        # (gitignored, генерируется CI)
│   ├── nginx/
│   │   ├── nginx.conf
│   │   ├── upstream.conf
│   │   ├── proxy_params.conf
│   │   └── ssl/                        # (gitignored, генерируется CI)
│   └── monitoring/
│       ├── prometheus.yml
│       ├── loki.yml
│       ├── promtail.yml
│       └── grafana/provisioning/
├── migrations/                     # SQL-миграции (goose)
├── .env.example                    # Шаблон ВСЕХ переменных
└── Makefile                        # make dev, make lint, make test, etc.
```

---

## 11. Локальная разработка

### Требования

| Инструмент | Версия | Установка |
|------------|--------|-----------|
| Go | 1.22+ | [go.dev/dl](https://go.dev/dl/) |
| Python | 3.11+ | [python.org](https://www.python.org/downloads/) |
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) |
| Docker + Compose | 24+ / v2 | [docs.docker.com](https://docs.docker.com/get-docker/) |
| Make | любая | Windows: `choco install make` или `winget install GnuWin32.Make` |
| golangci-lint | 1.59+ | `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest` |
| pre-commit | 3.x | `pip install pre-commit` |

### Быстрый старт

```bash
# 1. Клонировать
git clone https://github.com/<org>/gssr.git && cd gssr

# 2. Скопировать переменные окружения
cp .env.example .env
# Отредактировать .env — задать пароли (для локалки подойдут любые)

# 3. Установить Go vendor-зависимости (один раз)
make vendor

# 4. Установить npm-зависимости
cd frontend && npm install && cd ..
cd admin && npm install && cd ..

# 5. Установить Python-зависимости
cd services/workers && pip install -r requirements.txt && cd ../..

# 6. Установить pre-commit хуки
pre-commit install

# 7. Запустить dev-стек (postgres, valkey, rabbitmq, minio, etc.)
make dev

# 8. Запустить миграции
make migrate-up DATABASE_URL=postgres://gssr:changeme@localhost:5432/gssr?sslmode=disable

# 9. Запустить сервисы для разработки (в разных терминалах)
cd services/game && go run ./cmd/server          # game :3000
cd services/workers && uvicorn app.main:app --port 8000 --reload  # workers :8000
cd frontend && npm run dev                        # frontend :5173
cd admin && npm run dev                           # admin :5174
```

### Полезные команды

```bash
make help           # Список всех make-targets
make lint           # Все линтеры (go + python + frontend + admin)
make fmt            # Авто-форматирование всего кода
make test-go        # Go тесты
make test-python    # Python тесты (pytest)
make test-frontend  # Vitest
make e2e            # Playwright E2E (поднимает test-стек)
make dev-down       # Остановить dev-стек

pre-commit run --all-files  # Запустить все pre-commit хуки
```

### Структура .env для локальной разработки

Минимальный `.env` для работы game service локально:

```env
POSTGRES_URL=postgres://gssr:changeme@localhost:5432/gssr?sslmode=disable
VALKEY_URL=redis://localhost:6379
JWT_SECRET=dev-secret-at-least-32-chars-long-for-hmac
CORS_ORIGINS=http://localhost:5173
```

Минимальный `.env` для workers:

```env
WORKERS_DATABASE_URL=postgresql+asyncpg://gssr:changeme@localhost:5432/gssr
RABBITMQ_URL=amqp://gssr:changeme@localhost:5672/
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=gssr
MINIO_SECRET_KEY=changeme
MINIO_BUCKET=gssr
ADMIN_CORS_ORIGINS=http://localhost:5174
ADMIN_JWT_SECRET=dev-secret-at-least-32-chars-long-for-hmac
NSFW_MODEL_PATH=models/nsfw.onnx
NSFW_THRESHOLD=0.7
```

Полный список переменных — см. `.env.example`.
