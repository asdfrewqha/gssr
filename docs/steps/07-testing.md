# Step 7: Testing

## Goal

Run the full test suite: Go unit + integration tests, Python pytest, React Vitest, and Playwright E2E tests.

## Prerequisites

- All services running (Step 2 infra)
- Go 1.22+, Python 3.11+, Node.js 20+
- `testcontainers` requires Docker running

## Go Tests (services/game)

### Unit tests

```bash
cd services/game
go test ./... -race -v
```

### With coverage

```bash
go test ./... -race -coverprofile=coverage.out
go tool cover -func=coverage.out
# Minimum: 80% overall
```

### Integration tests (uses real containers)

```bash
go test ./integration/... -race -tags=integration -timeout=120s
# Spins up Postgres + Valkey via testcontainers-go
```

### Key test cases

| File | What it tests |
| --- | --- |
| `internal/auth/handler_test.go` | Register, login, duplicate username, wrong password |
| `internal/game/scoring_test.go` | Score=5000 at d=0, score=0 on floor mismatch, exponential decay |
| `internal/room/manager_test.go` | Create/join/leave room, state persists in Valkey |
| `internal/ws/hub_test.go` | Broadcast reaches all clients, disconnect cleans up |

## Python Tests (services/workers)

### Setup

```bash
cd services/workers
pip install -r requirements.txt
pip install pytest pytest-asyncio pytest-cov httpx moto factory-boy testcontainers
```

### Run

```bash
pytest --cov=app --cov-report=term-missing -v
# Minimum: 75% coverage
```

### Key test cases

| File | What it tests |
| --- | --- |
| `tests/test_api_maps.py` | Create map, add floor, list maps |
| `tests/test_api_panos.py` | Upload panorama triggers tiling + moderation tasks |
| `tests/test_tasks_tiling.py` | tile_panorama produces correct MinIO paths |
| `tests/test_tasks_moderation.py` | NSFW score above threshold → flagged |
| `tests/test_elo.py` | ELO formula: win increases rating, loss decreases |

## Frontend Tests (frontend/ and admin/)

### Run Vitest

```bash
cd frontend
npm run test           # watch mode
npm run test -- --run  # CI mode (no watch)
npm run test -- --coverage  # with coverage
```

```bash
cd admin
npm run test -- --run
```

## E2E Tests (Playwright)

### Setup

```bash
cd frontend   # or root, wherever playwright.config.ts lives
npx playwright install chromium
```

### Start test environment

```bash
docker compose -f infra/compose/docker-compose.test.yml up -d
# This uses test-specific env vars and an isolated DB
```

### Run Playwright

```bash
npx playwright test
npx playwright test --ui    # interactive mode
npx playwright test e2e/auth.spec.ts  # single spec
```

### Key E2E scenarios

| Spec | Scenario |
| --- | --- |
| `auth.spec.ts` | Register → login → see profile → logout → can't access protected page |
| `game.spec.ts` | Two players: create room → join → start → both submit guess → both see scores |
| `admin.spec.ts` | Admin uploads panorama → tiling completes → appears in frontend map |

### Teardown

```bash
docker compose -f infra/compose/docker-compose.test.yml down -v
```

## Quick Reference (root Makefile)

Run everything from the repo root — no need to `cd` into each service:

```bash
# All tests end-to-end (Go + Python + Vitest + Playwright)
make test

# Individual layers
make test-go        # go test ./... -race
make test-python    # pytest
make test-frontend  # vitest --run

# E2E only (brings up test stack, runs Playwright, tears down)
make e2e

# Manual test stack control
make test-up        # docker compose up -d --build + wait for migrate
make test-down      # docker compose down -v
```

## CI Integration

Tests run automatically on every PR via `.github/workflows/test.yml` (see Step 10).
E2E tests run after unit tests pass, using the test docker-compose.

## Troubleshooting

- **testcontainers "cannot connect to Docker"**: ensure Docker daemon is running and current user is in `docker` group
- **pytest "asyncio mode not set"**: add `asyncio_mode = "auto"` to `pyproject.toml` `[tool.pytest.ini_options]`
- **Playwright "browser not installed"**: run `npx playwright install chromium` before first run
- **E2E timeouts**: increase `timeout` in `playwright.config.ts`, check that docker-compose.test.yml services are healthy before tests start
