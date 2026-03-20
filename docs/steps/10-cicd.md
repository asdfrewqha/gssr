# Step 10: CI/CD (GitHub Actions + DockerHub)

## Goal

Automate building multi-arch Docker images, running tests, deploying to Main PC, and deploying frontends to Cloudflare Pages on every push to `main`.

## Prerequisites

- GitHub repository set up
- DockerHub account
- Cloudflare Pages projects created (`gssr-frontend` and `gssr-admin`)
- SSH access to Main PC configured
- SSH access to Zynq nodes configured

## Required GitHub Secrets

Go to **Repository → Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Description |
| --- | --- |
| `DOCKERHUB_USERNAME` | DockerHub username |
| `DOCKERHUB_TOKEN` | DockerHub access token (not password) |
| `CLOUDFLARE_API_TOKEN` | CF token with Pages:Edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `MAINPC_SSH_HOST` | IP or hostname of Main PC (via Cloudflare Tunnel or VPN) |
| `MAINPC_SSH_KEY` | Private SSH key for Main PC deploy user |
| `ZYNQ1_HOST` through `ZYNQ5_HOST` | IP addresses of Zynq nodes |
| `ZYNQ_SSH_KEY` | Shared SSH private key for Zynq nodes |
| `DATABASE_URL` | Postgres connection string for migration step |

## Workflow Overview

```text
push to main
├── test.yml              → run all tests (go, pytest, vitest, playwright)
├── build-game.yml        → build linux/amd64 + linux/arm/v7 Docker image → DockerHub
├── build-workers.yml     → build linux/amd64 Docker image → DockerHub
├── deploy-frontend.yml   → build React → Cloudflare Pages (gssr-frontend)
├── deploy-admin.yml      → build React → Cloudflare Pages (gssr-admin)
├── deploy-mainpc.yml     → SSH to Main PC → docker-compose pull + up + migrations
└── deploy-zynq.yml       → SSH to each Zynq → docker pull + restart (or SCP binary)
```

`deploy-mainpc.yml` and `deploy-zynq.yml` trigger only after their respective build workflows complete successfully (`workflow_run` trigger).

## Workflow Files

### `.github/workflows/test.yml`

Runs on: `pull_request`, `push` to `main`

Jobs:

1. `test-game`: `go test ./... -race -coverprofile=coverage.out`
2. `test-workers`: `pytest --cov=app --cov-fail-under=75`
3. `test-frontend`: `npm run test -- --run --coverage`
4. `e2e`: needs all above → spins up `docker-compose.test.yml` → `npx playwright test`

### `.github/workflows/build-game.yml`

Runs on: `push` to `main` (path `services/game/**`), or tag `game/v*`

Key steps:

```yaml
- uses: docker/setup-qemu-action@v3      # arm/v7 emulation
- uses: docker/setup-buildx-action@v3
- uses: docker/login-action@v3
  with: {username: ${{ secrets.DOCKERHUB_USERNAME }}, password: ${{ secrets.DOCKERHUB_TOKEN }}}
- uses: docker/build-push-action@v5
  with:
    context: services/game
    platforms: linux/amd64,linux/arm/v7
    push: true
    tags: |
      ${{ secrets.DOCKERHUB_USERNAME }}/gssr-game:latest
      ${{ secrets.DOCKERHUB_USERNAME }}/gssr-game:${{ github.sha }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

Build time estimate: ~8 min (arm/v7 emulation via QEMU).

### `.github/workflows/deploy-mainpc.yml`

Runs on: `workflow_run` (build-game + build-workers completed successfully)

```yaml
- uses: appleboy/ssh-action@v1
  with:
    host: ${{ secrets.MAINPC_SSH_HOST }}
    username: deploy
    key: ${{ secrets.MAINPC_SSH_KEY }}
    script: |
      cd /opt/gssr
      docker compose -f docker-compose.mainpc.yml pull
      docker compose -f docker-compose.mainpc.yml up -d --no-build
      docker run --rm --network gssr_default \
        -e DATABASE_URL="${{ secrets.DATABASE_URL }}" \
        ghcr.io/pressly/goose:latest \
        postgres "${{ secrets.DATABASE_URL }}" up
```

### `.github/workflows/deploy-zynq.yml`

Matrix strategy over 5 nodes. Each node:

```yaml
# Try Docker first, fallback to bare binary
docker pull user/gssr-game:latest && \
docker compose -f docker-compose.zynq.yml up -d --no-build || \
scp dist/game-server-arm deploy@zynq_host:/opt/gssr/game-server && \
ssh deploy@zynq_host "systemctl restart gssr-game"
```

## Main PC Deploy User Setup

```bash
# On Main PC, create deploy user
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG docker deploy

# Create /opt/gssr with docker-compose file
sudo mkdir -p /opt/gssr
sudo chown deploy:deploy /opt/gssr
# Copy docker-compose.mainpc.yml and .env there

# Add deploy SSH public key
sudo -u deploy mkdir ~/.ssh
echo "<github-actions-public-key>" >> /home/deploy/.ssh/authorized_keys
```

## Verification

1. Push a small change to `services/game/` → CI triggers → check Actions tab
2. After ~10 minutes: DockerHub shows new `gssr-game:latest` tag
3. Main PC: `docker ps` shows new container ID
4. Zynq: game service still responds at `http://zynq1:3000/health`

## Troubleshooting

- **QEMU build times out**: increase `timeout-minutes` in the workflow; arm/v7 builds are slow
- **SSH deploy fails "host key verification"**: add `StrictHostKeyChecking=no` to the SSH action or pre-populate `known_hosts`
- **Cloudflare Pages deploy fails**: verify `CLOUDFLARE_API_TOKEN` has `Cloudflare Pages: Edit` permission
- **Migration fails on deploy**: check `DATABASE_URL` secret is accessible from Main PC's Docker network
