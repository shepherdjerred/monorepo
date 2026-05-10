# TRMNL Dashboard

Bun stdlib HTTP service that exposes compact JSON payloads for TRMNL Private
Plugins.

## Endpoints

- `GET /livez` - process liveness
- `GET /healthz` - configuration health
- `GET /api/home` - Home Assistant status payload
- `GET /api/homelab` - homelab status payload

Protected endpoints require `x-api-key` to match `TRMNL_API_KEY`.

## TRMNL

Create two Private Plugins and configure polling headers:

```text
x-api-key={{ api_key | url_encode }}
```

Use the Liquid templates in `trmnl/`.
