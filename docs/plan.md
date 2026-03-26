# GSSR: Runbook, Linting, Bug Fixes, Game on Main PC, Roadmap

## Context

Проект GSSR — полностью scaffolded, но реально реализованы только: auth (Go), scoring/ELO (Go+Python), Celery-таски (tiling/moderation/elo), мониторинг. Frontend и admin — пустые оболочки. Game API доступен только через Zynq-ноды (которых нет при разработке). Нет линтинга, pre-commit хуков, runbook'а.

Цель: привести проект в рабочее состояние — исправить баги, добавить качество кода, запустить game service на Main PC, написать runbook, и дать пошаговый план до рабочего продукта.

---

## Часть 0: Баг-фиксы

### Bug 1: `AdminRequired` выполняет handler ДО проверки isAdmin
**Файл**: `services/game/internal/auth/middleware.go:31-41`

`AdminRequired` вызывает `Required(secret)(c)`, внутри которого `c.Next()` запускает следующий handler. Handler выполняется, а проверка `isAdmin` происходит ПОСЛЕ. Плюс двойной вызов `c.Next()`.

**Исправление**: Выделить `parseAndStoreClaims()` helper без `c.Next()`, использовать в обоих middleware:

```go
func parseAndStoreClaims(c *fiber.Ctx, secret []byte) error {
    token := c.Cookies("access_token")
    if token == "" {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing token"})
    }
    claims, err := Verify(secret, token)
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid token"})
    }
    c.Locals(ctxUserID, claims.UserID)
    c.Locals(ctxIsAdmin, claims.IsAdmin)
    return nil
}

func Required(secret []byte) fiber.Handler {
    return func(c *fiber.Ctx) error {
        if err := parseAndStoreClaims(c, secret); err != nil {
            return err
        }
        return c.Next()
    }
}

func AdminRequired(secret []byte) fiber.Handler {
    return func(c *fiber.Ctx) error {
        if err := parseAndStoreClaims(c, secret); err != nil {
            return err
        }
        if !c.Locals(ctxIsAdmin).(bool) {
            return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "admin only"})
        }
        return c.Next()
    }
}
```

### Bug 2: Workers CORS захардкожен
**Файл**: `services/workers/app/main.py:11`

`allow_origins=["http://localhost:5174"]` — в проде всегда localhost. Нужно читать из env `ADMIN_CORS_ORIGINS` (уже пишется deploy-скриптом).

**Исправление**:
```python
import os
origins = os.getenv("ADMIN_CORS_ORIGINS", "http://localhost:5174").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins, ...)
```

### Bug 3: Metrics порт не используется
**Файл**: `services/game/cmd/server/main.go:65-67`

`config.MetricsPort` (2112) загружается но игнорируется — метрики регистрируются на порту 3000 (публичный API). Prometheus конфиг скрейпит :2112.

**Решение**: Убрать отдельный MetricsPort. Скрейпить /metrics на порту 3000 (проще, Prometheus всё равно внутри Docker-сети). Обновить prometheus.yml targets.

### Bug 4: Дублирование keepalive_timeout в nginx.conf
**Файл**: `infra/nginx/nginx.conf` — строка 18 `keepalive_timeout 65` и строка ~67 `keepalive_timeout 30`.

**Исправление**: Убрать строку 18, оставить 30.

---

## Часть 1: Game Service на Main PC

### Файлы:

**`infra/compose/docker-compose.mainpc.yml`** — добавить game service:
```yaml
game:
  image: ${DOCKERHUB_USERNAME}/gssr-game:latest
  restart: unless-stopped
  depends_on:
    postgres: { condition: service_healthy }
    valkey: { condition: service_started }
  env_file: .env
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://localhost:3000/health || exit 1"]
    interval: 30s
    timeout: 5s
    retries: 3
```

Добавить `game` в `nginx.depends_on`.

**`infra/nginx/upstream.conf`** — добавить `game:3000` как primary в upstream:
```nginx
upstream zynq_game {
    least_conn;
    server game:3000 max_fails=3 fail_timeout=30s;
    # Zynq ARM nodes (backup when available)
    server 192.168.1.101:3000 max_fails=3 fail_timeout=30s backup;
    server 192.168.1.102:3000 max_fails=3 fail_timeout=30s backup;
    server 192.168.1.103:3000 max_fails=3 fail_timeout=30s backup;
    server 192.168.1.104:3000 max_fails=3 fail_timeout=30s backup;
    server 192.168.1.105:3000 max_fails=3 fail_timeout=30s backup;
    keepalive 32;
}
```

**`infra/monitoring/prometheus.yml`** — добавить `game:3000` target (порт 3000, не 2112).

**`.github/workflows/deploy-mainpc.yml`** — добавить `game` в pull и up:
```bash
docker compose ... pull workers celery game
docker compose ... up -d --no-build --force-recreate workers celery game nginx
```

---

## Часть 2: Linting + Pre-commit

### Новые файлы:

| Файл | Содержание |
|------|-----------|
| `.editorconfig` | Единый стиль: LF, UTF-8, 2 spaces (tabs для Go/Makefile) |
| `.pre-commit-config.yaml` | trailing-whitespace, end-of-file-fixer, check-yaml, detect-private-key, golangci-lint, ruff, eslint, prettier |
| `services/game/.golangci.yml` | errcheck, govet, staticcheck, gosimple, misspell, gosec, bodyclose; exclude vendor/ |
| `services/workers/ruff.toml` | py311, line-length=120, select E/F/W/I/N/UP/B/SIM |
| `frontend/.eslintrc.cjs` | @typescript-eslint/recommended + react-hooks + prettier |
| `frontend/.prettierrc` | semi:false, singleQuote, trailingComma:all, printWidth:120 |
| `admin/.eslintrc.cjs` | то же что frontend |
| `admin/.prettierrc` | то же что frontend |

