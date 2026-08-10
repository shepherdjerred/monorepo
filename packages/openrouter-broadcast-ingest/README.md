# OpenRouter Broadcast ingest

Authenticated OTLP/HTTP JSON webhook for OpenRouter Broadcast. It preserves the
repository's existing observability boundary:

1. accept only `POST` or `PUT` JSON on `/v1/traces` with the dedicated bearer
   token;
2. reject malformed or oversized OTLP before persistence;
3. redact secrets and archive the complete payload in the private LLM
   SeaweedFS bucket;
4. strip prompt, response, tool, content, and credential attributes;
5. forward the correlated slim payload to Tempo;
6. write a digest receipt and return `204` only after every step succeeds.

The digest receipt is independent of the payload's UTC date partition, so an
OpenRouter retry remains idempotent across midnight. A failed Tempo forward
keeps the archived payload but no receipt; the subsequent delivery retries only
the forward and receipt steps.

## Configuration

Copy `.env.example` for local execution. Production uses two 1Password items:
the dedicated `openrouter-broadcast-ingest` item for
`OPENROUTER_BROADCAST_BEARER_TOKEN`, and the existing SeaweedFS credentials
item. The bearer token must be at least 32 characters and must be configured as
the OpenRouter Broadcast webhook's `Authorization: Bearer ...` value.

The application serves `/livez`, `/readyz`, and `/v1/traces` on `PORT` (3000
by default). Prometheus metrics are isolated on `METRICS_PORT` (9090 by
default). Prompt bodies and credentials never appear in logs or Prometheus
labels.

```bash
bun run typecheck
bun run test
bun run lint
bun run docker:build
```

## Deployment and canary

The CDK8s chart exposes `openrouter-broadcast.sjer.red` through Cloudflare,
restricts pod ingress and egress with a NetworkPolicy, and forwards internally
to Tempo and SeaweedFS. Before releasing the chart:

1. publish the first GHCR image publicly and replace the bootstrap image digest;
2. create the dedicated 1Password item and refresh the checked secret snapshot;
3. deploy this service before migrating consumers;
4. use OpenRouter's connection test and then send one real generation;
5. verify a payload object and digest receipt in the private archive, a
   body-free correlated trace in Tempo, success metrics in Prometheus, and
   body-free structured logs in Loki.

The `OpenRouterBroadcastPipelineFailure` and
`OpenRouterBroadcastTargetDown` alerts plus the AI Provider dashboard are the
operator-facing health surfaces. Do not acknowledge a canary from source or
pod health alone: archival and Tempo forwarding must both be observed.
