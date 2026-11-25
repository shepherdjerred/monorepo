# `@shepherdjerred/ci-cache`

Unified Rust streaming build-cache server (`:7380`) and read-only
`@shepherdjerred/console-ui` inspector console serving:

- **Turborepo Remote Cache v8 (`/v8/*`)**: Bearer `TURBO_TOKEN`, streaming
  uploads up to `512 MiB`, verbatim `x-artifact-tag` replay so main vs. PR
  signature verification stays strictly client-side, `/v8/artifacts/events`, and
  `/v8/clean`.
- **Gradle `HttpBuildCache` (`/cache/{*key}`)**: HTTP Basic Auth (`ci-main`
  read-write up to `100 MiB`; `ci-pull-request` read-only with `403 Forbidden`
  on writes).
- **`mozilla/sccache` WebDAV (`/sccache/{*path}`)**: HTTP Basic Auth with
  `MKCOL` acknowledgment and copy-on-write PR overlay (`ci-main` reads/writes
  `sccache:trusted`; `ci-pull-request` reads `sccache:pr` with fallback to
  `sccache:trusted` and writes exclusively to `sccache:pr`).

## Storage & Eviction

Artifacts stream in `64 KiB` chunks into `<CI_CACHE_DATA_DIR>/staging/<uuid>.part`
with on-the-fly SHA-256 hashing (`sync_data()` + atomic `rename()` into sharded
`blobs/<namespace>/<prefix2>/<sha256_key>`). Metadata lives in SQLite WAL
(`index.sqlite3`), while `GET`/`HEAD` cache hits buffer `last_accessed_at` and
`hit_count` deltas in memory and flush in a single batched transaction every
30 seconds.

Continuous eviction enforces per-namespace TTLs (`14d` for `turbo:*` and
`sccache:pr`; `30d` for `gradle:main` and `sccache:trusted`) and byte watermarks
(`850 GiB` high watermark -> `780 GiB` low watermark against a `1 TiB` quota).
