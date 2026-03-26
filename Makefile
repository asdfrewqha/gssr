# GSSR — root Makefile
# Convenience targets for local development and testing
# Requires: docker, docker compose, go 1.22+, python 3.11+, node 20+

COMPOSE_TEST := docker compose -f infra/compose/docker-compose.test.yml
COMPOSE_DEV  := docker compose -f infra/compose/docker-compose.mainpc.yml

.PHONY: help dev dev-down test test-go test-python test-frontend e2e \
        test-up test-down lint lint-go lint-python lint-frontend lint-admin fmt migrate-up migrate-reset vendor

# ─────────────────────────────────────────────
# Help
# ─────────────────────────────────────────────
help:
	@echo ""
	@echo "GSSR local targets:"
	@echo ""
	@echo "  Development"
	@echo "    make dev          — start full dev stack (Main PC services)"
	@echo "    make dev-down     — stop dev stack"
	@echo ""
	@echo "  Testing"
	@echo "    make test         — run ALL tests (Go + Python + Vitest + Playwright)"
	@echo "    make test-go      — run Go unit + integration tests"
	@echo "    make test-python  — run Python unit tests (pytest)"
	@echo "    make test-frontend— run Vitest unit tests"
	@echo "    make e2e          — start test stack + Playwright + teardown"
	@echo ""
	@echo "  Test infrastructure"
	@echo "    make test-up      — start isolated test docker-compose stack"
	@echo "    make test-down    — stop and remove test stack volumes"
	@echo ""
	@echo "  Database"
	@echo "    make migrate-up   — run goose migrations against dev postgres"
	@echo "    make migrate-reset— rollback all dev migrations (destructive)"
	@echo ""
	@echo "  Setup"
	@echo "    make vendor       — go mod vendor (run once before make test-up)"
	@echo ""
	@echo "  Linting"
	@echo "    make lint         — run all linters"
	@echo "    make lint-go      — golangci-lint on services/game"
	@echo "    make lint-python  — ruff + mypy on services/workers"
	@echo "    make lint-frontend— eslint on frontend"
	@echo "    make lint-admin   — eslint on admin"
	@echo "    make fmt          — auto-format all code"

# ─────────────────────────────────────────────
# Development stack
# ─────────────────────────────────────────────
dev:
	$(COMPOSE_DEV) up -d
	@echo "Dev stack is up. API → http://localhost:80"

dev-down:
	$(COMPOSE_DEV) down

# ─────────────────────────────────────────────
# Test infrastructure
# ─────────────────────────────────────────────
test-up:
	$(COMPOSE_TEST) up -d --build
	@echo "Waiting for test services to become healthy..."
	$(COMPOSE_TEST) wait migrate
	@echo "Test stack ready."

test-down:
	$(COMPOSE_TEST) down -v

# ─────────────────────────────────────────────
# Unit / integration tests (no docker needed)
# ─────────────────────────────────────────────
test-go:
	@echo "==> Go tests"
	cd services/game && go test ./... -race -count=1 -timeout=120s

test-python:
	@echo "==> Python tests"
	cd services/workers && python -m pytest tests/ -v --tb=short

test-frontend:
	@echo "==> Vitest"
	cd frontend && npm test -- --run

# ─────────────────────────────────────────────
# E2E (Playwright against test stack)
# ─────────────────────────────────────────────
e2e: test-up
	@echo "==> Playwright E2E"
	cd frontend && npx playwright test
	$(MAKE) test-down

# ─────────────────────────────────────────────
# Full test suite
# ─────────────────────────────────────────────
test: test-go test-python test-frontend e2e
	@echo ""
	@echo "All tests passed."

# ─────────────────────────────────────────────
# Setup — vendor Go dependencies (run once)
# ─────────────────────────────────────────────
vendor:
	@echo "==> go mod vendor"
	cd services/game && go mod vendor
	@echo "vendor/ created. Commit it to git so Docker builds don't need network."

# ─────────────────────────────────────────────
# Migrations (dev postgres on 5432)
# Uses a local golang container to run goose — no ghcr.io needed.
# ─────────────────────────────────────────────
GOOSE_RUN := docker run --rm --network host \
	-v $(PWD)/migrations:/migrations \
	-e GOPATH=/tmp/go \
	-e GOMODCACHE=/tmp/gomod \
	-v goose-bin:/tmp/go \
	golang:1.22-alpine \
	sh -c "go install github.com/pressly/goose/v3/cmd/goose@v3.20.0 && goose -dir /migrations postgres"

migrate-up:
	$(GOOSE_RUN) "$(DATABASE_URL)" up

migrate-reset:
	@echo "WARNING: this will drop all tables."
	$(GOOSE_RUN) "$(DATABASE_URL)" reset

# ─────────────────────────────────────────────
# Linting
# ─────────────────────────────────────────────
lint: lint-go lint-python lint-frontend lint-admin

lint-go:
	cd services/game && golangci-lint run ./...

lint-python:
	cd services/workers && ruff check app/ && mypy app/

lint-frontend:
	cd frontend && npx eslint src/ --ext .ts,.tsx

lint-admin:
	cd admin && npx eslint src/ --ext .ts,.tsx

# ─────────────────────────────────────────────
# Formatting
# ─────────────────────────────────────────────
fmt:
	cd services/game && gofmt -w -s .
	cd services/workers && ruff format app/
	cd frontend && npx prettier --write src/
	cd admin && npx prettier --write src/
