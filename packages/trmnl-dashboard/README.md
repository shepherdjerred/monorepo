# TRMNL Dashboard

Bun stdlib HTTP service that exposes compact JSON payloads for TRMNL Private
Plugins.

## Endpoints

- `GET /livez` - process liveness
- `GET /healthz` - configuration health
- `GET /api/home` - Home Assistant status payload
- `GET /api/homelab` - homelab status payload
- `GET /metrics` - internal Prometheus metrics, including fresh LR5 diagnostics
- `GET /api/diagnostics` - per-source fetch diagnostics for both payloads

Protected endpoints require `x-api-key` to match `TRMNL_API_KEY`.

## Backing clients

Payloads are assembled from five clients in `src/clients/`: `alerts`,
`bugsink`, `home-assistant`, `kubernetes`, and `prometheus`.

Pet-care collection reads ordinary PetLibro and Roborock entities plus a
strictly validated Whisker diagnostics payload for LR5 and hopper data. It
discovers the Whisker config entry through Home Assistant's entity registry;
the internal ID and raw diagnostics are never returned or exported as labels.

## Configuration

`src/config.ts` validates the environment with Zod at startup. Required:
`TRMNL_API_KEY`, `HA_TOKEN`. Everything else has defaults:

- Server: `PORT` (3000), `DISPLAY_TIME_ZONE` (`America/Los_Angeles`)
- Home Assistant: `HA_URL`, `HA_BATTERY_THRESHOLD`,
  `HA_UNAVAILABLE_IGNORED_DOMAINS` (CSV), and `HA_PRESENCE_ENTITIES` /
  `HA_SECURITY_ENTITIES` / `HA_CLIMATE_ENTITIES` (CSV of
  `entity_id:label` pairs)
- Homelab: `PROMETHEUS_URL`, `ALERT_DASHBOARD_URL`, `BUGSINK_URL`,
  `BUGSINK_TOKEN` (optional), and Kubernetes API access via
  `KUBERNETES_API_URL` (or in-cluster `KUBERNETES_SERVICE_HOST`/`PORT`) plus
  `KUBERNETES_TOKEN_PATH` / `KUBERNETES_CA_PATH`

## Commands

```bash
bun run dev           # watch mode
bun run start
bun run test
bun run typecheck
bun run lint
bun run docker:build  # buildx image (monorepo-root context, tag trmnl-dashboard:dev)
bun run smoke         # boots the trmnl-dashboard:dev image and asserts a clean start
```

## TRMNL

Create two Private Plugins and configure polling headers:

```text
x-api-key={{ api_key | url_encode }}
```

Use the Liquid templates in `trmnl/`.
