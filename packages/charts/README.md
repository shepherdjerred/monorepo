# `@shepherdjerred/charts`

First-party Rust Helm chart repository and read-only `@shepherdjerred/console-ui`
catalog console, replacing ChartMuseum on a single SQLite WAL + blob PVC.

## HTTP API

| Method | Path                         | Description                                                                   |
| ------ | ---------------------------- | ----------------------------------------------------------------------------- |
| `GET`  | `/healthz`                   | Liveness probe (`200 "ok"`).                                                  |
| `GET`  | `/readyz`                    | Readiness probe checking SQLite `SELECT 1` and staging-dir writeability.      |
| `GET`  | `/metrics`                   | Prometheus metrics exposition (`charts_*`).                                   |
| `GET`  | `/index.yaml`                | Helm v1 repository index cached by `catalog_revision` with strong `ETag`.     |
| `GET`  | `/charts/:filename`          | Immutable `.tgz` archive stream (`Cache-Control: public, max-age=31536000`).  |
| `GET`  | `/api/charts`                | All charts grouped newest-first (`Record<string, ChartReleaseView[]>`).       |
| `GET`  | `/api/charts/:name`          | Releases for `:name` newest-first, or `404` when absent.                      |
| `GET`  | `/api/charts/:name/:version` | Metadata for a single `(name, version)`, or `404` when absent.                |
| `GET`  | `/api/summary`               | Single-load catalog summary and release inventory for the console SPA.        |
| `POST` | `/api/charts`                | Constant-time Basic Auth upload (`201`, `200` idempotent, `409` on conflict). |

## Configuration

| Variable                      | Default                    | Purpose                                                        |
| ----------------------------- | -------------------------- | -------------------------------------------------------------- |
| `HOST`                        | `0.0.0.0`                  | Listen address.                                                |
| `PORT`                        | `7370`                     | Listen port.                                                   |
| `CHARTS_DATA_DIR`             | `/var/lib/charts`          | Root directory holding `charts.sqlite3`, `blobs/`, `staging/`. |
| `CHARTS_STATIC_DIR`           | `/usr/share/charts/client` | Built Vite SPA directory (falls back to `dist/client`).        |
| `CHARTS_QUOTA_BYTES`          | `8589934592`               | Storage quota in bytes for UI meter and Prometheus gauge.      |
| `CHARTS_BASIC_AUTH_USER`      | unset                      | Username required for `POST /api/charts`.                      |
| `CHARTS_BASIC_AUTH_PASS`      | unset                      | Password required for `POST /api/charts`.                      |
| `CHARTS_BASIC_AUTH_PASS_FILE` | unset                      | File containing password for `POST /api/charts`.               |

## Verification

```bash
mise exec rust sccache -- cargo fmt --manifest-path packages/charts/Cargo.toml --all -- --check
mise exec rust sccache -- cargo clippy --manifest-path packages/charts/Cargo.toml --workspace --all-targets --locked -- -D warnings
mise exec rust sccache -- cargo test --manifest-path packages/charts/Cargo.toml --workspace --locked
bunx turbo run build typecheck test lint --filter=@shepherdjerred/charts
docker build --target smoke -f packages/charts/Dockerfile .
```
