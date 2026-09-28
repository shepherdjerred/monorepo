# storm-brain

The LLM brain for The Storm's AI staff agent: chat classification and ticket
triage over structured outputs. The Paper plugin (`packages/the-storm`) calls
`POST /v1/classify` for ambiguous chat and `POST /v1/triage` for new
tickets; this service answers with a verdict the plugin's ladders enforce.

## Contract

Schemas live in [`src/schemas.ts`](src/schemas.ts) and mirror the plugin's
`agent.app` records field for field. Requests and responses are strict:
unknown keys fail with 400 so plugin/brain version skew surfaces loudly.

- `POST /v1/classify` — `{ player, lines }` → `{ offense | null,
confidence, label, reasoning, model, costMicros }`
- `POST /v1/triage` — `{ ticket, comments, reporterHistory, reporterBanned,
reporterRecentChat }` → `{ priorityId, confidence, duplicates, evidence,
draftReply, resolve, resolutionNote, model, costMicros }`

Errors are plain-text bodies with bounded outcomes:

| Status | Meaning                                   |
| ------ | ----------------------------------------- |
| 401    | auth header missing or wrong              |
| 415    | `application/json` required               |
| 413    | Payload over `STORM_BRAIN_MAX_BODY_BYTES` |
| 400    | Malformed JSON or schema violation        |
| 503    | Flow disabled by its Flipt flag           |
| 502    | Upstream LLM call failed (may still bill) |
| 500    | Unexpected failure                        |

A 503 is the normal shape of "off": the plugin treats it as a disabled
flow and completes silently, recording nothing. Billed usage is metered
even on 502s.

## Operations

- 1Password item `storm-brain` (Homelab vault) holds the service auth value
  and the OpenAI project key; the project key is provisioned manually with
  a monthly spend limit.
- Homelab chart `storm-brain` (namespace `storm-brain`): Deployment,
  Service, ServiceMonitor, NetworkPolicy. Game traffic comes only from the
  `minecraft-tsmc` namespace.
- Image `ghcr.io/shepherdjerred/storm-brain`, versioned through the
  version catalog.
- Flipt namespace `storm`, environment `prod`; the two flow flags above
  are the rollout switches. The plugin needs no restart when they flip.

## Configuration

| Variable                     | Required | Default        | Notes                                                          |
| ---------------------------- | -------- | -------------- | -------------------------------------------------------------- |
| `STORM_BRAIN_BEARER_TOKEN`   | yes      | —              | ≥32 chars, shared secret with the game                         |
| `OPENAI_API_KEY`             | yes      | —              | Backend key for the default model, checked at boot             |
| `STORM_BRAIN_MODEL`          | no       | `gpt-5.6-luna` | Must exist in `@shepherdjerred/llm-models` with a native route |
| `STORM_BRAIN_MAX_BODY_BYTES` | no       | 262144         | Per-request cap                                                |
| `STORM_BRAIN_LLM_TIMEOUT_MS` | no       | 60000          | Per-call LLM timeout                                           |
| `PORT` / `METRICS_PORT`      | no       | 3000 / 9090    | Must differ                                                    |

Flow enablement is not configuration: `POST /v1/classify` checks the
`storm-brain-classify-enabled` flag and `/v1/triage` checks
`storm-brain-triage-enabled`, both default off. See
[`managed-flag-inventory.json`](../feature-flags/src/managed-flag-inventory.json).

## Observability

- `GET /livez`, `GET /readyz` on the app port;
  `GET /metrics` plus `GET /livez` on the metrics port.
- `storm_brain_requests_total{flow,outcome}` — every request, bounded labels.
- `storm_brain_request_duration_seconds{flow}` — end-to-end latency.
- `storm_brain_cost_micros_total{flow}` — billed spend, failures included.
- `storm_brain_tokens_total{flow,kind}` — token mix (`input`, `output`,
  `cached`, `reasoning`, `cache_write`).
- JSON request logs. Prompt bodies and credentials never appear; validation
  failures log issue codes and paths only.

## Development

```bash
bun --filter @shepherdjerred/storm-brain test
PORT=3000 METRICS_PORT=9090 STORM_BRAIN_BEARER_TOKEN=... OPENAI_API_KEY=... bun src/index.ts
```

To exercise the live brain against OpenAI, run with static overrides:

```bash
FEATURE_FLAGS_MODE=static \
FEATURE_FLAGS_STATIC_OVERRIDES='{"storm-brain-classify-enabled":true,"storm-brain-triage-enabled":true}' \
  bun src/index.ts
```

Never attach production Flipt from a workstation. In the cluster the chart
sets `FEATURE_FLAGS_MODE=flipt` with the `storm` namespace.