### NPM dev-deps (frontend + admin):
```
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-plugin-react-hooks eslint-plugin-react-refresh eslint-config-prettier prettier
```

### Makefile updates:
- Добавить targets: `lint-frontend`, `lint-admin`, `fmt`
- Обновить `lint:` → `lint-go lint-python lint-frontend lint-admin`

---

## Часть 3: Runbook (`docs/runbook.md`)

Секции:
1. **Архитектура** — сервисы, порты, сетевая топология
2. **SSH доступ** — Main PC, SSH tunnel для админских панелей:
   ```
   ssh -L 3001:localhost:3001 -L 9001:localhost:9001 \
       -L 15672:localhost:15672 -L 9002:localhost:9002 \
       -p 1337 deploy@<server-ip>
   ```
   Порты: grafana:3001, minio-console:9001, rabbitmq:15672, portainer:9002
3. **Деплой** — ручной через GH Actions (`workflow_dispatch`), full stack, Zynq
4. **Мониторинг** — Grafana через tunnel, docker logs, health endpoints
5. **БД операции** — миграции, бэкап, подключение к psql
6. **Частые проблемы** — ISP resets (~38s), SSL inspection, nginx не стартует
7. **Ротация секретов** — обновить в GH Secrets → trigger full deploy

---

## Часть 4: Roadmap до рабочего продукта

### Фаза 1 — Core Game Backend

| # | Задача | Файлы | Описание |
|---|--------|-------|----------|
| 1 | Map/Floor/Panorama CRUD | `services/game/internal/handlers/maps.go`, `floors.go`, `panoramas.go` | REST API для создания карт, этажей, получения панорам. Wire в `cmd/server/main.go` |
| 2 | Room management | `services/game/internal/handlers/rooms.go`, `internal/room/manager.go` | Создание/присоединение к комнате (6-char код), состояние в Valkey с TTL. Endpoints: POST /api/rooms, POST /api/rooms/:code/join, POST /api/rooms/:code/start |
| 3 | WebSocket integration | `services/game/internal/handlers/ws_handler.go` | Подключить существующий `ws.Hub` к Fiber через `gofiber/websocket/v2`. События: player_joined/left, round_start, player_guessed, round_results, game_over |
| 4 | Guess + Scoring | `services/game/internal/handlers/guess.go`, `internal/game/round.go` | Приём догадок через WS, `CalculateScore()` (уже реализован), сохранение в `guesses`, таймер раундов, dispatch `recalculate_elo` через HTTP к workers |

### Фаза 2 — Workers Admin API

| # | Задача | Файлы |
|---|--------|-------|
| 5 | Завершить admin_maps.py | Async DB (asyncpg), CRUD для maps + floors + загрузка изображений в MinIO |
| 6 | Завершить admin_panos.py | Upload панорам → MinIO raw/ → dispatch tiling + moderation Celery tasks |
| 7 | Завершить admin_users.py | Список юзеров, бан/разбан, статистика |
| 8 | Admin auth middleware | JWT verification (тот же `JWT_SECRET` / `ADMIN_JWT_SECRET` что в game service) |

### Фаза 3 — Frontend

| # | Задача | Компоненты |
|---|--------|-----------|
| 9 | Auth страницы | `Login.tsx`, `Register.tsx`, `AuthGuard.tsx`, React Router setup в `App.tsx` |
| 10 | Лобби + комнаты | `Lobby.tsx` (создать/войти в комнату), `Room.tsx` (ожидание, список игроков, кнопка старта для хоста) |
| 11 | Игровой экран | `PanoViewer.tsx` (Marzipano equirectangular), `GuessMap.tsx` (Leaflet L.CRS.Simple с оверлеем плана этажа), `FloorSelector.tsx` |
| 12 | Результаты | `RoundResults.tsx` (позиции догадок, дистанция, очки), `GameOver.tsx` (финальный скорборд, изменение ELO) |

### Фаза 4 — Admin Panel

| # | Задача |
|---|--------|
| 13 | `Dashboard.tsx` (статистика из /admin/stats), `Maps.tsx` (CRUD карт, загрузка этажей/панорам), `Users.tsx` (список, бан/разбан), `Moderation.tsx` (одобрение/отклонение панорам) |

### Фаза 5 — Polish

| # | Задача |
|---|--------|
| 14 | LiveKit голосовой чат — генерация токенов в game service, `@livekit/components-react` в Room.tsx |
| 15 | E2E тесты с реальным UI (Playwright) — расширить auth.spec.ts и game.spec.ts |
| 16 | Нагрузочное тестирование (k6/artillery), тюнинг rate limits, пулов соединений, WebSocket concurrency |

---

## Порядок реализации (ближайшая сессия)

1. **Баг-фиксы** (middleware, CORS, keepalive, metrics) — отдельный коммит
2. **Game service на Main PC** (compose, upstream, prometheus, deploy) — отдельный коммит
3. **Linting + pre-commit** (configs, npm deps, Makefile) — отдельный коммит
4. **Runbook** (`docs/runbook.md`) — отдельный коммит

---

## Verification

- `make lint` — все линтеры проходят без ошибок
- `docker compose -f infra/compose/docker-compose.mainpc.yml config` — валидный compose
- `nginx -t` (внутри контейнера) — конфиг валиден
- `curl http://localhost:3000/health` — game service отвечает (после деплоя)
- `pre-commit run --all-files` — все хуки проходят
