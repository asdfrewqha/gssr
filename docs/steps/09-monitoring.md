# Step 9: Monitoring (Prometheus + Grafana + Loki)

## Goal

Set up metrics collection, log aggregation, and pre-provisioned dashboards for all services.

## Prerequisites

- Step 2 (infra) running — monitoring services started with docker-compose
- Step 3 (game service) — exposes `/metrics` at port 2112
- Step 4 (worker service) — exposes `/metrics` at port 8000

## Steps

### 1. Verify Prometheus is scraping

```bash
curl http://localhost:9090/api/v1/targets
# All targets should show "state":"up"
```

If a target is down, check the service is running and the port is correct in `infra/monitoring/prometheus.yml`.

### 2. Open Grafana

Navigate to `http://localhost:3000` (or `https://grafana.school.example.com`).

- Default login: `admin` / value of `GRAFANA_PASSWORD` env var
- Change password on first login

### 3. Verify datasources

Go to **Configuration → Data Sources**. You should see:

- **Prometheus** → `http://prometheus:9090` → Status: OK
- **Loki** → `http://loki:3100` → Status: OK

These are auto-provisioned from `infra/monitoring/grafana/provisioning/datasources/`.

### 4. Import dashboards

Dashboards are auto-provisioned from `infra/monitoring/grafana/provisioning/dashboards/`. They appear under **Dashboards → Browse**.

| Dashboard | Description |
| --- | --- |
| Game Engine | HTTP request rate, WS connections, scoring latency |
| Workers | Celery queue depth, tiling duration, NSFW check rate |
| Infrastructure | CPU/RAM per container, disk I/O, Postgres connections |
| Logs | Loki log explorer for all containers |

If dashboards don't appear: restart Grafana container (`docker restart gssr_grafana_1`).

### 5. Set up alerts (optional)

In Grafana → **Alerting → Alert rules → New alert rule**:

Suggested alerts:

- Zynq node down: `up{job="game"} == 0` for 2 minutes
- Celery queue backlog: `celery_tasks_queued > 50` for 5 minutes
- Postgres connections near limit: `pg_stat_activity_count > 80`
- High error rate: `rate(http_requests_total{status=~"5.."}[5m]) > 0.1`

Send alerts to email or a Telegram bot via Grafana notification channels.

## Prometheus Targets Summary

| Target | Endpoint | Metrics |
| --- | --- | --- |
| Game service | `game:2112/metrics` | HTTP requests, WS connections, Go runtime |
| Workers | `workers:8000/metrics` | HTTP requests, task durations |
| cAdvisor | `cadvisor:8080/metrics` | Container CPU/RAM/network |
| Node Exporter | `node-exporter:9100/metrics` | Host CPU/RAM/disk |
| Postgres | `postgres-exporter:9187/metrics` | DB connections, query times |
| RabbitMQ | `rabbitmq:15692/metrics` | Queue depth, message rates |

## Log Aggregation (Loki + Promtail)

Promtail collects logs from all Docker containers via `/var/lib/docker/containers/`.
Labels applied automatically: `container_name`, `compose_service`.

Query examples in Grafana Explore (Loki datasource):

```logql
{compose_service="workers"} |= "ERROR"
{compose_service="game"} | json | level="error"
{compose_service="celery"} |= "tile_panorama" | json
```

## Verification

1. Open Grafana → Infrastructure dashboard → containers visible with CPU/RAM graphs
2. Make a few API calls to game service → HTTP request metrics appear in Game Engine dashboard
3. Upload a panorama → Celery task duration metric appears in Workers dashboard
4. Open Grafana Explore → Loki → select `compose_service=workers` → logs streaming

## Troubleshooting

- **No metrics from game service**: check Prometheus target status; ensure game service container is on the same Docker network (`gssr_default`)
- **Loki "no logs"**: check Promtail container is running; verify `/var/lib/docker/containers` is mounted correctly
- **Grafana "datasource not found"**: provisioning YAML has wrong URL — must use Docker service names (`prometheus:9090`), not `localhost`
