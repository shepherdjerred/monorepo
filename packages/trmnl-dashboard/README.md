# TRMNL Dashboard

Bun stdlib HTTP service that exposes compact JSON payloads for TRMNL Private
Plugins.

## Endpoints

- `GET /livez` - process liveness
- `GET /healthz` - configuration health
- `GET /api/home` - Home Assistant status payload
- `GET /api/homelab` - homelab status payload
- `GET /api/pets` - pet-care status and daily activity payload (feature flagged)
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

`/api/pets` is controlled by the managed `pet-dashboard-enabled` flag and is
absent (404) by default. The internal metrics endpoint remains available to the
restricted Prometheus ServiceMonitor so alerts can be verified before the TRMNL
screen is enabled.

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

## Private plugins as code

The two existing private plugins are complete
[`trmnlp`](https://github.com/usetrmnl/trmnlp/blob/main/README.md) projects:

- `trmnl/home-assistant` — plugin ID `303046`
- `trmnl/homelab` — plugin ID `303047`

Their IDs are immutable deployment targets. Do not run `trmnlp init` or push a
project without its committed ID: that would create a new remote plugin and
break the relationship with the existing playlist entries.

The repository pins both the `trmnlp` image and TRMNL framework version. Local
and CI rendering uses deterministic synthetic JSON from `trmnl/fixtures`; it
does not call the production dashboard or need its polling key.

From the repository root, validate all four layouts for both plugins:

```bash
docker run --rm --entrypoint sh \
  -v "$(pwd):/workspace" -w /workspace \
  trmnl/trmnlp:v0.11.0@sha256:4ac6d7f35ff30665b6c3b2634c2ba830488b2ee38783acc2ce953b652cb1c973 \
  packages/trmnl-dashboard/scripts/trmnlp-ci.sh validate
```

Preview one plugin at `http://localhost:4567`:

```bash
docker run --rm --entrypoint sh -p 4567:4567 \
  -v "$(pwd):/workspace" -w /workspace \
  trmnl/trmnlp:v0.11.0@sha256:4ac6d7f35ff30665b6c3b2634c2ba830488b2ee38783acc2ce953b652cb1c973 \
  packages/trmnl-dashboard/scripts/trmnlp-ci.sh serve home-assistant
```

Buildkite runs the same validation without secrets on pull requests. On main,
the path-selected `trmnl` lane validates both projects before publishing either
one, then pushes plugin `303046` followed by `303047`. The publisher uses the
dedicated account-level `TRMNL_API_KEY` from
`buildkite-trmnl-credentials`; this is intentionally separate from the
dashboard service's polling key.

For an intentional remote-to-repository refresh, provide the account key
through the environment and pull each existing ID explicitly:

```bash
trmnlp pull --id 303046 --dir packages/trmnl-dashboard/trmnl/home-assistant
trmnlp pull --id 303047 --dir packages/trmnl-dashboard/trmnl/homelab
```

Review every resulting diff before committing. Hosted custom-field values are
instance state and must not be copied into Git. The `api_key` field is a
password whose value remains stored only in TRMNL; `settings.yml` commits only
the field definition and encoded header template.

Playlist membership and ordering, schedules, mashups, and device settings
remain managed in the TRMNL UI because the hosted API does not expose their
complete composition. Manual edits in TRMNL's markup editor are drift and will
be overwritten by the next successful main publication.
