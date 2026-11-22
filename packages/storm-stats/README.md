# `@shepherdjerred/storm-stats`

Plan-style Minecraft player, session, combat, retention, and custom gameplay analytics service for **The Storm** (`tsmc`).

## Listener Architecture

`storm-stats` isolates public traffic, staff diagnostics, and cluster-internal event ingestion onto separate TCP listeners inside one single-writer SQLite process:

| Listener               | Default Port                       | Exposure                                      | Capabilities                                                                                                                                                                                                                                             |
| ---------------------- | ---------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public HTTP + SPA      | `7420` (`PORT`)                    | Cloudflare Tunnel (`stats.ts-mc.net`)         | Read-only `/api/v1/*` (`viewer.role = "public"`), `/healthz`, `/readyz`, `/metrics`, React SPA. Never mounts `/api/staff/*` or `/api/v1/ingest`, and omits `staff` summaries from player rows.                                                           |
| Staff Admin HTTP + SPA | `7421` (`STORM_STATS_ADMIN_PORT`)  | Tailscale Ingress (`storm-stats`)             | Full `/api/v1/*` (`viewer.role = "staff"`, unaffected by `storm-stats-public-enabled`), `/api/staff/*` (GeoIP/join-address network analytics, connection bounces, player segment query builder, per-player history overlay, raw player JSON), React SPA. |
| Internal Ingest        | `7422` (`STORM_STATS_INGEST_PORT`) | Cluster-only (`minecraft-tsmc` NetworkPolicy) | `GET /healthz` and `POST /api/v1/ingest` authenticated via constant-time `Authorization: Bearer <STORM_STATS_INGEST_TOKEN>` check (`2 MiB` max body, Zod `IngestBatchSchema` validation, idempotent `processed_events` ledger).                          |

## Bootstrap Environment & Feature Flags

Bootstrap environment variables carry only listener addresses, storage paths, and credentials:

- `HOST` — bind address (default `"0.0.0.0"`)
- `PORT` — public HTTP + SPA port (default `7420`)
- `STORM_STATS_ADMIN_PORT` — optional Tailscale staff HTTP + SPA port (e.g. `7421`; disabled when unset)
- `STORM_STATS_INGEST_PORT` — optional internal ingest port (e.g. `7422`; disabled when unset)
- `STORM_STATS_INGEST_TOKEN` — required when `STORM_STATS_INGEST_PORT` is set (minimum 24 characters)
- `STORM_STATS_DATABASE_PATH` — SQLite path (`:memory:` by default in dev/tests, `/var/lib/storm-stats/storm-stats.sqlite` in production)
- `STORM_STATS_SEED_DEMO` — `"1"` / `"true"` populates deterministic 90-day demo data on an empty database for local development
- `FEATURE_FLAGS_MODE` — `"flags"`, `"flipt"`, `"static"`, or `"disabled"`

Operational behavior is resolved via `@shepherdjerred/config` and `@shepherdjerred/feature-flags` (`flag -> env -> default`):

- `storm-stats-ingest-enabled` (`STORM_STATS_INGEST_ENABLED`, default `true`) — returns `503` on `/api/v1/ingest` when `false` so `TheStorm` retains events in its durable SQLite outbox.
- `storm-stats-public-enabled` (`STORM_STATS_PUBLIC_ENABLED`, default `true`) — returns `503` on public `/api/v1/*` (except `/api/v1/viewer`) when `false` while keeping the Tailscale staff listener operational.

## HTTP Endpoints

### Public & Staff Read API (`/api/v1/*`)

- `GET /api/v1/viewer` — `ViewerInfo`
- `GET /api/v1/overview` — `ServerOverviewResponse` (`24h`/`7d`/`30d` rolling KPIs, 30-day Pacific daily series, Plan Activity Index groups, world/mode shares, recent sessions)
- `GET /api/v1/activity` — `OnlineActivityResponse` (180-day series, 168-cell Pacific punchcard, 730-day calendar, Monday retention cohorts `week1`/`week2`/`week4`, first-session engagement)
- `GET /api/v1/players` — `PlayersDirectoryResponse` (`search`/`q`, `sort`, `order`, `activityGroup`/`group`, `platform`, `online`, `town`, `page`, `pageSize`)
- `GET /api/v1/players/:id` — `PlayerProfileResponse` by UUID or case-insensitive player name
- `GET /api/v1/pvp` — `PvpOverviewResponse`
- `GET /api/v1/gameplay` — `GameplayOverviewResponse`

### Staff-Only Diagnostics (`/api/staff/*`, `:7421` only)

- `GET /api/staff/network` — `StaffNetworkResponse`
- `GET /api/staff/bounces` — `StaffBouncesResponse`
- `GET /api/staff/query` — `StaffQueryResponse` (`search`, `activityGroup`, `platform`, `primaryGroup`, `countryCode`, `joinAddress`, `town`, `minActiveHours`, `maxActiveHours`, `minSessions`, `minActivityIndex`, `seenWithinDays`, `registeredWithinDays`, `hasBounces`, `online`, `sort`, `order`, `limit`)
- `GET /api/staff/players/:id` — `StaffPlayerOverlayResponse`
- `GET /api/staff/players/:id/raw` — raw player audit JSON

## Local Development

```bash
bunx turbo run build typecheck test lint --filter=@shepherdjerred/storm-stats
```
