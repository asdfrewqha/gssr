# Step 8: Cloudflare Tunnel + Access

## Goal

Expose the game, admin panel, MinIO S3 console, Grafana, Portainer, and RabbitMQ management externally via Cloudflare Tunnel with Zero Trust Access protection. No open router ports required.

## Prerequisites

- Cloudflare account with a domain added
- Cloudflare Zero Trust enabled (free tier supports up to 50 users)
- Step 2 (infra) running on Main PC

## Steps

### 1. Create a Cloudflare Tunnel

In [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com):

1. **Networks → Tunnels → Create tunnel**
2. Name: `gssr-mainpc`
3. Save the tunnel token shown — add it to `infra/cloudflare/config.yml`

### 2. Configure tunnel routes

Edit `infra/cloudflare/config.yml`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /etc/cf/credentials.json

ingress:
  - hostname: game.school.example.com
    service: http://nginx:80

  - hostname: admin.school.example.com
    service: http://nginx:80

  - hostname: s3.school.example.com
    service: http://minio:9001

  - hostname: grafana.school.example.com
    service: http://grafana:3000

  - hostname: mq.school.example.com
    service: http://rabbitmq:15672

  - hostname: portainer.school.example.com
    service: http://portainer:9000

  - service: http_status:404
```

### 3. Add DNS records

In Cloudflare DNS dashboard, add CNAME records pointing to the tunnel:

| Name | Type | Target |
| --- | --- | --- |
| game | CNAME | `<tunnel-id>.cfargotunnel.com` |
| admin | CNAME | same |
| s3 | CNAME | same |
| grafana | CNAME | same |
| mq | CNAME | same |
| portainer | CNAME | same |

All records: Proxied (orange cloud).

### 4. Create Cloudflare Access Applications

In **Zero Trust → Access → Applications → Add application → Self-hosted**:

For each protected hostname (admin, s3, grafana, mq, portainer):

- **Application name**: e.g., `GSSR Admin`
- **Domain**: `admin.school.example.com`
- **Session duration**: 8 hours
- **Policy**:
  - Rule name: `School staff`
  - Action: `Allow`
  - Include: Emails ending in `@school.example.com`
    (or specific email list for smaller deployments)

`game.school.example.com` — **no Access policy** (public game).

### 5. Start the tunnel

```bash
cd infra/compose
docker compose -f docker-compose.mainpc.yml up -d cloudflared
docker logs gssr_cloudflared_1
# Should show: "Connection registered" for all configured hostnames
```

## Access Flow for Admin Users

1. Admin opens `https://admin.school.example.com`
2. Cloudflare Access intercepts → shows login prompt
3. Admin enters email → receives one-time link
4. Clicks link → redirected to admin panel with session cookie (valid 8h)
5. No VPN, no port forwarding, no static IP needed

## Service Token (for automation)

For CI/CD or monitoring agents that need to call protected URLs:

1. **Access → Service Auth → Create Service Token**
2. Add header to requests: `CF-Access-Client-Id: <id>` and `CF-Access-Client-Secret: <secret>`

## Verification

```bash
# Public endpoint (no Access)
curl https://game.school.example.com/health
# → {"status":"ok"}

# Protected endpoint without auth (should be blocked)
curl https://grafana.school.example.com
# → Cloudflare Access login page (302 redirect)

# Protected endpoint with service token
curl https://grafana.school.example.com \
  -H "CF-Access-Client-Id: <id>" \
  -H "CF-Access-Client-Secret: <secret>"
# → Grafana login page (200)
```

## Troubleshooting

- **"Bad gateway"**: the tunnel is up but the target service isn't running. Check `docker ps` on Main PC
- **"CNAME invalid"**: Cloudflare DNS CNAME not propagated yet — wait up to 5 minutes
- **Access keeps re-asking for email**: session cookie blocked. Check browser settings; Access cookies require `SameSite=None; Secure`
- **Tunnel disconnected**: check `docker logs gssr_cloudflared_1`; common cause is Docker network name mismatch
