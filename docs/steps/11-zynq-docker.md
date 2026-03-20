# Step 11: Deploying to Zynq Nodes (Docker or Bare Binary)

## Goal

Deploy the Go game service to all 5 Zynq ARM nodes using either Docker (preferred) or a static bare binary (fallback for OpenWrt environments).

## Prerequisites

- Step 3 (game service) built and tested
- Zynq nodes reachable over LAN
- Main PC services running (Valkey, Postgres accessible from Zynq)

## Environment Variables on Each Zynq

Create `/opt/gssr/.env.zynq` on each node:

```bash
POSTGRES_URL=postgres://gssr:<password>@<MAINPC_LAN_IP>:5432/gssr
VALKEY_URL=redis://<MAINPC_LAN_IP>:6379
JWT_SECRET=<same-secret-as-all-nodes>
LIVEKIT_URL=ws://<MAINPC_LAN_IP>:7880
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
PORT=3000
```

> All Zynq nodes must share the **same JWT_SECRET** — tokens issued by one node must be verified by others.

## Option A: Docker Deployment (preferred if Docker available)

### Check Docker on Zynq

```bash
ssh deploy@zynq1 "docker version"
```

If Docker is not installed:

```bash
# On Zynq (Debian/Ubuntu ARM)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker deploy
```

### First-time setup on each Zynq

```bash
scp infra/compose/docker-compose.zynq.yml deploy@zynq1:/opt/gssr/
scp infra/zynq/.env.zynq deploy@zynq1:/opt/gssr/.env

ssh deploy@zynq1 "cd /opt/gssr && docker compose -f docker-compose.zynq.yml up -d"
```

### Manual update

```bash
ssh deploy@zynq1 "cd /opt/gssr && docker compose pull && docker compose up -d --no-build"
```

## Option B: Bare Binary Deployment (OpenWrt or minimal Linux)

### Build ARM binary locally

```bash
cd services/game
make build-arm
# Output: dist/game-server-arm
# Built with: CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7
# Single static binary, no runtime dependencies, ~15MB
```

### Deploy to Zynq

```bash
scp dist/game-server-arm deploy@zynq1:/opt/gssr/game-server
ssh deploy@zynq1 "chmod +x /opt/gssr/game-server && systemctl restart gssr-game"
```

### systemd service file (`/etc/systemd/system/gssr-game.service`)

```ini
[Unit]
Description=GSSR Game Engine
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/gssr
EnvironmentFile=/opt/gssr/.env.zynq
ExecStart=/opt/gssr/game-server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable on first deploy:

```bash
ssh deploy@zynq1 "sudo systemctl enable gssr-game && sudo systemctl start gssr-game"
```

## Scripted Deployment (all 5 nodes)

```bash
# infra/zynq/deploy.sh
#!/bin/bash
NODES=("zynq1" "zynq2" "zynq3" "zynq4" "zynq5")
BINARY="dist/game-server-arm"

for node in "${NODES[@]}"; do
  echo "Deploying to $node..."
  scp "$BINARY" "deploy@$node:/opt/gssr/game-server"
  ssh "deploy@$node" "systemctl restart gssr-game"
  echo "$node: done"
done
```

## Nginx Load Balancer Update

When adding/removing Zynq nodes, update `infra/nginx/upstream.conf`:

```nginx
upstream zynq_game {
    least_conn;
    server 192.168.1.101:3000;
    server 192.168.1.102:3000;
    server 192.168.1.103:3000;
    server 192.168.1.104:3000;
    server 192.168.1.105:3000;
}
```

Reload Nginx without downtime:

```bash
docker exec gssr_nginx_1 nginx -s reload
```

## Verification

```bash
# From Main PC — check all nodes
for i in 1 2 3 4 5; do
  echo -n "zynq$i: "
  curl -s http://zynq$i:3000/health | jq .status
done
# → "ok" for all nodes

# Check Nginx is balancing correctly
for i in {1..10}; do curl -s https://game.school.example.com/health; done
```

## Troubleshooting

- **Binary won't run on Zynq**: verify `GOARCH=arm GOARM=7` — Zynq is ARMv7. Check with `uname -m` on the node
- **"Permission denied"**: ensure deploy user owns `/opt/gssr/` and binary is `chmod +x`
- **Connection to Postgres refused**: Main PC firewall may block Zynq LAN IPs — allow port 5432 from Zynq subnet
- **JWT validation fails on some nodes**: all nodes must have identical `JWT_SECRET` — verify with `echo $JWT_SECRET` on each
